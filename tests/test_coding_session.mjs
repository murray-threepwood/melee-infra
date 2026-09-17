import assert from "node:assert/strict";
import { test } from "node:test";
import { detectStuck, isAgentDone, summarizeEvents } from "../config/murray-agent/openhands.mjs";
import { classifyUserText } from "../config/murray-agent/intent.mjs";
import { parseWorkspaceCallback } from "../config/murray-agent/coding.mjs";

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
  assert.match(summarizeEvents([{ kind: "MessageEvent", payload: "ok" }]), /MessageEvent/);
});
