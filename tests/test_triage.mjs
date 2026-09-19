import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeSnapshot,
  formatTriage,
  parseMemStats,
  parseSandboxPs,
} from "../config/murray-agent/triage.mjs";
import { isOpenHandsSandboxName } from "../config/murray-agent/ops.mjs";
import { gitChangeCount } from "../config/murray-agent/openhands.mjs";
import { isTriageIntent } from "../config/murray-agent/intent.mjs";

test("parseSandboxPs: running, 137 y nombres", () => {
  const rows = parseSandboxPs(
    [
      "5kjm0ff6 oh-agent-server-5kJM0FF6M2iukxHMYLfDsw Exited (137) 3 minutes ago",
      "3fr5trzu oh-agent-server-3Fr5TRZuY0T20kfRJFCBou Up 23 hours",
      "deadbeef murray-postgres Up 2 days",
    ].join("\n")
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].exitCode, 137);
  assert.equal(rows[0].running, false);
  assert.equal(rows[1].running, true);
  assert.equal(isOpenHandsSandboxName(rows[0].name), true);
  assert.equal(isOpenHandsSandboxName("murray-postgres"), false);
  assert.equal(isOpenHandsSandboxName("murray-openhands"), false);
});

test("parseMemStats suma el uso, no el límite", () => {
  const mem = parseMemStats(
    [
      "murray-openhands\t473MiB / 3.826GiB",
      "oh-agent-server-abc\t110.7MiB / 3.826GiB",
    ].join("\n")
  );
  assert.ok(mem.usedMiB > 500);
  assert.ok(mem.usedMiB < 700);
  assert.ok(mem.limitMiB > 3000);
});

test("analyzeSnapshot: quieto sin hallazgos ni heal", () => {
  const report = analyzeSnapshot({
    jobs: [{ id: "aa", type: "clone", status: "done", error: "", log: [] }],
    sandboxes: [],
    git: { files: [] },
  });
  assert.equal(report.findings.length, 0);
  assert.equal(report.heal, null);
  assert.equal(report.severity, "ok");
  const text = formatTriage(report);
  assert.match(text, /quieto/i);
  assert.equal(text.includes("ConversationStateUpdateEvent"), false);
});

test("analyzeSnapshot: double_start + 137 + zombies piden heal", () => {
  const report = analyzeSnapshot({
    jobs: [
      {
        id: "e011acbf0c6fb8d6",
        type: "code",
        status: "done",
        error: "",
        log: [
          "OpenHands arrancó (task 94135884d0f84143aa95d700e70ea645).",
          "OpenHands arrancó (task f860e3adbd324a1bbb29e5f746366519).",
        ],
      },
      {
        id: "12c838afe2bfa0f9",
        type: "oh_poll",
        status: "stuck",
        error: "sandbox_error",
        log: ["ConversationStateUpdateEvent: {\"id\":\"nope\"}"],
      },
    ],
    sandboxes: [
      {
        id: "aaa",
        name: "oh-agent-server-dead",
        status: "Exited (137) 1 minute ago",
        running: false,
        exitCode: 137,
      },
      {
        id: "bbb",
        name: "oh-agent-server-old",
        status: "Up 23 hours",
        running: true,
        exitCode: null,
      },
    ],
    git: { files: [] },
    mem: { usedMiB: 3600, limitMiB: 3826 },
  });
  const codes = report.findings.map((row) => row.code);
  assert.equal(codes.includes("double_start"), true);
  assert.equal(codes.includes("sandbox_oom_137"), true);
  assert.equal(codes.includes("zombie_sandbox"), true);
  assert.equal(codes.includes("sandbox_error"), true);
  assert.equal(codes.includes("mem_pressure"), true);
  assert.equal(report.heal?.action, "heal_openhands");
  const text = formatTriage(report);
  assert.match(text, /oh-agent-server/);
  assert.equal(text.includes("ConversationStateUpdateEvent"), false);
  assert.equal(text.includes("{\"id\""), false);
});

test("analyzeSnapshot: empty_finish y paused no sanan Docker solos", () => {
  const empty = analyzeSnapshot({
    jobs: [{ type: "oh_poll", status: "stuck", error: "empty_finish", log: [] }],
    sandboxes: [],
    git: { files: [] },
  });
  assert.equal(empty.findings.some((row) => row.code === "empty_finish"), true);
  assert.equal(empty.heal, null);

  const paused = analyzeSnapshot({
    jobs: [{ type: "oh_poll", status: "stuck", error: "sandbox_paused", log: [] }],
    sandboxes: [],
    git: { files: [] },
  });
  assert.equal(paused.findings.some((row) => row.code === "sandbox_paused"), true);
  assert.equal(paused.heal, null);

  const busy = analyzeSnapshot({
    jobs: [{ type: "oh_poll", status: "running", error: "", log: [] }],
    sandboxes: [
      { id: "1", name: "oh-agent-server-a", running: true, status: "Up 1 minute", exitCode: null },
      { id: "2", name: "oh-agent-server-b", running: true, status: "Up 1 minute", exitCode: null },
    ],
    git: { files: [] },
  });
  assert.equal(busy.findings.some((row) => row.code === "sandbox_busy"), true);
  assert.equal(busy.heal?.action, "heal_openhands");
});

test("gitChangeCount trata items vacíos y objetos sueltos", () => {
  assert.equal(gitChangeCount({ items: [] }), 0);
  assert.equal(gitChangeCount({}), 0);
  assert.equal(gitChangeCount({ items: ["README.md"] }), 1);
});

test("isTriageIntent: qué pasa, no el UUID suelto", () => {
  assert.equal(isTriageIntent("qué pasa"), true);
  assert.equal(isTriageIntent("Murray, qué pasa?"), true);
  assert.equal(isTriageIntent("qué pasa con el obrero"), true);
  assert.equal(isTriageIntent("qué pasó"), true);
  assert.equal(isTriageIntent("en qué andas murray"), true);
  assert.equal(isTriageIntent("diagnosticá"), true);
  assert.equal(isTriageIntent("triage"), true);
  assert.equal(isTriageIntent("/triage"), true);
  assert.equal(isTriageIntent("bff74f890aed3d41"), false);
  assert.equal(isTriageIntent("en qué quedó task 460fdf35f8e54fb996d8c52d9eb01057"), false);
});
