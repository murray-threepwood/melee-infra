import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createApprovalStore } from "../config/murray-agent/approvals.mjs";
import { createChatEngine } from "../config/murray-agent/chat.mjs";
import { createCodingSession } from "../config/murray-agent/coding.mjs";
import { fetchGmailMeta } from "../config/murray-agent/gmail-meta.mjs";
import { createJobStore, createJobWorker } from "../config/murray-agent/jobs.mjs";
import { createMemory } from "../config/murray-agent/memory.mjs";
import { createSessionStore } from "../config/murray-agent/session.mjs";
import { createWorkspace } from "../config/murray-agent/workspace.mjs";
import {
  assertSafeComposeArgs,
  createOps,
} from "../config/murray-agent/ops.mjs";
import { redact } from "../config/murray-agent/redact.mjs";
import { createMurrayAgentServer } from "../config/murray-agent/server.mjs";

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

function memoryStub() {
  const store = {};
  return {
    get(id) {
      return store[id] || [];
    },
    append(id, role, content) {
      store[id] = store[id] || [];
      store[id].push({ role, content });
    },
  };
}

function makeEngine(overrides = {}) {
  const commands = [];
  const ops = createOps({
    runCommand: async (args) => {
      commands.push(args);
      return { code: 0, stdout: '{"Name":"murray-n8n"}', stderr: "" };
    },
  });
  const llm = {
    complete: async () => ({ content: "Núcleo: todo healthy.", tool_calls: [] }),
  };
  return {
    commands,
    engine: createChatEngine({
      ops,
      llm,
      memory: memoryStub(),
      approvals: createApprovalStore(),
      gmailMeta: async () => ({
        http: 200,
        status: "ok",
        error: "",
        unread_count: 0,
      }),
      readDoc: () => "RUNBOOK fake",
      personaText: "Murray test",
      fetchImpl: async () => ({
        status: 200,
        text: async () => '{"status":"ok"}',
      }),
      ...overrides,
    }),
  };
}

test("redact no deja secretos en texto", () => {
  const dirty =
    "secret=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 token=1//0refresh sk-abc eyJhbGciOi";
  const clean = redact(dirty);
  assert.equal(clean.includes("ESOabv"), false);
  assert.equal(clean.includes("GOCSPX-REDACTED"), true);
});

test("ops allowlist rechaza down -v y exec", () => {
  assert.throws(() => assertSafeComposeArgs(["compose", "down", "-v"]), {
    code: "ops_forbidden",
  });
  assert.throws(() => assertSafeComposeArgs(["compose", "exec", "n8n", "sh"]), {
    code: "ops_forbidden",
  });
});

test("ops recreate arma force-recreate --no-deps sin down", async () => {
  const seen = [];
  const ops = createOps({
    runCommand: async (args) => {
      seen.push(args);
      return { code: 0, stdout: "", stderr: "" };
    },
    project: "murray-infra",
    composeFile: "/opt/stack/docker-compose.yml",
    projectDir: "/opt/stack",
  });
  await ops.recreate("n8n");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].includes("down"), false);
  assert.equal(seen[0].includes("--force-recreate"), true);
  assert.equal(seen[0].includes("--no-deps"), true);
  assert.equal(seen[0].at(-1), "n8n");
});

test("gmail meta no copia subject ni sender", async () => {
  const meta = await fetchGmailMeta({
    fetchImpl: async () => ({
      status: 200,
      json: async () => ({
        status: "ok",
        unread_count: 2,
        messages: [{ subject: "SECRETO", sender: "Ada" }],
      }),
    }),
    baseUrl: "http://mcp.test",
  });
  const encoded = JSON.stringify(meta);
  assert.equal(meta.unread_count, 2);
  assert.equal(encoded.includes("SECRETO"), false);
  assert.equal(encoded.includes("Ada"), false);
  assert.equal(Object.hasOwn(meta, "messages"), false);
});

test("GET /healthz 200", async () => {
  const { engine } = makeEngine();
  await withServer(engine, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.service, "murray-agent");
    assert.equal(body.status, "ok");
  });
});

test("POST /ops/execute sin approval_id da 403 y no corre compose", async () => {
  const { engine, commands } = makeEngine();
  await withServer(engine, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/ops/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.error, "ops_approval_denied");
    assert.equal(commands.length, 0);
  });
});

test("POST /chat /status no llama al LLM", async () => {
  let llmHits = 0;
  const { engine } = makeEngine({
    llm: {
      complete: async () => {
        llmHits += 1;
        return { content: "no", tool_calls: [] };
      },
    },
  });
  await withServer(engine, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: "1", text: "/status" }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.needs_hitl, false);
    assert.equal(body.parse_mode, "HTML");
    assert.match(body.reply, /Compose ps/);
    assert.equal(llmHits, 0);
  });
});

test("propose_ops emite HITL y execute consume una vez", async () => {
  const approvals = createApprovalStore();
  const commands = [];
  const ops = createOps({
    runCommand: async (args) => {
      commands.push(args);
      return { code: 0, stdout: "recreated", stderr: "" };
    },
  });
  const engine = createChatEngine({
    ops,
    approvals,
    memory: memoryStub(),
    llm: {
      complete: async () => ({
        content: "Pido recreate.",
        tool_calls: [
          {
            id: "call_1",
            function: {
              name: "propose_ops",
              arguments: JSON.stringify({
                action: "recreate",
                service: "workspace-mcp",
              }),
            },
          },
        ],
      }),
    },
    gmailMeta: async () => ({ unread_count: 0 }),
    readDoc: () => "",
    personaText: "x",
  });
  await withServer(engine, async (port) => {
    const chatRes = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: "9", text: "recreá workspace-mcp" }),
    });
    const chatBody = await chatRes.json();
    assert.equal(chatRes.status, 200);
    assert.equal(chatBody.needs_hitl, true);
    assert.equal(chatBody.hitl.action, "recreate");
    assert.equal(chatBody.hitl.service, "workspace-mcp");
    assert.ok(chatBody.hitl.approval_id);
    assert.equal(commands.length, 0);

    const execRes = await fetch(`http://127.0.0.1:${port}/ops/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approval_id: chatBody.hitl.approval_id }),
    });
    const execBody = await execRes.json();
    assert.equal(execRes.status, 200);
    assert.match(execBody.reply, /workspace-mcp/);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].includes("--force-recreate"), true);

    const again = await fetch(`http://127.0.0.1:${port}/ops/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approval_id: chatBody.hitl.approval_id }),
    });
    assert.equal(again.status, 403);
  });
});

test("gmail tool no deja subject en la respuesta al CEO", async () => {
  const engine = createChatEngine({
    ops: createOps({
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    }),
    approvals: createApprovalStore(),
    memory: memoryStub(),
    llm: {
      complete: async ({ messages }) => {
        const last = messages.at(-1);
        if (last.role === "tool") {
          assert.equal(String(last.content).includes("CONFIDENCIAL"), false);
          return { content: `Inbox meta ${last.content}`, tool_calls: [] };
        }
        return {
          content: "",
          tool_calls: [
            {
              id: "g1",
              function: { name: "gmail_unread_meta", arguments: "{}" },
            },
          ],
        };
      },
    },
    gmailMeta: async () => ({
      http: 200,
      status: "ok",
      error: "",
      unread_count: 3,
    }),
    readDoc: () => "",
    personaText: "x",
  });
  const result = await engine.handleChat({
    chat_id: "1",
    text: "cuántos unread hay",
  });
  assert.equal(result.reply.includes("CONFIDENCIAL"), false);
  assert.match(result.reply, /unread_count/);
});

test("memoria recorta a 20 mensajes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-mem-"));
  const mem = createMemory({ filePath: path.join(dir, "memory.json") });
  for (let i = 0; i < 25; i += 1) {
    mem.append("c1", "user", `m${i}`);
  }
  const rows = mem.get("c1");
  assert.equal(rows.length, 20);
  assert.equal(rows[0].content, "m5");
  fs.rmSync(dir, { recursive: true, force: true });
});

function codingStack(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "murray-code-"));
  const sessionPath = path.join(root, "session.json");
  const jobsPath = path.join(root, "jobs.json");
  const notes = [];
  const workspace = createWorkspace({
    root,
    gitName: "Murray",
    gitEmail: "murray@threepwood.uy",
    gitRun: async (args, opts = {}) => {
      const verb = args.includes("clone")
        ? "clone"
        : args.includes("push")
          ? "push"
          : args.includes("pull")
            ? "pull"
            : args.includes("commit")
              ? "commit"
              : args.includes("checkout")
                ? "checkout"
                : args.includes("rev-parse")
                  ? "rev-parse"
                  : args.includes("status")
                    ? "status"
                    : args.includes("diff")
                      ? "diff"
                      : args.includes("log")
                        ? "log"
                        : args.includes("fetch")
                          ? "fetch"
                          : args.includes("add")
                            ? "add"
                            : args.includes("remote")
                              ? "remote"
                              : args[0];
      if (opts.allowPush === false && verb === "push") {
        throw Object.assign(new Error("git push exige HITL"), { code: "git_forbidden" });
      }
      if (verb === "clone") {
        const dest = args.at(-1);
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "README.md"), "# main entry\n");
        return { code: 0, stdout: "", stderr: "" };
      }
      if (verb === "rev-parse") {
        if (args.includes("--is-shallow-repository")) {
          return { code: 0, stdout: "true\n", stderr: "" };
        }
        if (args.includes("--abbrev-ref")) {
          return { code: 0, stdout: `${overrides.branch || "feat/disk"}\n`, stderr: "" };
        }
      }
      if (verb === "remote") {
        return { code: 0, stdout: "https://github.com/octocat/Hello-World.git", stderr: "" };
      }
      if (verb === "status") {
        const porcelain =
          overrides.statusStdout !== undefined
            ? overrides.statusStdout
            : `## ${overrides.branch || "feat/disk"}\n M README.md\n`;
        return { code: 0, stdout: porcelain, stderr: "" };
      }
      if (verb === "push" && !opts.allowPush) {
        throw Object.assign(new Error("git push exige HITL"), { code: "git_forbidden" });
      }
      return { code: 0, stdout: "ok\n", stderr: "" };
    },
  });
  const session = createSessionStore({ filePath: sessionPath });
  const jobs = createJobStore({ filePath: jobsPath });
  const approvals = createApprovalStore();
  const telegram = {
    send: async (msg) => {
      notes.push(msg);
      return { ok: true };
    },
  };
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
    ops: overrides.ops,
    pollDelayMs: overrides.pollDelayMs ?? 1,
    worker: {
      kick(id) {
        return workerRef.current.kick(id);
      },
    },
  });
  workerRef.current = createJobWorker({
    store: jobs,
    handlers: coding.handlers,
    intervalMs: 60_000,
  });
  const { engine } = makeEngine({
    approvals,
    coding,
    workspace,
    session,
    llm: overrides.llm || {
      complete: async () => ({ content: "Núcleo: leí el repo.", tool_calls: [] }),
    },
  });
  return { engine, coding, session, jobs, worker: workerRef.current, notes, root };
}

test("POST /chat clone sin URL no llama LLM", async () => {
  let llmHits = 0;
  const { engine } = codingStack({
    llm: {
      complete: async () => {
        llmHits += 1;
        return { content: "no", tool_calls: [] };
      },
    },
  });
  await withServer(engine, async (port) => {
    const res = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: "7", text: "cloná algo" }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.needs_hitl, false);
    assert.match(body.reply, /URL https/);
    assert.equal(llmHits, 0);
  });
});

test("mutate sin repo pregunta y no dispara HITL código", async () => {
  let llmHits = 0;
  const { engine } = codingStack({
    llm: {
      complete: async () => {
        llmHits += 1;
        return { content: "no", tool_calls: [] };
      },
    },
  });
  const result = await engine.handleChat({
    chat_id: "8",
    text: "mejorá el README",
  });
  assert.equal(result.needs_hitl, false);
  assert.match(result.reply, /repo activo/);
  assert.equal(llmHits, 0);
});

test("clone HITL + execute encola job y no pushea", async () => {
  const { engine, worker, session, notes, root } = codingStack();
  await withServer(engine, async (port) => {
    const chatRes = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: "9",
        text: "cloná https://github.com/octocat/Hello-World",
      }),
    });
    const chatBody = await chatRes.json();
    assert.equal(chatRes.status, 200);
    assert.equal(chatBody.needs_hitl, true);
    assert.equal(chatBody.hitl.kind, "clone");
    assert.match(chatBody.hitl.approve_data, /^APPROVE_CLONE:[a-f0-9]{16}$/);
    assert.equal(chatBody.hitl.approve_data.length <= 64, true);

    const hitlRes = await fetch(`http://127.0.0.1:${port}/workspace/hitl`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: "9",
        callback_data: chatBody.hitl.approve_data,
      }),
    });
    const hitlBody = await hitlRes.json();
    assert.equal(hitlRes.status, 200);
    assert.equal(hitlBody.needs_job, true);
    await worker.kick(hitlBody.job_id);
    assert.equal(session.get("9").slug, "octocat-Hello-World");
    assert.equal(notes.length >= 1, true);
    const qa = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: "9", text: "¿dónde está el main?" }),
    });
    const qaBody = await qa.json();
    assert.equal(qa.status, 200);
    assert.equal(qaBody.needs_hitl, false);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test("misión de código con Comando: arma HITL sin LLM", async () => {
  let llmHits = 0;
  const { engine, session, root } = codingStack({
    llm: {
      complete: async () => {
        llmHits += 1;
        return {
          content: "Pido Aprobar la misión de código. Tocá Aprobar.",
          tool_calls: [],
        };
      },
    },
  });
  session.patch("110", {
    slug: "hbauzan-semantic-firewall",
    url: "https://github.com/hbauzan/semantic-firewall.git",
  });
  const body = await engine.handleChat({
    chat_id: "110",
    text: [
      "OK confirmado. No hay harness de Etapa 6: creá backend/tests/test_embedder_determinism.py.",
      "",
      "Comando: cd backend && uv run pytest -q tests/test_embedder_determinism.py",
    ].join("\n"),
  });
  assert.equal(body.needs_hitl, true);
  assert.equal(body.hitl.kind, "code");
  assert.match(body.hitl.approve_data, /^APPROVE_CODE:[a-f0-9]{16}$/);
  assert.equal(llmHits, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("prosa Pido Aprobar del LLM sin tool no manda teclado falso", async () => {
  const { engine, session, root } = codingStack({
    llm: {
      complete: async () => ({
        content: "Pido Aprobar la misión de código. Tocá Aprobar.",
        tool_calls: [],
      }),
    },
  });
  session.patch("111", {
    slug: "hbauzan-semantic-firewall",
    url: "https://github.com/hbauzan/semantic-firewall.git",
  });
  const body = await engine.handleChat({
    chat_id: "111",
    text: "¿dónde está el main?",
  });
  assert.equal(body.needs_hitl, false);
  assert.equal(/pido aprobar|toc[aá] aprobar/i.test(body.reply), false);
  assert.match(body.reply, /Comando:/);
  assert.match(body.reply, /granjero de vacas/i);
  fs.rmSync(root, { recursive: true, force: true });
});

test("plan L01 del LLM con Test: arma HITL de verdad, no pregunta la tarjeta", async () => {
  const { engine, session, root } = codingStack({
    llm: {
      complete: async () => ({
        content: [
          "Ahí está, patrón: la rama existe.",
          "o sea push permitido.",
          "Para arrancar necesito que apruebes la misión de código.",
          "- Test: cd backend && uv run pytest -q tests/test_embedder_determinism.py",
          "¿Te re-disparo la tarjeta de propose_code_mission para el botón Aprobar?",
        ].join("\n"),
        tool_calls: [],
      }),
    },
  });
  session.patch("112", {
    slug: "hbauzan-semantic-firewall",
    url: "https://github.com/hbauzan/semantic-firewall.git",
  });
  const body = await engine.handleChat({
    chat_id: "112",
    text: "cómo está la rama",
  });
  assert.equal(body.needs_hitl, true);
  assert.equal(body.hitl.kind, "code");
  assert.match(body.hitl.approve_data, /^APPROVE_CODE:[a-f0-9]{16}$/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("si después de un plan con Test: confirma HITL sin LLM", async () => {
  let llmHits = 0;
  const { engine, session, root } = codingStack({
    llm: {
      complete: async () => {
        llmHits += 1;
        return {
          content: [
            "Núcleo: leí el repo.",
            "Test: cd backend && uv run pytest -q tests/test_embedder_determinism.py",
            "Cuando quieras arrancamos.",
          ].join("\n"),
          tool_calls: [],
        };
      },
    },
  });
  session.patch("113", {
    slug: "hbauzan-semantic-firewall",
    url: "https://github.com/hbauzan/semantic-firewall.git",
  });
  const first = await engine.handleChat({
    chat_id: "113",
    text: "cómo está la rama",
  });
  assert.equal(first.needs_hitl, false);
  const confirmed = await engine.handleChat({ chat_id: "113", text: "si" });
  assert.equal(confirmed.needs_hitl, true);
  assert.equal(confirmed.hitl.kind, "code");
  assert.equal(llmHits, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("si suelto sin plan ofrece receta Murray, no teclado falso", async () => {
  let llmHits = 0;
  const { engine, session, root } = codingStack({
    llm: {
      complete: async () => {
        llmHits += 1;
        return { content: "Núcleo: todo healthy.", tool_calls: [] };
      },
    },
  });
  session.patch("114", {
    slug: "hbauzan-semantic-firewall",
    url: "https://github.com/hbauzan/semantic-firewall.git",
  });
  await engine.handleChat({ chat_id: "114", text: "cómo está la rama" });
  const body = await engine.handleChat({ chat_id: "114", text: "si" });
  assert.equal(body.needs_hitl, false);
  assert.match(body.reply, /Comando:/);
  assert.match(body.reply, /granjero de vacas/i);
  assert.equal(/pido aprobar|toc[aá] aprobar/i.test(body.reply), false);
  assert.equal(llmHits, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("mutate sin comando de test no va al LLM: ofrece receta", async () => {
  let llmHits = 0;
  const { engine, session, root } = codingStack({
    llm: {
      complete: async () => {
        llmHits += 1;
        return { content: "no", tool_calls: [] };
      },
    },
  });
  session.patch("115", {
    slug: "hbauzan-semantic-firewall",
    url: "https://github.com/hbauzan/semantic-firewall.git",
  });
  const body = await engine.handleChat({
    chat_id: "115",
    text: "creá backend/tests/test_embedder_determinism.py",
  });
  assert.equal(body.needs_hitl, false);
  assert.equal(llmHits, 0);
  assert.match(body.reply, /Comando:/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("no me da los botones ofrece receta sin LLM", async () => {
  let llmHits = 0;
  const { engine, session, root } = codingStack({
    llm: {
      complete: async () => {
        llmHits += 1;
        return { content: "no", tool_calls: [] };
      },
    },
  });
  session.patch("116", {
    slug: "hbauzan-semantic-firewall",
    url: "https://github.com/hbauzan/semantic-firewall.git",
  });
  const body = await engine.handleChat({
    chat_id: "116",
    text: "no me da los botones",
  });
  assert.equal(body.needs_hitl, false);
  assert.equal(llmHits, 0);
  assert.match(body.reply, /Comando:/);
  assert.match(body.reply, /\/jobs/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("code HITL no llama OpenHands hasta Aprobar; reject tampoco", async () => {
  const starts = [];
  const { engine, session, root } = codingStack({
    openhands: {
      startConversation: async () => {
        starts.push("start");
        return { id: "t", status: "READY", app_conversation_id: "c" };
      },
    },
  });
  session.patch("12", {
    slug: "octocat-Hello-World",
    url: "https://github.com/octocat/Hello-World.git",
  });
  const engineWithLlm = engine;
  const proposed = await engineWithLlm.dispatchTool(
    "propose_code_mission",
    { instruction: "agregá un healthcheck HTTP", test_command: "npm test" },
    { chatId: "12" }
  );
  assert.equal(proposed.needs_hitl, true);
  assert.equal(proposed.hitl.kind, "code");
  const rejected = await engine.handleWorkspaceHitl({
    chat_id: "12",
    callback_data: proposed.hitl.reject_data,
  });
  assert.match(rejected.reply, /RECHAZADA/);
  assert.equal(starts.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("code approve arranca OpenHands y poll termina", async () => {
  const { engine, session, worker, notes, root } = codingStack();
  session.patch("13", {
    slug: "octocat-Hello-World",
    url: "https://github.com/octocat/Hello-World.git",
  });
  const proposed = await engine.dispatchTool(
    "propose_code_mission",
    { instruction: "agregá un healthcheck HTTP", test_command: "npm test", files_plan: "server.js" },
    { chatId: "13" }
  );
  const hitl = await engine.handleWorkspaceHitl({
    chat_id: "13",
    callback_data: proposed.hitl.approve_data,
  });
  assert.equal(hitl.needs_job, true);
  await worker.kick(hitl.job_id);
  const due = (await import("../config/murray-agent/jobs.mjs")).createJobStore;
  assert.ok(due);
  const pollJobs = notes;
  await worker.drain();
  await worker.drain();
  assert.equal(notes.some((row) => /Misión lista|OpenHands arrancó/.test(row.text)), true);
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(pollJobs);
});

test("stuck HITL ofrece opciones y no pushea", async () => {
  const { engine, session, worker, notes, jobs, root } = codingStack({
    openhands: {
      startConversation: async () => ({
        id: "task1",
        status: "READY",
        app_conversation_id: "conv-stuck",
      }),
      getStartTask: async () => ({
        status: "READY",
        app_conversation_id: "conv-stuck",
      }),
      getConversation: async () => ({
        execution_status: "stuck",
        sandbox_status: "RUNNING",
      }),
      searchEvents: async () => [],
      gitChanges: async () => ({}),
    },
  });
  session.patch("14", { slug: "octocat-Hello-World", url: "https://github.com/x/y.git" });
  const proposed = await engine.dispatchTool(
    "propose_code_mission",
    { instruction: "romper tests a propósito para el stuck", test_command: "npm test" },
    { chatId: "14" }
  );
  const hitl = await engine.handleWorkspaceHitl({
    chat_id: "14",
    callback_data: proposed.hitl.approve_data,
  });
  await worker.kick(hitl.job_id);
  await worker.drain();
  await worker.drain();
  const stuckNote = notes.find((row) => row.buttons);
  assert.ok(stuckNote);
  const retry = stuckNote.buttons[0][0].callback_data;
  assert.match(retry, /^STUCK_RETRY:/);
  assert.equal(retry.length <= 64, true);
  const stop = await engine.handleWorkspaceHitl({
    chat_id: "14",
    callback_data: stuckNote.buttons[0][1].callback_data,
  });
  assert.match(stop.reply, /Paré/);
  fs.rmSync(root, { recursive: true, force: true });
  assert.ok(jobs);
});

test("stuck RETRY con error re-encola misión limpia sin followUp", async () => {
  const { engine, session, worker, notes, root, jobs } = codingStack({
    openhands: {
      startConversation: async () => ({ id: "task-err-1", app_conversation_id: "conv-err-1" }),
      getConversation: async () => ({
        execution_status: "error",
        sandbox_status: "RUNNING",
      }),
      searchEvents: async () => [],
      gitChanges: async () => ({}),
    },
  });
  session.patch("15", { slug: "octocat-Hello-World", url: "https://github.com/x/y.git" });
  const proposed = await engine.dispatchTool(
    "propose_code_mission",
    { instruction: "test retry", test_command: "npm test" },
    { chatId: "15" }
  );
  const hitl = await engine.handleWorkspaceHitl({
    chat_id: "15",
    callback_data: proposed.hitl.approve_data,
  });
  await worker.kick(hitl.job_id);
  await worker.drain();
  await worker.drain();
  const stuckNote = notes.find((row) => row.buttons && row.buttons[0][0].text === "Reintentar");
  assert.ok(stuckNote);
  const retryBtn = stuckNote.buttons[0][0].callback_data;
  const retryResult = await engine.handleWorkspaceHitl({
    chat_id: "15",
    callback_data: retryBtn,
  });
  assert.equal(retryResult.needs_job, true);
  const retriedJob = jobs.get(retryResult.job_id);
  assert.equal(retriedJob.payload.followUp, false);
  assert.equal(retriedJob.payload.startTaskId, "task-err-1");
  fs.rmSync(root, { recursive: true, force: true });
});

test("slash /workspace lista disco; borrar pide HITL y ejecuta", async () => {
  const { engine, session, worker, notes, root } = codingStack();
  const slug = "octocat-Hello-World";
  fs.mkdirSync(path.join(root, slug), { recursive: true });
  fs.writeFileSync(path.join(root, slug, "README.md"), "hola\n");
  session.patch("21", { slug, url: "https://github.com/octocat/Hello-World.git" });
  const listed = await engine.handleChat({ chat_id: "21", text: "/workspace" });
  assert.match(listed.reply, /octocat-Hello-World/);
  const proposed = await engine.handleChat({
    chat_id: "21",
    text: "borrá octocat-Hello-World",
  });
  assert.equal(proposed.needs_hitl, true);
  assert.equal(proposed.hitl.kind, "delete");
  assert.match(proposed.hitl.approve_data, /^APPROVE_DELETE:[a-f0-9]{16}$/);
  assert.equal(proposed.hitl.approve_data.length <= 64, true);
  const rejected = await engine.handleWorkspaceHitl({
    chat_id: "21",
    callback_data: proposed.hitl.reject_data,
  });
  assert.match(rejected.reply, /RECHAZADO/);
  assert.equal(fs.existsSync(path.join(root, slug)), true);
  const again = await engine.handleChat({
    chat_id: "21",
    text: "borrá octocat-Hello-World",
  });
  const hitl = await engine.handleWorkspaceHitl({
    chat_id: "21",
    callback_data: again.hitl.approve_data,
  });
  assert.equal(hitl.needs_job, true);
  await worker.kick(hitl.job_id);
  assert.equal(fs.existsSync(path.join(root, slug)), false);
  assert.equal(session.get("21").slug, "");
  assert.equal(notes.some((row) => /Borré/.test(row.text)), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("push en main no HITL; en feature HITL y job", async () => {
  const onMain = codingStack({ branch: "main" });
  onMain.session.patch("22", {
    slug: "octocat-Hello-World",
    url: "https://github.com/octocat/Hello-World.git",
  });
  fs.mkdirSync(path.join(onMain.root, "octocat-Hello-World"), { recursive: true });
  const blocked = await onMain.engine.handleChat({ chat_id: "22", text: "pusheá" });
  assert.equal(blocked.needs_hitl, false);
  assert.match(blocked.reply, /main/);
  fs.rmSync(onMain.root, { recursive: true, force: true });

  const { engine, session, worker, notes, root } = codingStack({ branch: "feat/disk" });
  session.patch("23", {
    slug: "octocat-Hello-World",
    url: "https://github.com/octocat/Hello-World.git",
  });
  fs.mkdirSync(path.join(root, "octocat-Hello-World"), { recursive: true });
  const proposed = await engine.handleChat({ chat_id: "23", text: "pusheá" });
  assert.equal(proposed.needs_hitl, true);
  assert.equal(proposed.hitl.kind, "push");
  assert.match(proposed.hitl.approve_data, /^APPROVE_PUSH:[a-f0-9]{16}$/);
  const hitl = await engine.handleWorkspaceHitl({
    chat_id: "23",
    callback_data: proposed.hitl.approve_data,
  });
  assert.equal(hitl.needs_job, true);
  await worker.kick(hitl.job_id);
  assert.equal(notes.some((row) => /Push listo/.test(row.text)), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("/jobs lista y detalla sin LLM; error y log de 20 líneas", async () => {
  let llmHits = 0;
  const { engine, session, jobs, root } = codingStack({
    llm: {
      complete: async () => {
        llmHits += 1;
        return { content: "no", tool_calls: [] };
      },
    },
  });
  session.patch("30", {
    slug: "octocat-Hello-World",
    url: "https://github.com/octocat/Hello-World.git",
  });
  fs.mkdirSync(path.join(root, "octocat-Hello-World"), { recursive: true });
  const pulled = await engine.handleChat({ chat_id: "30", text: "hacé pull" });
  assert.match(pulled.reply, /Si te pica la impaciencia: \/jobs/);
  const listed = await engine.handleChat({ chat_id: "30", text: "/jobs" });
  assert.equal(listed.needs_hitl, false);
  assert.equal(llmHits, 0);
  assert.match(listed.reply, /pull/);
  assert.equal(listed.reply.includes(pulled.job_id), true);
  const failed = jobs.enqueue({
    type: "code",
    chatId: "30",
    payload: { slug: "octocat-Hello-World" },
  });
  for (let i = 1; i <= 25; i += 1) {
    jobs.appendLog(failed.id, `trace ${i}`);
  }
  jobs.update(failed.id, { status: "failed", error: "openhands_timeout" });
  const detail = await engine.handleChat({
    chat_id: "30",
    text: `/jobs ${failed.id}`,
  });
  assert.equal(llmHits, 0);
  assert.match(detail.reply, /openhands_timeout/);
  assert.match(detail.reply, /trace 25/);
  assert.equal(/trace 1\b/.test(detail.reply), false);
  const spoken = await engine.handleChat({
    chat_id: "30",
    text: "estado de los jobs",
  });
  assert.equal(llmHits, 0);
  assert.match(spoken.reply, /failed/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("pull sin HITL encola job", async () => {
  const { engine, session, worker, notes, root } = codingStack();
  session.patch("24", {
    slug: "octocat-Hello-World",
    url: "https://github.com/octocat/Hello-World.git",
  });
  fs.mkdirSync(path.join(root, "octocat-Hello-World"), { recursive: true });
  const pulled = await engine.handleChat({ chat_id: "24", text: "hacé pull" });
  assert.equal(pulled.needs_hitl, false);
  assert.equal(pulled.needs_job, true);
  assert.match(pulled.reply, /\/jobs/);
  await worker.kick(pulled.job_id);
  assert.equal(notes.some((row) => /Pull listo/.test(row.text)), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("sandbox PAUSED limpio avisa stuck HITL, no misión lista", async () => {
  const { engine, session, worker, notes, jobs, root } = codingStack({
    statusStdout: "## feat/disk\n",
    openhands: {
      getConversation: async () => ({
        execution_status: null,
        sandbox_status: "PAUSED",
      }),
    },
  });
  fs.mkdirSync(path.join(root, "octocat-Hello-World"), { recursive: true });
  session.patch("40", {
    slug: "octocat-Hello-World",
    url: "https://github.com/octocat/Hello-World.git",
  });
  const proposed = await engine.dispatchTool(
    "propose_code_mission",
    { instruction: "creá test_embedder_determinism.py", test_command: "pytest" },
    { chatId: "40" }
  );
  const hitl = await engine.handleWorkspaceHitl({
    chat_id: "40",
    callback_data: proposed.hitl.approve_data,
  });
  await worker.kick(hitl.job_id);
  await worker.drain();
  await worker.drain();
  const stuckNote = notes.find((row) => /sandbox_paused/.test(row.text));
  assert.ok(stuckNote);
  assert.ok(stuckNote.buttons);
  assert.equal(notes.some((row) => /Misión lista/.test(row.text)), false);
  const poll = jobs.list({ chatId: "40" }).find((job) => job.type === "oh_poll");
  assert.equal(poll.status, "stuck");
  fs.rmSync(root, { recursive: true, force: true });
});

test("sandbox PAUSED con cambios avisa pausa y no finge listo", async () => {
  const { engine, session, worker, notes, jobs, root } = codingStack({
    openhands: {
      getConversation: async () => ({
        execution_status: null,
        sandbox_status: "PAUSED",
      }),
    },
  });
  fs.mkdirSync(path.join(root, "octocat-Hello-World"), { recursive: true });
  session.patch("41", {
    slug: "octocat-Hello-World",
    url: "https://github.com/octocat/Hello-World.git",
  });
  const proposed = await engine.dispatchTool(
    "propose_code_mission",
    { instruction: "tocá README", test_command: "npm test" },
    { chatId: "41" }
  );
  const hitl = await engine.handleWorkspaceHitl({
    chat_id: "41",
    callback_data: proposed.hitl.approve_data,
  });
  await worker.kick(hitl.job_id);
  await worker.drain();
  await worker.drain();
  assert.equal(notes.some((row) => /Misión lista/.test(row.text)), false);
  assert.equal(notes.some((row) => /pausó|PAUSED|cambios/.test(row.text)), true);
  assert.equal(
    notes.some((row) => row.buttons && /STUCK_RETRY/.test(row.buttons[0][0].callback_data)),
    false
  );
  const poll = jobs.list({ chatId: "41" }).find((job) => job.type === "oh_poll");
  assert.equal(poll.status, "paused");
  assert.equal(poll.error, "sandbox_paused");
  fs.rmSync(root, { recursive: true, force: true });
});

test("tres fallos de poll marcan stuck; un 23 suelto no", async () => {
  let polls = 0;
  const { engine, session, worker, notes, jobs, root } = codingStack({
    pollDelayMs: 0,
    openhands: {
      getConversation: async () => {
        polls += 1;
        throw Object.assign(new Error("23"), { code: 23 });
      },
    },
  });
  session.patch("42", {
    slug: "octocat-Hello-World",
    url: "https://github.com/octocat/Hello-World.git",
  });
  const proposed = await engine.dispatchTool(
    "propose_code_mission",
    { instruction: "agregá un healthcheck HTTP", test_command: "npm test" },
    { chatId: "42" }
  );
  const hitl = await engine.handleWorkspaceHitl({
    chat_id: "42",
    callback_data: proposed.hitl.approve_data,
  });
  await worker.kick(hitl.job_id);
  const poll = jobs.list({ chatId: "42" }).find((job) => job.type === "oh_poll");
  assert.equal(poll.status, "queued");
  assert.match(String(poll.error || ""), /^$/);
  await worker.drain();
  await worker.drain();
  const stuck = jobs.get(poll.id);
  assert.equal(stuck.status, "stuck");
  assert.match(stuck.error, /poll_error/);
  assert.equal(polls >= 3, true);
  assert.equal(notes.some((row) => /poll_error/.test(row.text)), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("seguí con L01 re-arma HITL desde lastMission sin LLM", async () => {
  let llmHits = 0;
  const { engine, session, root } = codingStack({
    llm: {
      complete: async () => {
        llmHits += 1;
        return { content: "no", tool_calls: [] };
      },
    },
  });
  session.patch("43", {
    slug: "hbauzan-semantic-firewall",
    url: "https://github.com/hbauzan/semantic-firewall.git",
    lastMission: "Crear backend/tests/test_embedder_determinism.py (N=100).",
    lastTestCommand: "cd backend && uv run pytest -q tests/test_embedder_determinism.py",
  });
  const body = await engine.handleChat({ chat_id: "43", text: "seguí con L01" });
  assert.equal(llmHits, 0);
  assert.equal(body.needs_hitl, true);
  assert.equal(body.hitl.kind, "code");
  assert.match(body.reply, /test_embedder_determinism/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("qué pasó con UUID de OpenHands diagnostica sin LLM", async () => {
  let llmHits = 0;
  const { engine, session, jobs, root } = codingStack({
    llm: {
      complete: async () => {
        llmHits += 1;
        return { content: "no", tool_calls: [] };
      },
    },
    openhands: {
      getConversation: async () => ({
        execution_status: null,
        sandbox_status: "PAUSED",
      }),
    },
  });
  session.patch("44", {
    slug: "hbauzan-semantic-firewall",
    lastJobId: "",
  });
  const job = jobs.enqueue({
    type: "oh_poll",
    chatId: "44",
    payload: {
      slug: "hbauzan-semantic-firewall",
      conversationId: "460fdf35f8e54fb996d8c52d9eb01057",
      startTaskId: "d02a1ede8b1643f28c27715a9c82ed6d",
    },
  });
  jobs.update(job.id, { status: "queued", error: "" });
  const spoken = await engine.handleChat({
    chat_id: "44",
    text: "en qué quedó task 460fdf35f8e54fb996d8c52d9eb01057",
  });
  assert.equal(llmHits, 0);
  assert.match(spoken.reply, new RegExp(job.id));
  assert.match(spoken.reply, /PAUSED/i);
  const bySlash = await engine.handleChat({
    chat_id: "44",
    text: "/jobs 460fdf35f8e54fb996d8c52d9eb01057",
  });
  assert.equal(llmHits, 0);
  assert.match(bySlash.reply, new RegExp(job.id));
  fs.rmSync(root, { recursive: true, force: true });
});

test("finished con git vacío es empty_finish, no misión lista", async () => {
  const { engine, session, worker, notes, jobs, root } = codingStack({
    statusStdout: "## feat/disk\n",
    openhands: {
      gitChanges: async () => ({ items: [] }),
    },
  });
  fs.mkdirSync(path.join(root, "octocat-Hello-World"), { recursive: true });
  session.patch("50", {
    slug: "octocat-Hello-World",
    url: "https://github.com/octocat/Hello-World.git",
  });
  const proposed = await engine.dispatchTool(
    "propose_code_mission",
    { instruction: "creá test_embedder_determinism.py", test_command: "pytest" },
    { chatId: "50" }
  );
  const hitl = await engine.handleWorkspaceHitl({
    chat_id: "50",
    callback_data: proposed.hitl.approve_data,
  });
  await worker.kick(hitl.job_id);
  await worker.drain();
  await worker.drain();
  assert.equal(notes.some((row) => /Misión lista/.test(row.text)), false);
  assert.equal(notes.some((row) => /empty_finish/.test(row.text)), true);
  const poll = jobs.list({ chatId: "50" }).find((job) => job.type === "oh_poll");
  assert.equal(poll.status, "stuck");
  assert.equal(poll.error, "empty_finish");
  fs.rmSync(root, { recursive: true, force: true });
});

test("dos sandboxes vivos no arrancan un tercero", async () => {
  const starts = [];
  const { engine, session, worker, notes, jobs, root } = codingStack({
    ops: {
      listOpenHandsSandboxes: async () => [
        { id: "aaa111", name: "oh-agent-server-a", running: true, status: "Up 1 minute" },
        { id: "bbb222", name: "oh-agent-server-b", running: true, status: "Up 1 minute" },
      ],
    },
    openhands: {
      startConversation: async () => {
        starts.push("start");
        return { id: "t", app_conversation_id: "c" };
      },
    },
  });
  session.patch("51", {
    slug: "octocat-Hello-World",
    url: "https://github.com/octocat/Hello-World.git",
  });
  const proposed = await engine.dispatchTool(
    "propose_code_mission",
    { instruction: "agregá un healthcheck HTTP", test_command: "npm test" },
    { chatId: "51" }
  );
  const hitl = await engine.handleWorkspaceHitl({
    chat_id: "51",
    callback_data: proposed.hitl.approve_data,
  });
  await worker.kick(hitl.job_id);
  assert.equal(starts.length, 0);
  const codeJob = jobs.get(hitl.job_id);
  assert.equal(codeJob.status, "stuck");
  assert.equal(codeJob.error, "sandbox_busy");
  assert.equal(notes.some((row) => /sandbox_busy/.test(row.text)), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("code job con startTaskId no abre otra conversación", async () => {
  const starts = [];
  const { jobs, worker, root } = codingStack({
    openhands: {
      startConversation: async () => {
        starts.push("start");
        return { id: "t2", app_conversation_id: "c2" };
      },
    },
  });
  const job = jobs.enqueue({
    type: "code",
    chatId: "52",
    payload: {
      slug: "octocat-Hello-World",
      instruction: "creá un test",
      testCommand: "npm test",
      startTaskId: "already-started",
    },
  });
  await worker.kick(job.id);
  assert.equal(starts.length, 0);
  assert.equal(jobs.get(job.id).status, "done");
  fs.rmSync(root, { recursive: true, force: true });
});

test("/triage y qué pasa diagnostican sin LLM y piden heal HITL", async () => {
  let llmHits = 0;
  const { engine, jobs, root } = codingStack({
    llm: {
      complete: async () => {
        llmHits += 1;
        return { content: "no", tool_calls: [] };
      },
    },
    ops: {
      listOpenHandsSandboxes: async () => [
        {
          id: "abc123def456",
          name: "oh-agent-server-zombie",
          running: true,
          status: "Up 23 hours",
          exitCode: null,
        },
        {
          id: "aaa111bbb222",
          name: "oh-agent-server-dead",
          running: false,
          status: "Exited (137) 1 minute ago",
          exitCode: 137,
        },
      ],
      memorySnapshot: async () => ({ usedMiB: 3600, limitMiB: 3826 }),
    },
  });
  jobs.enqueue({
    type: "code",
    chatId: "53",
    payload: { slug: "hbauzan-semantic-firewall" },
    log: [
      "OpenHands arrancó (task 94135884d0f84143aa95d700e70ea645).",
      "OpenHands arrancó (task f860e3adbd324a1bbb29e5f746366519).",
    ],
  });
  jobs.update(jobs.list({ chatId: "53" })[0].id, { status: "done" });
  const spoken = await engine.handleChat({ chat_id: "53", text: "Murray, qué pasa?" });
  assert.equal(llmHits, 0);
  assert.equal(spoken.needs_hitl, true);
  assert.equal(spoken.hitl.action, "heal_openhands");
  assert.match(spoken.hitl.approve_data, /^APPROVE_OPS:[a-f0-9]{16}$/);
  assert.match(spoken.reply, /zombie_sandbox|sandbox_oom_137|double_start/);
  assert.equal(spoken.reply.includes("ConversationStateUpdateEvent"), false);
  const slash = await engine.handleChat({ chat_id: "53", text: "/triage" });
  assert.equal(llmHits, 0);
  assert.equal(slash.needs_hitl, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("healOpenHands solo rm oh-agent-server y restart openhands", async () => {
  const seen = [];
  const ops = createOps({
    runCommand: async (args) => {
      seen.push(args);
      if (args[0] === "ps") {
        return {
          code: 0,
          stdout: [
            "abc123def456 oh-agent-server-foo Exited (137) 1 minute ago",
            "ffffeeeeaaaa murray-postgres Up 2 days",
            "bbbbccccdddd murray-openhands Up 2 days",
          ].join("\n"),
          stderr: "",
        };
      }
      return { code: 0, stdout: "ok", stderr: "" };
    },
    project: "murray-infra",
    composeFile: "/opt/stack/docker-compose.yml",
    projectDir: "/opt/stack",
  });
  const result = await ops.healOpenHands();
  assert.deepEqual(result.removed, ["oh-agent-server-foo"]);
  const rm = seen.find((args) => args[0] === "rm");
  assert.deepEqual(rm, ["rm", "-f", "abc123def456"]);
  assert.equal(seen.some((args) => args.includes("murray-postgres")), false);
  assert.equal(seen.some((args) => args.includes("ffffeeeeaaaa")), false);
  assert.equal(seen.some((args) => args.includes("restart") && args.at(-1) === "openhands"), true);
});

test("executeOps heal_openhands purga y restart; reject no toca Docker", async () => {
  const seen = [];
  const approvals = createApprovalStore();
  const ops = createOps({
    runCommand: async (args) => {
      seen.push(args);
      if (args[0] === "ps") {
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "restarted", stderr: "" };
    },
  });
  const engine = createChatEngine({
    ops,
    approvals,
    memory: memoryStub(),
    llm: { complete: async () => ({ content: "no", tool_calls: [] }) },
    gmailMeta: async () => ({ unread_count: 0 }),
    readDoc: () => "",
    personaText: "x",
  });
  const id = approvals.issue({ kind: "ops", action: "heal_openhands", service: "openhands" });
  const rejected = await engine.rejectOps({ approval_id: id });
  assert.match(rejected.reply, /RECHAZADA/);
  assert.equal(seen.length, 0);
  const id2 = approvals.issue({ kind: "ops", action: "heal_openhands", service: "openhands" });
  const done = await engine.executeOps({ approval_id: id2 });
  assert.match(done.reply, /heal_openhands/);
  assert.equal(seen.some((args) => args.includes("restart")), true);
  assert.equal(seen.some((args) => args[0] === "rm"), false);
});

test("propose_ops del LLM no acepta heal_openhands", async () => {
  const { engine } = makeEngine();
  const result = await engine.dispatchTool(
    "propose_ops",
    { action: "heal_openhands", service: "openhands" },
    { chatId: "99" }
  );
  assert.equal(result.needs_hitl, undefined);
  assert.equal(result.payload.error, "action_denied");
});

test("/manual y /help devuelven el manual operativo estructurado", async () => {
  const { engine, root } = codingStack();
  const res1 = await engine.handleChat({ chat_id: "60", text: "/manual" });
  assert.match(res1.reply, /MANUAL OPERATIVO DE MURRAY/);
  assert.match(res1.reply, /Diagnóstico.*Control del Stack/);
  assert.match(res1.reply, /Control de Cerebros/);
  assert.match(res1.reply, /Espacio de Trabajo.*Git/);
  assert.match(res1.reply, /Misiones de Código para Garfio/);

  const res2 = await engine.handleChat({ chat_id: "60", text: "/help" });
  assert.match(res2.reply, /MANUAL OPERATIVO DE MURRAY/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("texto natural 'manual' o 'ayuda' devuelve el manual sin pasar por LLM", async () => {
  let llmCalled = false;
  const { engine, root } = codingStack({
    llm: {
      complete: async () => {
        llmCalled = true;
        return { content: "llm called", tool_calls: [] };
      },
    },
  });
  const res = await engine.handleChat({ chat_id: "61", text: "ayuda con los comandos" });
  assert.equal(llmCalled, false);
  assert.match(res.reply, /MANUAL OPERATIVO DE MURRAY/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("/garfio model y /cerebro consultan y trasplantan el cerebro de Garfio", async () => {
  const { engine, session, root } = codingStack();
  // 1. Consultar sin modelo
  const q1 = await engine.handleChat({ chat_id: "70", text: "/garfio model" });
  assert.match(q1.reply, /Cerebro actual de Garfio/);
  assert.match(q1.reply, /garfio-worker/);

  // 2. Modelo inválido
  const inv = await engine.handleChat({ chat_id: "70", text: "/garfio model skynet-9000" });
  assert.match(inv.reply, /Ese lóbulo no entra en el cráneo/);

  // 3. Cambiar a deepseek-chat
  const set1 = await engine.handleChat({ chat_id: "70", text: "/garfio model deepseek-chat" });
  assert.match(set1.reply, /IT'S ALIVE/);
  assert.match(set1.reply, /deepseek-chat/);
  assert.equal(session.get("70").garfio_model, "deepseek-chat");

  // 4. Cambiar vía /cerebro gemini-3.8-flash
  const set2 = await engine.handleChat({ chat_id: "70", text: "/cerebro gemini-3.8-flash" });
  assert.match(set2.reply, /IT'S ALIVE/);
  assert.match(set2.reply, /gemini-3.8-flash/);
  assert.equal(session.get("70").garfio_model, "gemini-3.8-flash");

  // 5. Cambiar vía lenguaje natural
  const set3 = await engine.handleChat({ chat_id: "70", text: "cambiale el cerebro a garfio por deepseek-reasoner" });
  assert.match(set3.reply, /IT'S ALIVE/);
  assert.match(set3.reply, /deepseek-reasoner/);
  assert.equal(session.get("70").garfio_model, "deepseek-reasoner");
  fs.rmSync(root, { recursive: true, force: true });
});

test("misión de código pasa llmModel de Garfio a openhands.startConversation", async () => {
  let capturedModel = null;
  const { engine, session, worker, notes, root } = codingStack({
    openhands: {
      startConversation: async ({ llmModel }) => {
        capturedModel = llmModel;
        return { id: "task-123", app_conversation_id: "app-123" };
      },
      detectStuck: () => null,
      isSandboxPaused: () => false,
      isAgentDone: () => false,
      summarizeEvents: () => ({ error: "", lastMessage: "", lastAction: "", fileChanges: [] }),
    },
  });
  fs.mkdirSync(path.join(root, "test-repo"), { recursive: true });
  session.patch("75", {
    slug: "test-repo",
    url: "https://github.com/octocat/test-repo.git",
    garfio_model: "gemini-3.8-flash",
  });
  const proposed = await engine.dispatchTool(
    "propose_code_mission",
    { instruction: "agregar endpoint", test_command: "npm test" },
    { chatId: "75" }
  );
  const hitl = await engine.handleWorkspaceHitl({
    chat_id: "75",
    callback_data: proposed.hitl.approve_data,
  });
  await worker.kick(hitl.job_id);
  assert.equal(capturedModel, "gemini-3.8-flash");
  assert.equal(notes.some((n) => n.text.includes("[cerebro: gemini-3.8-flash]")), true);
  fs.rmSync(root, { recursive: true, force: true });
});
