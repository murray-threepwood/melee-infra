import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createJobStore,
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

test("summary lista status y error; vacío explica /jobs", () => {
  assert.match(formatJobsSummary([]), /No hay jobs/);
  const text = formatJobsSummary(
    [
      {
        id: "aabbccddeeff0011",
        type: "pull",
        status: "done",
        updatedAt: 1000,
        error: "",
        payload: { slug: "octocat-Hello-World" },
      },
    ],
    { now: 1000 + 12_000 }
  );
  assert.match(text, /aabbccddeeff0011/);
  assert.match(text, /pull done 12s/);
  assert.match(text, /octocat-Hello-World/);
});

test("jobsHint ofrece /jobs en una línea Murray", () => {
  assert.equal(jobsHint(), "Si te pica la impaciencia: /jobs.");
  assert.match(jobsHint("aabbccddeeff0011"), /\/jobs aabbccddeeff0011/);
});
