import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { createApprovalStore } from "../config/murray-agent/approvals.mjs";
import { createChatEngine } from "../config/murray-agent/chat.mjs";
import { createCodingSession } from "../config/murray-agent/coding.mjs";
import { openMurrayDb } from "../config/murray-agent/db.mjs";
import { createJobStore, createJobWorker } from "../config/murray-agent/jobs.mjs";
import { createOperatorInbox } from "../config/murray-agent/operator-inbox.mjs";
import { createOps } from "../config/murray-agent/ops.mjs";
import { createMurrayAgentServer } from "../config/murray-agent/server.mjs";
import { createSessionStore } from "../config/murray-agent/session.mjs";
import { createWorkspace } from "../config/murray-agent/workspace.mjs";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

async function withServer(engine, fn) {
  const server = createMurrayAgentServer({ engine, model: "deepseek-chat" });
  const port = await listen(server);
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function createTestStack(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "murray-decoupling-"));
  const dbPath = path.join(root, "murray.db");
  const db = openMurrayDb({ filePath: dbPath });
  const session = createSessionStore({ db });
  const jobs = createJobStore({ db });
  const approvals = createApprovalStore({ db });
  const operatorInbox = createOperatorInbox({ db });

  const notes = [];
  const telegram = {
    send: async (msg) => {
      notes.push(msg);
      return { ok: true };
    },
  };

  const ops = createOps({
    runCommand: async (args) => ({ code: 0, stdout: "ok", stderr: "" }),
    ...overrides.ops,
  });

  const workspace = createWorkspace({
    workspaceRoot: path.join(root, "workspace"),
    gitRun: async (args, opts = {}) => {
      const verb = args[0];
      if (verb === "clone") {
        const dest = args.at(-1);
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "README.md"), "# cloned repo\n");
        return { code: 0, stdout: "", stderr: "" };
      }
      if (verb === "rev-parse") {
        return { code: 0, stdout: "main\n", stderr: "" };
      }
      if (verb === "status") {
        return { code: 0, stdout: "## main\n", stderr: "" };
      }
      if (verb === "remote") {
        return { code: 0, stdout: "https://github.com/octocat/Hello-World.git", stderr: "" };
      }
      return { code: 0, stdout: "ok\n", stderr: "" };
    },
    ...overrides.workspace,
  });

  const openhands = {
    startConversation: async () => ({
      id: "task1",
      status: "READY",
      app_conversation_id: "conv-1",
    }),
    getStartTask: async () => ({
      id: "task1",
      status: "READY",
      app_conversation_id: "conv-1",
    }),
    getConversation: async () => ({
      execution_status: "finished",
      sandbox_status: "RUNNING",
    }),
    sendMessage: async () => ({ success: true, sandbox_status: "RUNNING" }),
    searchEvents: async () => [
      { kind: "MessageEvent", payload: { content: "tests pass" } },
    ],
    gitChanges: async () => ({ items: ["README.md"] }),
    ...overrides.openhands,
  };

  const workerRef = { current: null };
  const coding = createCodingSession({
    workspace,
    session,
    jobs,
    approvals,
    openhands,
    telegram,
    ops,
    llm: overrides.inspectLlm || {
      complete: async () => ({
        content: JSON.stringify({
          summary: "ok",
          what_happened: "health good",
          what_did_not: "none",
          actions: [],
          operator_tasks: [],
        }),
      }),
    },
    readDoc: overrides.readDoc || (() => "doc"),
    operatorInbox,
    pollDelayMs: 1,
    worker: {
      kick(id) {
        return workerRef.current ? workerRef.current.kick(id) : Promise.resolve(null);
      },
    },
  });

  workerRef.current = createJobWorker({
    store: jobs,
    handlers: coding.handlers,
    intervalMs: 60_000,
  });

  const engine = createChatEngine({
    ops,
    llm: overrides.llm || {
      complete: async () => ({ content: "Respuesta Murray", tool_calls: [] }),
    },
    memory: {
      get: () => [],
      append: () => {},
    },
    approvals,
    coding,
    workspace,
    session,
    personaText: "Murray Persona",
  });

  function cleanup() {
    try {
      db.close();
    } catch {}
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  }

  return { engine, coding, session, jobs, approvals, worker: workerRef.current, notes, root, cleanup };
}

test("POST /triage responde HTTP 200 en <50ms y asienta inspect job en SQLite WAL", async () => {
  const stack = createTestStack();
  try {
    await withServer(stack.engine, async (port) => {
      const t0 = performance.now();
      const res = await fetch(`http://127.0.0.1:${port}/triage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: "test-triage-1" }),
      });
      const elapsed = performance.now() - t0;
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.ok(elapsed < 50, `POST /triage tardó ${elapsed.toFixed(2)}ms (límite <50ms)`);
      assert.equal(body.needs_job, true);
      assert.ok(body.job_id, "Debe devolver job_id");
      assert.match(body.reply, /inspect/i);

      // Verificar persistencia inmediata en SQLite WAL
      const job = stack.jobs.get(body.job_id);
      assert.ok(job, "El job debe existir en SQLite WAL");
      assert.equal(job.type, "inspect");
      assert.equal(job.chatId, "test-triage-1");
    });
  } finally {
    stack.cleanup();
  }
});

test("GET /triage responde HTTP 200 en <50ms como alternativa liviana", async () => {
  const stack = createTestStack();
  try {
    await withServer(stack.engine, async (port) => {
      const t0 = performance.now();
      const res = await fetch(`http://127.0.0.1:${port}/triage?chat_id=test-get-1`);
      const elapsed = performance.now() - t0;
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.ok(elapsed < 50, `GET /triage tardó ${elapsed.toFixed(2)}ms (límite <50ms)`);
      assert.equal(body.needs_job, true);
      assert.ok(body.job_id);

      const job = stack.jobs.get(body.job_id);
      assert.ok(job);
      assert.equal(job.type, "inspect");
      assert.equal(job.chatId, "test-get-1");
    });
  } finally {
    stack.cleanup();
  }
});

test("POST /triage desacopla ejecución: respuesta <50ms aunque el modelo de inspect tarde segundos", async () => {
  let releaseWorker;
  const workerBlocked = new Promise((resolve) => {
    releaseWorker = resolve;
  });

  const stack = createTestStack({
    inspectLlm: {
      complete: async () => {
        // Simular inspección profunda con latencia de 500ms
        await workerBlocked;
        return {
          content: JSON.stringify({
            summary: "ok after block",
            what_happened: "done",
            what_did_not: "none",
            actions: [],
            operator_tasks: [],
          }),
        };
      },
    },
  });

  try {
    await withServer(stack.engine, async (port) => {
      const t0 = performance.now();
      const res = await fetch(`http://127.0.0.1:${port}/triage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: "test-blocked-worker" }),
      });
      const elapsed = performance.now() - t0;
      const body = await res.json();

      assert.equal(res.status, 200);
      // El endpoint HTTP emite 200 sin esperar al worker bloqueado
      assert.ok(elapsed < 50, `POST /triage tardó ${elapsed.toFixed(2)}ms bloqueado (límite <50ms)`);
      assert.equal(body.needs_job, true);

      // Desbloquear worker para permitir drenaje limpio
      releaseWorker();
      await stack.worker.kick(body.job_id);
      const finishedJob = stack.jobs.get(body.job_id);
      assert.equal(finishedJob.status, "done");
    });
  } finally {
    stack.cleanup();
  }
});

test("POST /workspace/hitl responde HTTP 200 en <50ms al aprobar misión de código", async () => {
  let releaseOpenHands;
  const openHandsBlocked = new Promise((resolve) => {
    releaseOpenHands = resolve;
  });

  const stack = createTestStack({
    openhands: {
      startConversation: async () => {
        await openHandsBlocked;
        return {
          id: "task-slow",
          status: "READY",
          app_conversation_id: "conv-slow",
        };
      },
    },
  });

  try {
    // 1. Crear solicitud HITL previa para code mission
    const approvalId = stack.approvals.issue({
      kind: "code",
      chatId: "ceo-chat",
      slug: "test-repo",
      instruction: "implement feature X",
      testCommand: "npm test",
    });

    await withServer(stack.engine, async (port) => {
      const t0 = performance.now();
      const res = await fetch(`http://127.0.0.1:${port}/workspace/hitl`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: "ceo-chat",
          callback_data: `APPROVE_CODE:${approvalId}`,
        }),
      });
      const elapsed = performance.now() - t0;
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.ok(elapsed < 50, `POST /workspace/hitl tardó ${elapsed.toFixed(2)}ms (límite <50ms)`);
      assert.equal(body.needs_job, true);
      assert.ok(body.job_id);
      assert.match(body.reply, /Misión encolada/);

      // Asentado en SQLite WAL
      const job = stack.jobs.get(body.job_id);
      assert.ok(job);
      assert.equal(job.type, "code");

      // Idempotencia / Prevención de Double Kicks ante reintento de webhook
      const dupRes = await fetch(`http://127.0.0.1:${port}/workspace/hitl`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: "ceo-chat",
          callback_data: `APPROVE_CODE:${approvalId}`,
        }),
      });
      assert.equal(dupRes.status, 403, "Reintento de token consumido debe dar 403 sin crear nuevo job");
      assert.equal(stack.jobs.list({ chatId: "ceo-chat" }).length, 1, "No debe duplicar jobs");

      // Desbloquear openhands para finalizar
      releaseOpenHands();
    });
  } finally {
    stack.cleanup();
  }
});

test("POST /workspace/hitl responde HTTP 200 en <50ms al aprobar clone", async () => {
  const stack = createTestStack();
  try {
    const approvalId = stack.approvals.issue({
      kind: "clone",
      chatId: "ceo-chat-2",
      url: "https://github.com/octocat/Hello-World",
      slug: "octocat-Hello-World",
    });

    await withServer(stack.engine, async (port) => {
      const t0 = performance.now();
      const res = await fetch(`http://127.0.0.1:${port}/workspace/hitl`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: "ceo-chat-2",
          callback_data: `APPROVE_CLONE:${approvalId}`,
        }),
      });
      const elapsed = performance.now() - t0;
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.ok(elapsed < 50, `POST /workspace/hitl clone tardó ${elapsed.toFixed(2)}ms (límite <50ms)`);
      assert.equal(body.needs_job, true);
      assert.ok(body.job_id);

      const job = stack.jobs.get(body.job_id);
      assert.ok(job);
      assert.equal(job.type, "clone");
    });
  } finally {
    stack.cleanup();
  }
});

test("POST /chat responde HTTP 200 en <50ms al ordenar triage, pull o checkout", async () => {
  const stack = createTestStack();
  try {
    stack.session.patch("chat-orders", { slug: "my-active-repo" });

    await withServer(stack.engine, async (port) => {
      // 1. /triage vía /chat
      const t0 = performance.now();
      const resTriage = await fetch(`http://127.0.0.1:${port}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: "chat-orders", text: "/triage" }),
      });
      const elapsedTriage = performance.now() - t0;
      const bodyTriage = await resTriage.json();

      assert.equal(resTriage.status, 200);
      assert.ok(elapsedTriage < 50, `/chat /triage tardó ${elapsedTriage.toFixed(2)}ms (límite <50ms)`);
      assert.equal(bodyTriage.needs_job, true);
      assert.ok(bodyTriage.job_id);
      assert.equal(stack.jobs.get(bodyTriage.job_id).type, "inspect");

      // 2. hacé pull vía /chat
      const t1 = performance.now();
      const resPull = await fetch(`http://127.0.0.1:${port}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: "chat-orders", text: "hacé pull" }),
      });
      const elapsedPull = performance.now() - t1;
      const bodyPull = await resPull.json();

      assert.equal(resPull.status, 200);
      assert.ok(elapsedPull < 50, `/chat pull tardó ${elapsedPull.toFixed(2)}ms (límite <50ms)`);
      assert.equal(bodyPull.needs_job, true);
      assert.ok(bodyPull.job_id);
      assert.equal(stack.jobs.get(bodyPull.job_id).type, "pull");

      // 3. checkout -b feat/decoupled vía /chat
      const t2 = performance.now();
      const resCheckout = await fetch(`http://127.0.0.1:${port}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: "chat-orders", text: "checkout -b feat/decoupled" }),
      });
      const elapsedCheckout = performance.now() - t2;
      const bodyCheckout = await resCheckout.json();

      assert.equal(resCheckout.status, 200);
      assert.ok(elapsedCheckout < 50, `/chat checkout tardó ${elapsedCheckout.toFixed(2)}ms (límite <50ms)`);
      assert.equal(bodyCheckout.needs_job, true);
      assert.ok(bodyCheckout.job_id);
      assert.equal(stack.jobs.get(bodyCheckout.job_id).type, "checkout");
    });
  } finally {
    stack.cleanup();
  }
});
