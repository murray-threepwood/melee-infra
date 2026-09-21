import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openMurrayDb } from "../config/murray-agent/db.mjs";
import { createJobStore } from "../config/murray-agent/jobs.mjs";
import { createCodingSession, defaultAstAuditor } from "../config/murray-agent/coding.mjs";

test("defaultAstAuditor ejecuta script de Python y detecta degradación de tests", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-ast-test-"));
  // Si no es un repo git, defaultAstAuditor retorna passed: true sin crash
  const res = await defaultAstAuditor(tmpDir);
  assert.equal(res.passed, true);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("handlePollJob intercepta test hacking y transiciona a stuck test_hacking_detected", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-coding-ast-"));
  const db = openMurrayDb({ filePath: path.join(dir, "murray.db") });
  const jobs = createJobStore({ db });
  const sent = [];

  const mockTelegram = {
    send: async (payload) => {
      sent.push(payload);
      return { ok: true };
    },
  };

  const mockWorkspace = {
    repoDir: () => dir,
    status: async () => ({ files: ["tests/test_calc.py"] }),
    commitsAhead: async () => 1,
    currentBranch: async () => "feat/calc",
  };

  const mockOpenhands = {
    gitChanges: async () => ({ modified: ["tests/test_calc.py"] }),
    getConversation: async () => ({
      execution_status: "finished",
      sandbox_status: "RUNNING",
    }),
    searchEvents: async () => [],
  };

  const session = createCodingSession({
    workspace: mockWorkspace,
    jobs,
    telegram: mockTelegram,
    openhands: mockOpenhands,
    approvals: { issue: () => "appr1" },
    session: { get: () => ({}), patch: () => {} },
    astAuditor: async () => ({
      passed: false,
      violations: [
        {
          file: "tests/test_calc.py",
          type: "assertions_reduced",
          message: "Redujo aserciones en tests/test_calc.py: tenía 5, ahora tiene 2",
        },
      ],
    }),
  });

  const pollJob = jobs.enqueue({
    type: "oh_poll",
    chatId: "123",
    payload: {
      slug: "calc-repo",
      conversationId: "conv123",
      startedAt: Date.now() - 1000,
    },
  });

  await session.handlers.oh_poll(pollJob);

  const updated = jobs.get(pollJob.id);
  assert.equal(updated.status, "stuck");
  assert.equal(updated.error, "test_hacking_detected");

  // Verifica que avisó por Telegram con terminal: true
  assert.ok(sent.length > 0);
  const alert = sent.find((m) => m && m.text && m.text.includes("Auditoría Anti-Test Hacking"));
  assert.ok(alert, "Debe enviar alerta de Anti-Test Hacking por Telegram");
  assert.equal(alert.terminal, true);
  assert.ok(alert.text.includes("Redujo aserciones"));

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
