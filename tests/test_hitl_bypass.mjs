import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createApprovalStore } from "../config/murray-agent/approvals.mjs";
import { createCodingSession } from "../config/murray-agent/coding.mjs";
import { openMurrayDb } from "../config/murray-agent/db.mjs";
import { createJobStore } from "../config/murray-agent/jobs.mjs";
import { createSessionStore } from "../config/murray-agent/session.mjs";
import { parseHitlBypass } from "../config/murray-agent/hitl-policy.mjs";

function stack({ hitlBypass = parseHitlBypass("code,clone") } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-bypass-"));
  const db = openMurrayDb({ filePath: path.join(dir, "murray.db") });
  const session = createSessionStore({ db });
  const jobs = createJobStore({ db });
  const approvals = createApprovalStore({ db });
  const kicked = [];
  const coding = createCodingSession({
    workspace: {
      clone: async () => ({ slug: "hbauzan-ddi-fw", url: "https://github.com/hbauzan/ddi-fw" }),
    },
    session,
    jobs,
    approvals,
    hitlBypass,
    worker: {
      kick(id) {
        kicked.push(id);
        return Promise.resolve(null);
      },
    },
    openhands: {
      startConversation: async () => ({ id: "task1" }),
    },
    telegram: { send: async () => ({ skipped: true }) },
  });
  session.patch("7", {
    slug: "hbauzan-ddi-fw",
    url: "https://github.com/hbauzan/ddi-fw",
  });
  return { dir, db, session, jobs, coding, kicked };
}

test("bypass code encola job y no pide teclado HITL", async () => {
  const { dir, db, coding, jobs, kicked } = stack();
  const packed = await coding.proposeCode({
    chatId: "7",
    instruction: "Usando dev-protocol, ejecutá la ola Q en este repo.",
    testCommand: "uv run pytest",
  });
  assert.equal(packed.needs_hitl, false);
  assert.equal(packed.needs_job, true);
  assert.match(packed.job_id, /^[a-f0-9]{16}$/);
  assert.equal(jobs.get(packed.job_id).type, "code");
  assert.deepEqual(kicked, [packed.job_id]);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("sin bypass code sigue pidiendo Aprobar", async () => {
  const { dir, db, coding, jobs } = stack({ hitlBypass: parseHitlBypass("") });
  const packed = await coding.proposeCode({
    chatId: "7",
    instruction: "Implementá Q01 con TDD.",
    testCommand: "uv run pytest -q",
  });
  assert.equal(packed.needs_hitl, true);
  assert.equal(packed.hitl.kind, "code");
  assert.equal(jobs.list({ chatId: "7" }).length, 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("recoverCodeHitl con bypass también encola", async () => {
  const { dir, db, coding, session } = stack();
  session.patch("7", {
    slug: "hbauzan-ddi-fw",
    lastMission: "ola Q Q01 a Q05",
    lastTestCommand: "uv run pytest",
  });
  const packed = await coding.recoverCodeHitl({
    chatId: "7",
    text: "si",
    lastAssistant: "Plan listo. Comando: uv run pytest",
  });
  assert.equal(packed.needs_job, true);
  assert.equal(packed.needs_hitl, false);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
