import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createApprovalStore } from "../config/murray-agent/approvals.mjs";
import { createChatEngine } from "../config/murray-agent/chat.mjs";
import { openMurrayDb } from "../config/murray-agent/db.mjs";
import {
  ALLOWED_MODELS,
  createLlm,
  DEFAULT_CHAT_MODEL,
  resolveChatModel,
} from "../config/murray-agent/llm.mjs";
import { createOps } from "../config/murray-agent/ops.mjs";
import { createSessionStore } from "../config/murray-agent/session.mjs";

function tmpSession() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-llm-"));
  const db = openMurrayDb({ filePath: path.join(dir, "murray.db") });
  return { dir, db, session: createSessionStore({ db }) };
}

function engineFor(session, llm) {
  return createChatEngine({
    ops: createOps({
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    }),
    llm,
    memory: { get: () => [], append: () => {} },
    approvals: createApprovalStore(),
    session,
    gmailMeta: async () => ({ unread_count: 0 }),
    readDoc: () => "",
    personaText: "x",
  });
}

test("/model lista permitidos y murray-chat si vacío", async () => {
  const { dir, db, session } = tmpSession();
  const engine = engineFor(session, {
    complete: async () => ({ content: "no", tool_calls: [] }),
  });
  const listed = await engine.handleChat({ chat_id: "1", text: "/model" });
  assert.match(listed.reply, /murray-chat|Modelo activo/);
  for (const name of ALLOWED_MODELS) {
    assert.match(listed.reply, new RegExp(name));
  }
  assert.equal(session.get("1").active_model, "");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("/model válido escribe active_model; inválido no toca la DB", async () => {
  const { dir, db, session } = tmpSession();
  session.patch("7", { slug: "repo-a" });
  const engine = engineFor(session, {
    complete: async () => ({ content: "no", tool_calls: [] }),
  });
  const set = await engine.handleChat({
    chat_id: "7",
    text: "/model gemini-3.8-flash",
  });
  assert.match(set.reply, /gemini-3.8-flash/);
  assert.equal(session.get("7").active_model, "gemini-3.8-flash");
  assert.equal(session.get("7").slug, "repo-a");

  const retired = await engine.handleChat({
    chat_id: "7",
    text: "/model gemini-2.5-flash",
  });
  assert.match(retired.reply, /inválido/);
  assert.equal(session.get("7").active_model, "gemini-3.8-flash");

  const bad = await engine.handleChat({
    chat_id: "7",
    text: "/model gpt-4o",
  });
  assert.match(bad.reply, /inválido/);
  assert.equal(session.get("7").active_model, "gemini-3.8-flash");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("complete() usa el modelo del store y pega al gateway mock", async () => {
  const { dir, db, session } = tmpSession();
  session.patch("3", { active_model: "deepseek-reasoner" });
  const seen = [];
  const llm = createLlm({
    apiKey: "sk-test-master-not-a-placeholder",
    baseUrl: "http://litellm:4000",
    fetchImpl: async (url, opts) => {
      seen.push({ url, body: JSON.parse(opts.body) });
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "núcleo", tool_calls: [] } }],
        }),
      };
    },
  });
  const engine = engineFor(session, llm);
  const out = await engine.handleChat({ chat_id: "3", text: "hola" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "http://litellm:4000/chat/completions");
  assert.equal(seen[0].body.model, "deepseek-reasoner");
  assert.match(out.reply, /núcleo/);

  session.patch("3", { active_model: "" });
  await engine.handleChat({ chat_id: "3", text: "otra" });
  assert.equal(seen[1].body.model, DEFAULT_CHAT_MODEL);
  assert.equal(resolveChatModel(""), DEFAULT_CHAT_MODEL);
  assert.equal(resolveChatModel("nope"), null);
  assert.equal(resolveChatModel("gemini-2.5-flash"), null);
  assert.equal(resolveChatModel("gemini-3.8-flash"), "gemini-3.8-flash");
  assert.equal(resolveChatModel("gemini-2.5-flash-lite"), "gemini-2.5-flash-lite");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("OpenHands pega al proxy como openai/garfio-worker", () => {
  const compose = fs.readFileSync(
    new URL("../docker-compose.yml", import.meta.url),
    "utf8"
  );
  assert.match(compose, /LLM_MODEL=openai\/garfio-worker/);
  assert.doesNotMatch(compose, /LLM_MODEL=(?!openai\/)garfio-worker/);
});

test("carta LiteLLM: 3.8 + lite, sin 2.5-flash, fallback en cadena", () => {
  const yaml = fs.readFileSync(
    new URL("../config/litellm/config.yaml", import.meta.url),
    "utf8"
  );
  assert.match(yaml, /gemini\/gemini-3\.8-flash/);
  assert.match(yaml, /gemini\/gemini-2\.5-flash-lite/);
  assert.doesNotMatch(yaml, /gemini\/gemini-2\.5-flash[^-]/);
  assert.match(
    yaml,
    /murray-chat: \[deepseek-flash, deepseek-chat, gemini-3\.8-flash, gemini-2\.5-flash-lite\]/
  );
  assert.match(
    yaml,
    /murray-worker: \[deepseek-flash, deepseek-chat, gemini-3\.8-flash, gemini-2\.5-flash-lite\]/
  );
  assert.ok(ALLOWED_MODELS.includes("deepseek-v4-pro"));
  assert.ok(ALLOWED_MODELS.includes("deepseek-flash"));
  assert.ok(ALLOWED_MODELS.includes("deepseek-reasoner"));
  assert.ok(ALLOWED_MODELS.includes("deepseek-chat"));
  assert.ok(ALLOWED_MODELS.includes("gemini-3.8-flash"));
  assert.ok(ALLOWED_MODELS.includes("gemini-2.5-flash-lite"));
  assert.ok(!ALLOWED_MODELS.includes("gemini-2.5-flash"));
});

test("complete() detecta router fallback de LiteLLM y dispara onFallback inmediatamente", async () => {
  const fallbackEvents = [];
  const llm = createLlm({
    apiKey: "sk-test-master-not-a-placeholder",
    baseUrl: "http://litellm:4000",
    model: "deepseek-v4-pro",
    onFallback: async (info) => {
      fallbackEvents.push(info);
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        model: "deepseek-flash",
        choices: [{ message: { content: "respuesta de respaldo flash", tool_calls: [] } }],
      }),
    }),
  });

  const out = await llm.complete({ messages: [{ role: "user", content: "test" }], chatId: "12345" });
  assert.equal(out.content, "respuesta de respaldo flash");
  assert.ok(out.fallback);
  assert.equal(out.fallback.from, "deepseek-v4-pro");
  assert.equal(out.fallback.to, "deepseek-flash");
  assert.equal(out.fallback.chatId, "12345");
  assert.equal(fallbackEvents.length, 1);
  assert.equal(fallbackEvents[0].to, "deepseek-flash");
});

test("complete() ante falla HTTP de modelo primario cae a fallbackModel y avisa en seguida", async () => {
  const fallbackEvents = [];
  const calls = [];
  const llm = createLlm({
    apiKey: "sk-test-master-not-a-placeholder",
    baseUrl: "http://litellm:4000",
    model: "deepseek-reasoner",
    fallbackModel: "deepseek-chat",
    onFallback: async (info) => {
      fallbackEvents.push(info);
    },
    fetchImpl: async (_url, opts) => {
      const payload = JSON.parse(opts.body);
      calls.push(payload.model);
      if (payload.model === "deepseek-reasoner") {
        return {
          ok: false,
          status: 502,
          json: async () => ({ error: { message: "upstream timeout en reasoner" } }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          model: "deepseek-chat",
          choices: [{ message: { content: "salvado por deepseek-chat", tool_calls: [] } }],
        }),
      };
    },
  });

  const out = await llm.complete({ messages: [{ role: "user", content: "test" }] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0], "deepseek-reasoner");
  assert.equal(calls[1], "deepseek-chat");
  assert.equal(out.content, "salvado por deepseek-chat");
  assert.ok(out.fallback);
  assert.equal(out.fallback.from, "deepseek-reasoner");
  assert.equal(out.fallback.to, "deepseek-chat");
  assert.match(out.fallback.reason, /upstream timeout en reasoner/);
  assert.equal(fallbackEvents.length, 1);
});

test("complete() no dispara onFallback si el primario responde exitosamente sin fallback", async () => {
  const fallbackEvents = [];
  const llm = createLlm({
    apiKey: "sk-test-master-not-a-placeholder",
    baseUrl: "http://litellm:4000",
    model: "deepseek-reasoner",
    onFallback: async (info) => {
      fallbackEvents.push(info);
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        model: "deepseek-reasoner",
        choices: [{ message: { content: "éxito reasoner", tool_calls: [] } }],
      }),
    }),
  });

  const out = await llm.complete({ messages: [{ role: "user", content: "test" }] });
  assert.equal(out.content, "éxito reasoner");
  assert.equal(out.fallback, null);
  assert.equal(fallbackEvents.length, 0);
});
