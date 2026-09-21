import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { extractGarfioRationale } from "../config/murray-agent/openhands.mjs";
import {
  classifyUserText,
  isRepoStatusIntent,
  isRoadmapIntent,
} from "../config/murray-agent/intent.mjs";
import { parseSlash } from "../config/murray-agent/chat.mjs";
import { createCodingSession } from "../config/murray-agent/coding.mjs";
import { createApprovalStore } from "../config/murray-agent/approvals.mjs";
import { createJobStore } from "../config/murray-agent/jobs.mjs";
import { createSessionStore } from "../config/murray-agent/session.mjs";
import { openMurrayDb } from "../config/murray-agent/db.mjs";
import { planInspectActions } from "../config/murray-agent/inspect.mjs";

test("extractGarfioRationale extrae reporte desde FinishAction.message de OpenHands v1", () => {
  const events = [
    {
      id: "ev-1",
      kind: "ActionEvent",
      source: "agent",
      tool_name: "terminal",
      action: { command: "uv run pytest" },
    },
    {
      id: "ev-2",
      kind: "ActionEvent",
      source: "agent",
      tool_name: "finish",
      action: {
        kind: "FinishAction",
        message: [
          "## TK-01 ejecutado y cerrado",
          "",
          "### Resumen de Cambios",
          "- Se erradicó round() en backend/app.",
          "- Similitud coseno en float64 sin clip.",
          "",
          "### Racional Técnico y Decisiones",
          "- float32 colapsaba vectores con delta 1e-5 a 1.0.",
          "- Acumulación en float64 preserva el residuo.",
          "",
          "### Humo y Antipatrones Descartados",
          "- Cero librerías externas innecesarias, solo stdlib y numpy.",
          "",
          "### Estado de Tests",
          "248 passed, 6 skipped en uv run pytest.",
        ].join("\n"),
      },
    },
  ];

  const rationale = extractGarfioRationale(events);
  assert.match(rationale.summary, /Se erradicó round\(\)/);
  assert.match(rationale.decisions, /float32 colapsaba vectores/);
  assert.match(rationale.antiPatternsAvoided, /Cero librerías externas/);
  assert.match(rationale.testStatus, /248 passed/);
});

test("intent: repo_status y roadmap capturan consultas en lenguaje natural y slash", () => {
  const statusPhrases = [
    "/estado",
    "estado",
    "estado del repo",
    "resumen",
    "resumen del repo",
    "cómo venimos",
    "cómo va el repo",
    "qué está hecho",
    "qué se hizo",
    "qué hizo garfio",
    "murray, que hizo garfio? en que esta su trabajo?",
    "en qué está el repo",
    "qué está hecho y qué hay para hacer",
  ];

  for (const phrase of statusPhrases) {
    assert.equal(
      isRepoStatusIntent(phrase),
      true,
      `Falló isRepoStatusIntent para: "${phrase}"`
    );
    const classification = classifyUserText(phrase, { hasSession: true });
    assert.equal(
      classification.action,
      "repo_status",
      `Falló classifyUserText action para: "${phrase}" (obtuvo ${classification.action})`
    );
  }

  const roadmapPhrases = [
    "/roadmap",
    "roadmap",
    "/tickets",
    "tickets",
    "tareas",
    "tareas pendientes",
    "qué hay para hacer",
    "qué falta",
    "próximos tickets",
    "siguiente ticket",
  ];

  for (const phrase of roadmapPhrases) {
    assert.equal(
      isRoadmapIntent(phrase),
      true,
      `Falló isRoadmapIntent para: "${phrase}"`
    );
    const classification = classifyUserText(phrase, { hasSession: true });
    assert.equal(
      classification.action,
      "roadmap",
      `Falló classifyUserText action para: "${phrase}" (obtuvo ${classification.action})`
    );
  }
});

test("chat: slash commands reconocen /push, /pull, /commit, /diff, /estado, /roadmap", () => {
  assert.deepEqual(parseSlash("/push"), { cmd: "push" });
  assert.deepEqual(parseSlash("/pull"), { cmd: "pull" });
  assert.deepEqual(parseSlash('/commit "feat: demo"'), { cmd: "commit", message: '"feat: demo"' });
  assert.deepEqual(parseSlash("/diff"), { cmd: "diff" });
  assert.deepEqual(parseSlash("/estado"), { cmd: "estado" });
  assert.deepEqual(parseSlash("/resumen"), { cmd: "estado" });
  assert.deepEqual(parseSlash("/roadmap"), { cmd: "roadmap" });
  assert.deepEqual(parseSlash("/tickets"), { cmd: "roadmap" });
});

test("inspect: conversación finished con sandbox MISSING no genera acción de heal_openhands", () => {
  const snapshot = {
    resolvedJob: { id: "job1", type: "oh_poll", status: "done", error: "" },
    jobs: [
      { id: "job1", type: "oh_poll", status: "done", error: "" },
      { id: "old_stuck", type: "oh_poll", status: "stuck", error: "timeout" },
    ],
    sandboxes: [],
    openhands: {
      conversation: {
        id: "conv-1",
        execution_status: "finished",
        sandbox_status: "MISSING",
      },
    },
  };

  const analysis = {
    summary: "Diagnóstico",
    actions: [{ type: "heal_openhands", reason: "sandbox missing" }],
    operator_tasks: [],
  };

  const plan = planInspectActions(analysis, snapshot);
  const hasHeal = plan.run.some((a) => a.type === "heal_openhands");
  assert.equal(hasHeal, false, "heal_openhands no debe planearse en sandbox finished");
});

test("coding: describeRepoStatus emite packHitl con APPROVE_PUSH si hay commits pendientes", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "murray-status-test-"));
  const db = openMurrayDb({ dbPath: path.join(tmp, "m.db") });
  const session = createSessionStore({ db });
  const approvals = createApprovalStore();
  const jobs = createJobStore({ db });

  session.patch("chat-123", {
    slug: "demo-repo",
    url: "https://github.com/owner/demo-repo",
  });

  const mockWorkspace = {
    status: async () => ({ branch: "feat/tk01", files: [], clean: true, protected: false }),
    commitsAhead: async () => 1,
    getLastCommitInfo: async () => ({
      hash: "e209b4e",
      author: "Murray",
      subject: "fix(precision): test pass",
      date: new Date().toISOString(),
    }),
    getRoadmapTickets: async () => [
      { id: "TK-01", title: "Precision enforcement", completed: true },
      { id: "TK-02", title: "Cosine difference gate", completed: false },
    ],
  };

  const coding = createCodingSession({
    workspace: mockWorkspace,
    session,
    jobs,
    approvals,
  });

  const res = await coding.describeRepoStatus({ chatId: "chat-123" });
  assert.equal(res.needs_hitl, true, "Debe solicitar HITL");
  assert.match(res.hitl.approve_data, /^APPROVE_PUSH:/, "Debe ser token APPROVE_PUSH");
  assert.match(res.reply, /Estado Ejecutivo: demo-repo/);
  assert.match(res.reply, /<b>1 commit\(s\)<\/b> en local listos para subir/);
  assert.match(res.reply, /TK-01/);
  assert.match(res.reply, /TK-02/);

  mockWorkspace.commitsAhead = async () => 0;
  const resClean = await coding.describeRepoStatus({ chatId: "chat-123" });
  assert.equal(resClean.needs_hitl, false);
  assert.match(resClean.reply, /0 commits ahead/);
});
