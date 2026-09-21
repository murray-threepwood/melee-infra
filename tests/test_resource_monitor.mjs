import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  MAX_RAM_MB,
  MAX_TASK_DURATION_MS,
  OOM_EXIT_CODE,
  checkResourceSaturation,
  createResourceMonitor,
  formatE2BTelegramAlert,
  recordResourceWarning,
} from "../config/murray-agent/resource-monitor.mjs";
import { openMurrayDb } from "../config/murray-agent/db.mjs";
import { createJobStore } from "../config/murray-agent/jobs.mjs";

test("checkResourceSaturation detecta condiciones normales", () => {
  const res = checkResourceSaturation({
    memTotalMb: 2048,
    exitCode: 0,
    durationMs: 5 * 60 * 1000,
  });
  assert.equal(res.saturated, false);
  assert.equal(res.reasons.length, 0);
});

test("checkResourceSaturation detecta OOM exit code 137", () => {
  const res = checkResourceSaturation({
    exitCode: OOM_EXIT_CODE,
  });
  assert.equal(res.saturated, true);
  assert.ok(res.reasons.some((r) => r.includes("oom_137_killed")));
});

test("checkResourceSaturation detecta RAM excesiva (>4.2 GB)", () => {
  const res = checkResourceSaturation({
    memTotalMb: MAX_RAM_MB + 100,
  });
  assert.equal(res.saturated, true);
  assert.ok(res.reasons.some((r) => r.includes("high_memory_pressure")));
});

test("checkResourceSaturation detecta duracion excesiva (>20m)", () => {
  const res = checkResourceSaturation({
    durationMs: MAX_TASK_DURATION_MS + 1000,
  });
  assert.equal(res.saturated, true);
  assert.ok(res.reasons.some((r) => r.includes("task_duration_exceeded")));
});

test("formatE2BTelegramAlert genera mensaje HTML con recomendacion de E2B", () => {
  const html = formatE2BTelegramAlert({
    slug: "acme/repo",
    jobId: "job-999",
    reasons: ["oom_137_killed: Contenedor sandbox colapsó"],
    memTotalMb: 4300,
  });
  assert.ok(html.includes("Alerta de Saturación de Recursos"));
  assert.ok(html.includes("acme/repo"));
  assert.ok(html.includes("SANDBOX_BACKEND=e2b"));
  assert.ok(html.includes("4300 MB"));
});

test("recordResourceWarning escribe en RESOURCE_WARNINGS.md", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-inbox-test-"));
  const ok = recordResourceWarning({
    operatorInboxDir: tmpDir,
    warning: {
      jobId: "job-123",
      slug: "acme/api",
      memTotalMb: 4400,
      reasons: ["high_memory_pressure"],
      recommendation: "Delegar a E2B",
    },
    now: () => new Date("2026-09-21T18:00:00.000Z"),
  });
  assert.equal(ok, true);

  const filePath = path.join(tmpDir, "RESOURCE_WARNINGS.md");
  assert.ok(fs.existsSync(filePath));
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("[2026-09-21T18:00:00.000Z]"));
  assert.ok(content.includes("acme/api"));
  assert.ok(content.includes("job-123"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("createResourceMonitor.inspectAndAlert actualiza job y envia telegram si esta saturado", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-res-mon-"));
  const db = openMurrayDb({ filePath: path.join(tmpDir, "test.db") });
  const jobs = createJobStore({ db });
  const job = jobs.enqueue({
    type: "coding",
    chatId: "12345",
    payload: { slug: "acme/app" },
  });
  const jobId = job.id;

  const sent = [];
  const telegram = {
    send: async (msg) => {
      sent.push(msg);
      return { ok: true };
    },
  };

  const ops = {
    memorySnapshot: async () => ({ totalMiB: 4500 }),
  };

  const monitor = createResourceMonitor({
    ops,
    jobs,
    telegram,
    operatorInboxDir: tmpDir,
    now: () => Date.now(),
  });

  const result = await monitor.inspectAndAlert({
    jobId,
    chatId: "12345",
    slug: "acme/app",
    exitCode: 137,
  });

  assert.equal(result.saturated, true);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes("Alerta de Saturación de Recursos"));

  const updatedJob = jobs.get(jobId);
  assert.ok(updatedJob.payload.resourceWarning);
  assert.equal(updatedJob.payload.resourceWarning.slug, "acme/app");

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("createCodingSession ejecuta resourceMonitor.inspectAndAlert al entrar en stuck", async () => {
  const { createCodingSession } = await import("../config/murray-agent/coding.mjs");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-cs-res-"));
  const db = openMurrayDb({ filePath: path.join(tmpDir, "test.db") });
  const jobs = createJobStore({ db });

  let inspected = false;
  const mockMonitor = {
    inspectAndAlert: async (args) => {
      inspected = true;
      assert.equal(args.slug, "stuck-repo");
    },
  };

  const mockOpenhands = {
    gitChanges: async () => ({ modified: [] }),
    getConversation: async () => ({
      execution_status: "error",
      sandbox_status: "ERROR",
    }),
    searchEvents: async () => [],
  };

  const session = createCodingSession({
    jobs,
    resourceMonitor: mockMonitor,
    openhands: mockOpenhands,
    workspace: { repoDir: () => tmpDir },
    approvals: { issue: () => "appr1" },
    session: { get: () => ({}), patch: () => {} },
    telegram: { send: async () => ({ ok: true }) },
  });

  const pollJob = jobs.enqueue({
    type: "oh_poll",
    chatId: "999",
    payload: {
      slug: "stuck-repo",
      conversationId: "conv-1",
      startedAt: Date.now() - 1000,
    },
  });

  await session.handlers.oh_poll(pollJob);
  assert.equal(inspected, true, "Debe llamar a inspectAndAlert cuando entra en stuck");

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
