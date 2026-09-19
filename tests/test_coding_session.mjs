import assert from "node:assert/strict";
import { test } from "node:test";
import { detectStuck, isAgentDone, isSandboxPaused, summarizeEvents } from "../config/murray-agent/openhands.mjs";
import {
  classifyUserText,
  extractDeletePath,
  extractJobId,
  extractJobRefs,
  extractTestCommand,
  isAffirmative,
  isHitlStuck,
  isResumeMission,
} from "../config/murray-agent/intent.mjs";
import { parseWorkspaceCallback } from "../config/murray-agent/coding.mjs";
import { looksLikeHitlCopy } from "../config/murray-agent/reply.mjs";

export const FIRST_MURRAY_PLAN = `Ahí está, patrón: la rama existe y el árbol está limpio.

Estado real:
- Repo: hbauzan-semantic-firewall
- Rama: feat/l01-embedder-determinism (no protegida, o sea push permitido)
- Working tree: limpio, cero archivos modificados

Para arrancar de verdad necesito que apruebes la misión de código. La instrucción es:
- Crear backend/tests/test_embedder_determinism.py (N=100).
- Test: cd backend && uv run pytest -q tests/test_embedder_determinism.py

¿Te re-disparo la tarjeta de propose_code_mission para que aparezca el botón Aprobar?`;

test("classify: clone sin URL pregunta; mutate sin repo pregunta", () => {
  assert.equal(classifyUserText("cloná algo").action, "clarify_clone_url");
  assert.equal(classifyUserText("mejorá el README").action, "clarify_repo");
  assert.equal(
    classifyUserText("cloná https://github.com/octocat/Hello-World").action,
    "propose_clone"
  );
  assert.equal(
    classifyUserText("agregá un test", { hasSession: true }).action,
    "maybe_code_mission"
  );
  assert.equal(
    classifyUserText("creá backend/tests/test_embedder_determinism.py", {
      hasSession: true,
    }).action,
    "maybe_code_mission"
  );
  assert.equal(classifyUserText("si", { hasSession: true }).action, "confirm_code");
  assert.equal(classifyUserText("dale", { hasSession: true }).action, "confirm_code");
  assert.equal(classifyUserText("si").action, "chat");
  assert.equal(
    classifyUserText("no me da los botones", { hasSession: true }).action,
    "hitl_help"
  );
  assert.equal(classifyUserText("pusheá").action, "propose_push");
  assert.equal(
    classifyUserText("o sea push permitido, creá el test de L01", {
      hasSession: true,
    }).action,
    "maybe_code_mission"
  );
});

test("classify: estado de jobs no va al LLM de código", () => {
  assert.equal(classifyUserText("estado de los jobs").action, "list_jobs");
  assert.equal(classifyUserText("cómo van los jobs").action, "list_jobs");
  assert.equal(extractJobId("/jobs aabbccddeeff0011"), "aabbccddeeff0011");
  assert.equal(
    classifyUserText("jobs aabbccddeeff0011").jobId,
    "aabbccddeeff0011"
  );
  assert.equal(extractJobId("bff74f890aed3d41"), "bff74f890aed3d41");
  assert.equal(
    extractJobRefs("task 460fdf35f8e54fb996d8c52d9eb01057").ohId,
    "460fdf35f8e54fb996d8c52d9eb01057"
  );
  assert.equal(
    extractJobRefs("fijate el bff74f890aed3d41").ref,
    "bff74f890aed3d41"
  );
  assert.equal(classifyUserText("qué pasó").action, "triage");
  assert.equal(classifyUserText("qué pasa").action, "triage");
  assert.equal(classifyUserText("Murray, qué pasa?").action, "triage");
  assert.equal(classifyUserText("qué pasa con el obrero").action, "triage");
  assert.equal(classifyUserText("diagnosticá").action, "triage");
  assert.equal(classifyUserText("triage").action, "triage");
  assert.equal(
    classifyUserText("en qué quedó task 460fdf35f8e54fb996d8c52d9eb01057").action,
    "diagnose_job"
  );
  assert.equal(
    classifyUserText("en qué quedó task 460fdf35f8e54fb996d8c52d9eb01057").jobId,
    "460fdf35f8e54fb996d8c52d9eb01057"
  );
  assert.equal(classifyUserText("bff74f890aed3d41").action, "diagnose_job");
});

test("classify: manual y cerebro de garfio", () => {
  assert.equal(classifyUserText("/manual").action, "manual");
  assert.equal(classifyUserText("/help").action, "manual");
  assert.equal(classifyUserText("manual").action, "manual");
  assert.equal(classifyUserText("ayuda").action, "manual");
  assert.equal(classifyUserText("mostrame los comandos").action, "manual");

  assert.equal(classifyUserText("qué cerebro tiene garfio").action, "garfio_brain");
  assert.equal(classifyUserText("qué cerebro tiene garfio").model, "");
  assert.equal(classifyUserText("cambiale el cerebro a garfio por deepseek-chat").action, "garfio_brain");
  assert.equal(classifyUserText("cambiale el cerebro a garfio por deepseek-chat").model, "deepseek-chat");
  assert.equal(classifyUserText("cerebro garfio gemini-3.8-flash").action, "garfio_brain");
  assert.equal(classifyUserText("cerebro garfio gemini-3.8-flash").model, "gemini-3.8-flash");
});


test("classify: seguí / retomá re-arma HITL, no es chat", () => {
  assert.equal(isResumeMission("seguí con L01"), true);
  assert.equal(isResumeMission("retomá"), true);
  assert.equal(isResumeMission("continuá la misión"), true);
  assert.equal(isResumeMission("mejorá el README"), false);
  assert.equal(
    classifyUserText("seguí con L01", { hasSession: true }).action,
    "confirm_code"
  );
  assert.equal(classifyUserText("seguí con L01").action, "clarify_repo");
});

test("classify: borrar / push / pull / commit", () => {
  assert.equal(extractDeletePath("borrá todo el workspace"), ".");
  assert.equal(extractDeletePath("eliminá node_modules"), "node_modules");
  assert.equal(classifyUserText("borrá octocat-Hello-World").action, "propose_delete");
  assert.equal(classifyUserText("borrá").action, "clarify_delete_path");
  assert.equal(classifyUserText("pusheá").action, "propose_push");
  assert.equal(classifyUserText("hacé pull").action, "pull");
  assert.equal(classifyUserText('commiteá "feat: disco"').message, "feat: disco");
  assert.equal(classifyUserText("checkout -b feat/limpieza").action, "checkout");
  assert.equal(classifyUserText("cambiá de rama feat/limpieza").branch, "feat/limpieza");
});

test("extractTestCommand: Comando: explícito; no dispara por mencionar pytest", () => {
  assert.equal(
    extractTestCommand(
      "OK confirmado. creá backend/tests/test_embedder_determinism.py.\n\nComando: cd backend && uv run pytest -q tests/test_embedder_determinism.py"
    ),
    "cd backend && uv run pytest -q tests/test_embedder_determinism.py"
  );
  assert.equal(
    extractTestCommand(
      "- Test: cd backend && uv run pytest -q tests/test_embedder_determinism.py"
    ),
    "cd backend && uv run pytest -q tests/test_embedder_determinism.py"
  );
  assert.equal(extractTestCommand(FIRST_MURRAY_PLAN), "cd backend && uv run pytest -q tests/test_embedder_determinism.py");
  assert.equal(extractTestCommand("mejorá el README y corré npm test"), "npm test");
  assert.equal(extractTestCommand("¿pytest está en el repo?"), "");
  assert.equal(extractTestCommand("agregá un healthcheck"), "");
});

test("looksLikeHitlCopy detecta prosa de Aprobar sin flag", () => {
  assert.equal(looksLikeHitlCopy("Pido Aprobar la misión de código. Tocá Aprobar."), true);
  assert.equal(looksLikeHitlCopy(FIRST_MURRAY_PLAN), true);
  assert.equal(looksLikeHitlCopy("necesito que apruebes la misión"), true);
  assert.equal(looksLikeHitlCopy("Núcleo: leí el README."), false);
});

test("isAffirmative es mensaje corto; isHitlStuck es tranca de teclado", () => {
  assert.equal(isAffirmative("si"), true);
  assert.equal(isAffirmative("dale, mandá el teclado"), true);
  assert.equal(
    isAffirmative(
      "OK confirmado. creá backend/tests/foo.py.\n\nComando: cd backend && uv run pytest"
    ),
    false
  );
  assert.equal(isHitlStuck("no me da los botones"), true);
  assert.equal(isHitlStuck("cómo está la rama"), false);
});

test("callback workspace cabe en 64 bytes y parsea", () => {
  const id = "aabbccddeeff0011";
  const approve = `APPROVE_CLONE:${id}`;
  assert.equal(approve.length <= 64, true);
  assert.deepEqual(parseWorkspaceCallback(approve), {
    family: "clone",
    verb: "APPROVE",
    id,
  });
  assert.equal(parseWorkspaceCallback(`APPROVE_DELETE:${id}`).family, "delete");
  assert.equal(parseWorkspaceCallback(`APPROVE_PUSH:${id}`).family, "push");
  assert.equal(`APPROVE_DELETE:${id}`.length <= 64, true);
  assert.equal(`APPROVE_PUSH:${id}`.length <= 64, true);
  assert.equal(parseWorkspaceCallback(`STUCK_RETRY:${id}`).verb, "RETRY");
  assert.equal(parseWorkspaceCallback("APPROVE_OPS:x"), null);
});

test("detectStuck: execution_status, timeout y loop de comandos", () => {
  assert.equal(detectStuck({ executionStatus: "stuck" }).stuck, true);
  assert.equal(
    detectStuck({
      startedAt: 0,
      now: 13 * 60 * 1000,
      maxMs: 12 * 60 * 1000,
    }).reason,
    "timeout"
  );
  const loop = detectStuck({
    events: [
      {
        kind: "ObservationEvent",
        payload: { command: "npm test", exit_code: 1 },
      },
      {
        kind: "ObservationEvent",
        payload: { command: "npm test", exit_code: 1 },
      },
      {
        kind: "ObservationEvent",
        payload: { command: "npm test", exit_code: 1 },
      },
    ],
    startedAt: Date.now(),
    now: Date.now(),
  });
  assert.equal(loop.stuck, true);
  assert.equal(loop.reason, "stuck_loop_detected");
  assert.equal(loop.repeats, 3);
  assert.equal(isAgentDone({ executionStatus: "finished", sandboxStatus: "RUNNING" }), true);
  assert.equal(
    isAgentDone({ executionStatus: null, sandboxStatus: "PAUSED" }),
    false
  );
  assert.equal(
    isAgentDone({ executionStatus: "paused", sandboxStatus: "PAUSED" }),
    false
  );
  assert.equal(
    isAgentDone({ executionStatus: "finished", sandboxStatus: "PAUSED" }),
    true
  );
  assert.equal(
    isSandboxPaused({ executionStatus: null, sandboxStatus: "PAUSED" }),
    true
  );
  assert.equal(
    isSandboxPaused({ executionStatus: "finished", sandboxStatus: "PAUSED" }),
    false
  );
  assert.equal(
    detectStuck({
      executionStatus: null,
      sandboxStatus: "PAUSED",
      startedAt: Date.now(),
      now: Date.now(),
    }).stuck,
    false
  );
  assert.match(summarizeEvents([{ kind: "MessageEvent", payload: "ok" }]), /MessageEvent/);
});
