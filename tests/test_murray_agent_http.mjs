import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createApprovalStore } from "../config/murray-agent/approvals.mjs";
import { createChatEngine } from "../config/murray-agent/chat.mjs";
import { fetchGmailMeta } from "../config/murray-agent/gmail-meta.mjs";
import { createMemory } from "../config/murray-agent/memory.mjs";
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
  const filePath = path.join(os.tmpdir(), `murray-mem-${Date.now()}.json`);
  const mem = createMemory({ filePath });
  for (let i = 0; i < 25; i += 1) {
    mem.append("c1", "user", `m${i}`);
  }
  const rows = mem.get("c1");
  assert.equal(rows.length, 20);
  assert.equal(rows[0].content, "m5");
  fs.unlinkSync(filePath);
});
