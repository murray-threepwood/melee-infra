import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openMurrayDb } from "../config/murray-agent/db.mjs";
import { createApprovalStore } from "../config/murray-agent/approvals.mjs";
import { createChatEngine } from "../config/murray-agent/chat.mjs";
import { createOps } from "../config/murray-agent/ops.mjs";
import {
  createSeenEmailStore,
  formatSeenToday,
} from "../config/murray-agent/seen-emails.mjs";
import { createMurrayAgentServer } from "../config/murray-agent/server.mjs";
import { createMemory } from "../config/murray-agent/memory.mjs";

function tmpSeen() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-seen-"));
  const db = openMurrayDb({ filePath: path.join(dir, "murray.db") });
  return { dir, db, store: createSeenEmailStore({ db }) };
}

function dummyEngine() {
  return { handleChat: async () => ({ reply: "ok" }) };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

async function withTriageServer(seen, fn) {
  const server = createMurrayAgentServer({ engine: dummyEngine(), seen });
  const port = await listen(server);
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("filter de vacío → todos nuevos; dedup conserva orden", () => {
  const { dir, db, store } = tmpSeen();
  assert.deepEqual(store.filterNew(["m2", "m1", "m2", "m3"]), ["m2", "m1", "m3"]);
  assert.deepEqual(store.filterNew([]), []);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("filter tras mark-seen omite ese id; mark-seen dos veces es una row", () => {
  const { dir, db, store } = tmpSeen();
  assert.deepEqual(store.filterNew(["m1", "m2"]), ["m1", "m2"]);
  store.markSeen({ messageId: "m2", threadId: "t2" });
  store.markSeen({ messageId: "m2", threadId: "t2-again" });
  assert.deepEqual(store.filterNew(["m1", "m2", "m3"]), ["m1", "m3"]);
  const rows = db
    .prepare("SELECT message_id, thread_id FROM seen_emails WHERE message_id = ?")
    .all("m2");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].thread_id, "t2-again");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("POST /triage/filter y /triage/mark-seen: contrato HTTP", async () => {
  const { dir, db, store } = tmpSeen();
  await withTriageServer(store, async (port) => {
    const missing = await fetch(`http://127.0.0.1:${port}/triage/filter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, "ids_required");

    const filtered = await fetch(`http://127.0.0.1:${port}/triage/filter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["m1", "m2"] }),
    });
    assert.equal(filtered.status, 200);
    assert.deepEqual((await filtered.json()).new_ids, ["m1", "m2"]);

    const noId = await fetch(`http://127.0.0.1:${port}/triage/mark-seen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ thread_id: "t" }),
    });
    assert.equal(noId.status, 400);
    assert.equal((await noId.json()).error, "message_id_required");

    const marked = await fetch(`http://127.0.0.1:${port}/triage/mark-seen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message_id: "m2", thread_id: "t2" }),
    });
    assert.equal(marked.status, 200);
    assert.equal((await marked.json()).status, "ok");

    const again = await fetch(`http://127.0.0.1:${port}/triage/mark-seen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message_id: "m2", thread_id: "t2" }),
    });
    assert.equal(again.status, 200);

    const after = await fetch(`http://127.0.0.1:${port}/triage/filter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["m1", "m2"] }),
    });
    assert.deepEqual((await after.json()).new_ids, ["m1"]);
    assert.equal(store.count("m2"), 1);
  });
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function seenEngine(store, overrides = {}) {
  let gmailHits = 0;
  let llmHits = 0;
  const engine = createChatEngine({
    ops: createOps({
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    }),
    approvals: createApprovalStore(),
    memory: createMemory({ filePath: ":memory:" }),
    seen: store,
    gmailMeta: async () => {
      gmailHits += 1;
      return {
        unread_count: 1,
        subject: "CONFIDENCIAL",
        sender: "Ada",
      };
    },
    llm: {
      complete: async () => {
        llmHits += 1;
        return { content: "no", tool_calls: [] };
      },
    },
    readDoc: () => "",
    personaText: "x",
    ...overrides,
  });
  return { engine, hits: { gmailHits: () => gmailHits, llmHits: () => llmHits } };
}

test("list_seen_emails: ids + hora, cero subject/sender y no toca Gmail", async () => {
  const { dir, db, store } = tmpSeen();
  store.markSeen({ messageId: "msg-aaa", threadId: "th-1" });
  const { engine, hits } = seenEngine(store);
  const tool = await engine.dispatchTool("list_seen_emails", {}, { chatId: "1" });
  const encoded = JSON.stringify(tool.payload);
  assert.equal(tool.payload.count, 1);
  assert.equal(tool.payload.emails[0].message_id, "msg-aaa");
  assert.equal(typeof tool.payload.emails[0].processed_at, "number");
  assert.equal(encoded.includes("subject"), false);
  assert.equal(encoded.includes("sender"), false);
  assert.equal(encoded.includes("CONFIDENCIAL"), false);
  assert.equal(encoded.includes("Ada"), false);
  assert.equal(Object.hasOwn(tool.payload.emails[0], "subject"), false);
  assert.equal(hits.gmailHits(), 0);

  const spoken = await engine.handleChat({
    chat_id: "1",
    text: "qué mails procesaste hoy",
  });
  assert.equal(hits.llmHits(), 0);
  assert.equal(hits.gmailHits(), 0);
  assert.match(spoken.reply, /msg-aaa/);
  assert.equal(spoken.reply.includes("CONFIDENCIAL"), false);
  assert.equal(spoken.reply.includes("Ada"), false);
  assert.match(formatSeenToday(store.listToday()), /msg-aaa/);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
