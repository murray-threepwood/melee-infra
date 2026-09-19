import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openMurrayDb } from "../config/murray-agent/db.mjs";
import { createJobStore, createJobWorker } from "../config/murray-agent/jobs.mjs";
import { isOpenHandsSandboxName } from "../config/murray-agent/ops.mjs";
import {
  TTL_MS,
  createSandboxJanitor,
  isCodeFlight,
  selectExpiredSandboxes,
  selectOrphans,
} from "../config/murray-agent/sandbox-ttl.mjs";

const NOW = Date.parse("2026-09-18T21:00:00.000Z");

test("regex: oh-agent-server-abc sí; murray-n8n y oh-runtime-foo no", () => {
  assert.equal(isOpenHandsSandboxName("oh-agent-server-abc"), true);
  assert.equal(isOpenHandsSandboxName("/oh-agent-server-abc"), true);
  assert.equal(isOpenHandsSandboxName("murray-n8n"), false);
  assert.equal(isOpenHandsSandboxName("oh-runtime-foo"), false);
  const rows = [
    { id: "aaa111", name: "oh-agent-server-abc", createdAt: NOW - TTL_MS },
    { id: "bbb222", name: "murray-n8n", createdAt: NOW - TTL_MS * 2 },
    { id: "ccc333", name: "oh-runtime-foo", createdAt: NOW - TTL_MS * 2 },
  ];
  assert.deepEqual(selectOrphans(rows).map((row) => row.id), ["aaa111"]);
});

test("29 min no expira; 31 min sí", () => {
  const young = {
    id: "aaa111",
    name: "oh-agent-server-young",
    createdAt: NOW - 29 * 60 * 1000,
  };
  const old = {
    id: "bbb222",
    name: "oh-agent-server-old",
    createdAt: NOW - 31 * 60 * 1000,
  };
  const expired = selectExpiredSandboxes([young, old], { now: NOW, ttlMs: TTL_MS });
  assert.deepEqual(expired.map((row) => row.id), ["bbb222"]);
});

test("isCodeFlight true bloquea la decisión del watcher", () => {
  assert.equal(isCodeFlight([]), false);
  assert.equal(
    isCodeFlight([{ id: "1", type: "code", status: "running" }]),
    true
  );
  assert.equal(
    isCodeFlight([{ id: "1", type: "oh_poll", status: "running" }]),
    true
  );
  assert.equal(
    isCodeFlight([{ id: "1", type: "code", status: "done" }]),
    false
  );
  assert.equal(
    isCodeFlight([{ id: "1", type: "pull", status: "running" }]),
    false
  );
  assert.equal(
    isCodeFlight([{ id: "1", type: "code", status: "running" }], { exceptId: "1" }),
    false
  );
});

test("kick code sin vuelo llama purge; pull no; otro running no", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-ttl-kick-"));
  const db = openMurrayDb({ filePath: path.join(dir, "murray.db") });
  const store = createJobStore({ db });
  const purged = [];
  const janitor = createSandboxJanitor({
    store,
    list: async () => [
      { id: "aaa111", name: "oh-agent-server-z", createdAt: NOW - TTL_MS },
    ],
    purge: async (ids) => {
      purged.push(ids);
      return { removed: ids };
    },
  });
  const worker = createJobWorker({
    store,
    onBeforeCodeKick: (job) => janitor.purgeOrphans({ exceptJobId: job.id }),
    handlers: {
      code: async (job) => {
        store.update(job.id, { status: "done" });
      },
      pull: async (job) => {
        store.update(job.id, { status: "done" });
      },
    },
  });
  const pull = store.enqueue({ type: "pull", chatId: "1", payload: { slug: "r" } });
  await worker.kick(pull.id);
  assert.equal(purged.length, 0);

  const code = store.enqueue({ type: "code", chatId: "1", payload: { slug: "r" } });
  await worker.kick(code.id);
  assert.deepEqual(purged[0], ["aaa111"]);

  const flyer = store.enqueue({ type: "oh_poll", chatId: "1", payload: {} });
  store.update(flyer.id, { status: "running" });
  const code2 = store.enqueue({ type: "code", chatId: "1", payload: { slug: "r" } });
  await worker.kick(code2.id);
  assert.equal(purged.length, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("tick: vuelo no purge; 31 min sí; 10 min no", async () => {
  const rows = [
    { id: "aaa111", name: "oh-agent-server-old", createdAt: NOW - 31 * 60 * 1000 },
    { id: "bbb222", name: "oh-agent-server-new", createdAt: NOW - 10 * 60 * 1000 },
    { id: "ccc333", name: "murray-postgres", createdAt: NOW - 40 * 60 * 1000 },
  ];
  const purged = [];
  const busy = createSandboxJanitor({
    store: { running: () => [{ id: "1", type: "oh_poll", status: "running" }] },
    now: () => NOW,
    list: async () => rows,
    purge: async (ids) => {
      purged.push(["busy", ...ids]);
      return { removed: ids };
    },
  });
  await busy.tick();
  assert.equal(purged.length, 0);

  const idle = createSandboxJanitor({
    store: { running: () => [] },
    now: () => NOW,
    list: async () => rows,
    purge: async (ids) => {
      purged.push(ids);
      return { removed: ids };
    },
  });
  await idle.tick();
  assert.deepEqual(purged[0], ["aaa111"]);
});
