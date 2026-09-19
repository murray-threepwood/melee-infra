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
    text: "/model gemini-2.5-flash",
  });
  assert.match(set.reply, /gemini-2.5-flash/);
  assert.equal(session.get("7").active_model, "gemini-2.5-flash");
  assert.equal(session.get("7").slug, "repo-a");

  const bad = await engine.handleChat({
    chat_id: "7",
    text: "/model gpt-4o",
  });
  assert.match(bad.reply, /inválido/);
  assert.equal(session.get("7").active_model, "gemini-2.5-flash");
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
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
