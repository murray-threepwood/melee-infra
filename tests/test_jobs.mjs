import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  TERMINAL,
  createJobStore,
  createJobWorker,
  formatClock,
  formatJobDetail,
  formatJobsSummary,
  jobsHint,
} from "../config/murray-agent/jobs.mjs";

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-jobs-"));
  const store = createJobStore({ filePath: path.join(dir, "jobs.json") });
  return { dir, store };
}

test("list: más nuevos primero, filtra chat y respeta limit", () => {
  const { dir, store } = tmpStore();
  const a = store.enqueue({ type: "clone", chatId: "1", payload: { slug: "repo-a" } });
  const b = store.enqueue({ type: "pull", chatId: "1", payload: { slug: "repo-a" } });
  store.enqueue({ type: "push", chatId: "2", payload: { slug: "other" } });
  store.update(a.id, { status: "failed", error: "git_clone_failed" });
  const listed = store.list({ chatId: "1", limit: 10 });
  assert.equal(listed.length, 2);
  assert.equal(listed[0].id, a.id);
  assert.equal(listed[0].status, "failed");
  assert.equal(listed[1].id, b.id);
  assert.equal(store.list({ chatId: "1", limit: 1 }).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("appendLog recorta a 40; detail muestra últimas 20 y el error", () => {
  const { dir, store } = tmpStore();
  const job = store.enqueue({ type: "code", chatId: "9", payload: { slug: "octocat-Hello-World" } });
  for (let i = 1; i <= 45; i += 1) {
    store.appendLog(job.id, `linea ${i}`);
  }
  const capped = store.get(job.id);
  assert.equal(capped.log.length, 40);
  assert.equal(capped.log[0], "linea 6");
  assert.equal(capped.log.at(-1), "linea 45");
  store.update(job.id, { status: "failed", error: "openhands_timeout" });
  const row = store.get(job.id);
  const detail = formatJobDetail(row, { now: row.updatedAt, tail: 20 });
  assert.match(detail, /Job /);
  assert.match(detail, /status: failed/);
  assert.match(detail, /error: openhands_timeout/);
  assert.match(detail, /slug: octocat-Hello-World/);
  assert.match(detail, /linea 45/);
  assert.equal(/linea 1\b/.test(detail), false);
  const logged = detail.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(logged.length <= 20, true);
  assert.equal(logged.length >= 1, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("summary usa createdAt, no el último poll; muestra reloj Montevideo", () => {
  assert.match(formatJobsSummary([]), /No hay jobs/);
  const createdAt = Date.parse("2026-09-17T23:18:00.000Z");
  const text = formatJobsSummary(
    [
      {
        id: "aabbccddeeff0011",
        type: "oh_poll",
        status: "running",
        createdAt,
        updatedAt: createdAt + 8 * 60 * 1000,
        error: "",
        payload: { slug: "octocat-Hello-World" },
      },
    ],
    { now: createdAt + 8 * 60 * 1000, timeZone: "America/Montevideo" }
  );
  assert.match(text, /aabbccddeeff0011/);
  assert.match(text, /oh_poll running/);
  assert.match(text, /20:18/);
  assert.match(text, /8m/);
  assert.match(text, /octocat-Hello-World/);
  assert.equal(/8s\b/.test(text), false);
});

test("detail muestra start de createdAt aunque updatedAt se mueva", () => {
  const createdAt = Date.parse("2026-09-17T23:18:00.000Z");
  const detail = formatJobDetail(
    {
      id: "aabbccddeeff0011",
      type: "code",
      status: "failed",
      createdAt,
      updatedAt: createdAt + 8 * 60 * 1000,
      error: "openhands_timeout",
      payload: { slug: "octocat-Hello-World" },
      log: ["trace 1"],
    },
    { now: createdAt + 8 * 60 * 1000, timeZone: "America/Montevideo", tail: 20 }
  );
  assert.match(detail, /start: 20:18 \(hace 8m\)/);
});

test("formatClock: mismo día HH:MM; otro día con fecha", () => {
  const start = Date.parse("2026-09-16T23:18:00.000Z");
  const now = Date.parse("2026-09-17T12:00:00.000Z");
  assert.equal(formatClock(Date.parse("2026-09-17T23:18:00.000Z"), {
    now: Date.parse("2026-09-17T23:20:00.000Z"),
    timeZone: "America/Montevideo",
  }), "20:18");
  assert.match(
    formatClock(start, { now, timeZone: "America/Montevideo" }),
    /16\/09 20:18/
  );
});

test("jobsHint ofrece /jobs en una línea Murray", () => {
  assert.equal(jobsHint(), "Si te pica la impaciencia: /jobs.");
  assert.match(jobsHint("aabbccddeeff0011"), /\/jobs aabbccddeeff0011/);
});

test("find por job id, conversationId y startTaskId; paused es terminal", async () => {
  const { dir, store } = tmpStore();
  assert.equal(TERMINAL.has("paused"), true);
  const job = store.enqueue({
    type: "oh_poll",
    chatId: "7",
    payload: {
      slug: "repo-a",
      conversationId: "460fdf35f8e54fb996d8c52d9eb01057",
      startTaskId: "d02a1ede8b1643f28c27715a9c82ed6d",
    },
  });
  assert.equal(store.find({ chatId: "7", ref: job.id }).id, job.id);
  assert.equal(
    store.find({ chatId: "7", ref: "460fdf35f8e54fb996d8c52d9eb01057" }).id,
    job.id
  );
  assert.equal(
    store.find({ chatId: "7", ref: "d02a1ede8b1643f28c27715a9c82ed6d" }).id,
    job.id
  );
  assert.equal(store.find({ chatId: "8", ref: job.id }), null);
  store.update(job.id, { status: "paused", error: "sandbox_paused" });
  const hits = [];
  const worker = createJobWorker({
    store,
    handlers: {
      oh_poll: async () => {
        hits.push("ran");
      },
    },
  });
  const after = await worker.kick(job.id);
  assert.equal(after.status, "paused");
  assert.equal(hits.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
