import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openMurrayDb } from "../config/murray-agent/db.mjs";
import { createApprovalStore } from "../config/murray-agent/approvals.mjs";
import { createJobStore } from "../config/murray-agent/jobs.mjs";
import { createMemory } from "../config/murray-agent/memory.mjs";
import { createSessionStore } from "../config/murray-agent/session.mjs";

test("job encolado sobrevive a reabrir la DB", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-reopen-"));
  const filePath = path.join(dir, "murray.db");
  const db1 = openMurrayDb({ filePath });
  const store1 = createJobStore({ db: db1 });
  const job = store1.enqueue({
    type: "clone",
    chatId: "1",
    payload: { slug: "repo-a" },
  });
  db1.close();

  const db2 = openMurrayDb({ filePath });
  const store2 = createJobStore({ db: db2 });
  const got = store2.get(job.id);
  assert.equal(got.id, job.id);
  assert.equal(got.type, "clone");
  assert.equal(got.status, "queued");
  assert.equal(got.chatId, "1");
  assert.equal(got.payload.slug, "repo-a");
  db2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("migra JSON one-shot y no pisa messages al aplicar session", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-mig-"));
  const jobsPath = path.join(dir, "jobs.json");
  const memoryPath = path.join(dir, "memory.json");
  const sessionPath = path.join(dir, "session.json");
  fs.writeFileSync(
    jobsPath,
    JSON.stringify({
      aabbccddeeff0011: {
        id: "aabbccddeeff0011",
        type: "pull",
        status: "done",
        chatId: "9",
        payload: { slug: "repo-a" },
        error: "",
        log: ["ok"],
        createdAt: 1000,
        runAfter: 0,
        updatedAt: 2000,
      },
    })
  );
  fs.writeFileSync(
    memoryPath,
    JSON.stringify({
      "9": [
        { role: "user", content: "hola" },
        { role: "assistant", content: "núcleo" },
      ],
    })
  );
  fs.writeFileSync(
    sessionPath,
    JSON.stringify({
      "9": {
        slug: "repo-a",
        url: "https://github.com/octocat/Hello-World.git",
        lastJobId: "aabbccddeeff0011",
        awaiting_instruction: false,
      },
    })
  );

  const db = openMurrayDb({
    filePath: path.join(dir, "murray.db"),
    jobsPath,
    memoryPath,
    sessionPath,
  });
  const jobs = createJobStore({ db });
  const memory = createMemory({ db });
  const session = createSessionStore({ db });
  assert.equal(jobs.get("aabbccddeeff0011").payload.slug, "repo-a");
  assert.deepEqual(memory.get("9").map((row) => row.content), ["hola", "núcleo"]);
  assert.equal(session.get("9").slug, "repo-a");
  assert.equal(session.get("9").lastJobId, "aabbccddeeff0011");
  assert.equal(fs.existsSync(`${jobsPath}.migrated`), true);
  assert.equal(fs.existsSync(`${memoryPath}.migrated`), true);
  assert.equal(fs.existsSync(`${sessionPath}.migrated`), true);
  assert.equal(fs.existsSync(jobsPath), false);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("HITL persistido: un uso y expirados no vuelven", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-hitl-"));
  const filePath = path.join(dir, "murray.db");
  const db = openMurrayDb({ filePath });
  const store = createApprovalStore({ db, ttlMs: 50 });
  const id = store.issue({ kind: "ops", action: "recreate", service: "n8n" });
  assert.equal(store.peek(id).action, "recreate");
  assert.equal(store.take(id).used, true);
  assert.equal(store.take(id), null);
  const expired = store.issue({ kind: "ops", action: "restart", service: "n8n" });
  const until = Date.now() + 200;
  while (Date.now() < until) {
    // TTL 50ms
  }
  assert.equal(store.peek(expired), null);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("session_context persiste garfio_model y sobrevive a reabrir la DB", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-garfio-model-"));
  const filePath = path.join(dir, "murray.db");
  const db1 = openMurrayDb({ filePath });
  const store1 = createSessionStore({ db: db1 });
  store1.patch("42", { slug: "test-repo", garfio_model: "deepseek-chat" });
  assert.equal(store1.get("42").garfio_model, "deepseek-chat");
  assert.equal(store1.get("42").garfioModel, "deepseek-chat");
  db1.close();

  const db2 = openMurrayDb({ filePath });
  const store2 = createSessionStore({ db: db2 });
  const got = store2.get("42");
  assert.equal(got.slug, "test-repo");
  assert.equal(got.garfio_model, "deepseek-chat");
  assert.equal(got.garfioModel, "deepseek-chat");
  db2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
