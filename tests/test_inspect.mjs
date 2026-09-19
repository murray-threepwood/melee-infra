import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { classifyUserText, isTriageIntent } from "../config/murray-agent/intent.mjs";
import {
  collectSnapshot,
  compactSnapshot,
  executeInspectPlan,
  parseInspectAnalysis,
  planInspectActions,
  SNAPSHOT_LLM_CHARS,
} from "../config/murray-agent/inspect.mjs";
import { createOperatorInbox } from "../config/murray-agent/operator-inbox.mjs";
import { openMurrayDb } from "../config/murray-agent/db.mjs";
import { createLlm } from "../config/murray-agent/llm.mjs";

test("classify: qué pasó / triage / en qué andas → inspect; /jobs crudo intacto", () => {
  assert.equal(classifyUserText("qué pasó").action, "inspect");
  assert.equal(classifyUserText("qué pasa").action, "inspect");
  assert.equal(classifyUserText("Murray, qué pasa?").action, "inspect");
  assert.equal(classifyUserText("qué pasa con el obrero").action, "inspect");
  assert.equal(classifyUserText("diagnosticá").action, "inspect");
  assert.equal(classifyUserText("triage").action, "inspect");
  assert.equal(classifyUserText("en qué andas murray").action, "inspect");
  assert.equal(isTriageIntent("en qué andas murray"), true);
  assert.equal(classifyUserText("estado de los jobs").action, "list_jobs");
  assert.equal(classifyUserText("jobs aabbccddeeff0011").action, "diagnose_job");
  assert.equal(
    classifyUserText("en qué quedó task 460fdf35f8e54fb996d8c52d9eb01057").action,
    "inspect"
  );
  assert.equal(
    classifyUserText("en qué quedó task 460fdf35f8e54fb996d8c52d9eb01057").jobId,
    "460fdf35f8e54fb996d8c52d9eb01057"
  );
  assert.equal(classifyUserText("bff74f890aed3d41").action, "inspect");
});

test("snapshot redacta session_api_key y LITELLM_MASTER_KEY; cap duro", async () => {
  const snapshot = await collectSnapshot({
    chatId: "1",
    jobRef: "aabbccddeeff0011",
    now: 1,
    jobs: {
      list: () => [
        {
          id: "aabbccddeeff0011",
          type: "oh_poll",
          status: "stuck",
          error: "timeout",
          createdAt: 1,
          payload: { slug: "demo", conversationId: "c1" },
        },
      ],
      find: () => ({
        id: "aabbccddeeff0011",
        type: "oh_poll",
        status: "stuck",
        error: "timeout",
        createdAt: 1,
        payload: { slug: "demo", conversationId: "c1" },
      }),
    },
    session: {
      get: () => ({
        slug: "demo",
        lastMission: "feat",
        lastTestCommand: "npm test",
        active_model: "murray-chat",
      }),
    },
    openhands: {
      getConversation: async () => ({
        id: "c1",
        execution_status: null,
        sandbox_status: "ERROR",
        session_api_key: "sk-secret-session-key",
        sessionApiKey: "sk-also-secret",
      }),
    },
    workspace: {
      status: async () => ({ branch: "feat/x", files: ["M README.md"] }),
      commitsAhead: async () => 2,
    },
    ops: {
      listOpenHandsSandboxes: async () => [
        { id: "abc123def456", name: "oh-agent-server-z", status: "Exited", running: false },
      ],
      ps: async () => ({ stdout: "n8n Up\n", stderr: "" }),
      memorySnapshot: async () => ({ usedMiB: 100, limitMiB: 200 }),
      logs: async (service) => ({
        stdout: `${service} LITELLM_MASTER_KEY=sk-litellm-master-value`,
        stderr: "",
      }),
    },
    readDoc: (name) => `doc ${name} LITELLM_MASTER_KEY=sk-from-doc`,
  });
  assert.equal(snapshot.openhands.conversation.session_api_key, undefined);
  const dump = compactSnapshot(snapshot);
  assert.equal(dump.includes("sk-secret-session-key"), false);
  assert.equal(dump.includes("session_api_key"), false);
  assert.equal(dump.includes("sk-litellm-master-value"), false);
  assert.equal(dump.includes("sk-from-doc"), false);
  assert.ok(dump.length <= SNAPSHOT_LLM_CHARS);
  const huge = compactSnapshot({ pad: "x".repeat(SNAPSHOT_LLM_CHARS + 500) });
  assert.equal(huge.length, SNAPSHOT_LLM_CHARS);
});

test("schema rechaza docker exec; postgres no corre; heal sí si hay finding", async () => {
  const analysis = parseInspectAnalysis(
    JSON.stringify({
      summary: "sandbox muerto",
      what_happened: "137",
      what_did_not: "nada",
      actions: [
        { type: "docker exec", reason: "sh" },
        { type: "heal_openhands", reason: "zombie" },
        { type: "recreate", service: "postgres_db", reason: "dato" },
        { type: "restart", service: "openhands", reason: "extra" },
      ],
      operator_tasks: [],
    }),
    {}
  );
  assert.equal(analysis.actions[0].type, "operator_task");
  const snapshot = {
    jobs: [{ type: "oh_poll", status: "failed", error: "sandbox_oom_137" }],
    sandboxes: [{ name: "oh-agent-server-z" }],
    openhands: { conversation: { sandbox_status: "ERROR" } },
  };
  const plan = planInspectActions(analysis, snapshot);
  assert.equal(plan.run.some((row) => row.type === "heal_openhands"), true);
  assert.equal(plan.run.some((row) => row.service === "postgres_db"), false);
  assert.equal(plan.run.filter((row) => row.type === "restart" || row.type === "recreate").length, 1);
  assert.equal(
    plan.tasks.some((task) => /postgres/i.test(task.title)),
    true
  );
  const seen = [];
  const results = await executeInspectPlan(plan, {
    ops: {
      healOpenHands: async () => {
        seen.push("heal");
        return { removed: ["oh-agent-server-z"] };
      },
      restart: async (service) => {
        seen.push(`restart:${service}`);
        return { code: 0 };
      },
      recreate: async (service) => {
        seen.push(`recreate:${service}`);
        return { code: 0 };
      },
    },
  });
  assert.deepEqual(seen, ["heal", "restart:openhands"]);
  assert.equal(results.some((row) => row.service === "postgres_db"), false);
});

test("JSON ilegible cae a fallback llm_inspect_unparseable", () => {
  const parsed = parseInspectAnalysis("no es json", {
    resolvedJob: { error: "timeout" },
  });
  assert.equal(parsed.unparseable, true);
  assert.equal(parsed.operator_tasks[0].why, "llm_inspect_unparseable");
});

test("operator-inbox append redacta y duplica en sqlite; no hay git commit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "murray-inbox-"));
  const db = openMurrayDb({ filePath: path.join(dir, "murray.db") });
  const inbox = createOperatorInbox({ root: path.join(dir, "inbox"), db, now: () => Date.parse("2026-09-19T16:00:00.000Z") });
  const note = inbox.append({
    chatId: "9",
    jobId: "aabbccddeeff0011",
    title: "Editar openhands.mjs",
    why: "arquitectura",
    path: "config/murray-agent/openhands.mjs",
    body: "token sk-abc123secret no va",
  });
  assert.equal(note.rel, "2026-09-19.md");
  const text = fs.readFileSync(note.abs, "utf8");
  assert.match(text, /Editar openhands/);
  assert.equal(text.includes("sk-abc123secret"), false);
  assert.match(text, /sk-REDACTED|sk-abcREDACTED/);
  const rows = inbox.list({ chatId: "9" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title.includes("openhands"), true);
  assert.equal(fs.existsSync(path.join(dir, "inbox", ".git")), false);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("compose monta docs :ro y operator-inbox rw", () => {
  const compose = fs.readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  assert.match(compose, /CHANGELOG\.md:\/opt\/docs\/CHANGELOG\.md:ro/);
  assert.match(compose, /CONTEXT\.md:\/opt\/docs\/CONTEXT\.md:ro/);
  assert.match(compose, /91_PERMISSIVE_WINDOW\.md:\/opt\/docs\/permissive\.md:ro/);
  assert.match(compose, /operator-inbox:\/opt\/operator-inbox/);
  assert.doesNotMatch(compose, /murray-infra\/\.git/);
});

test("inspect llm.complete omite tools y baja temperature", async () => {
  const seen = [];
  const llm = createLlm({
    apiKey: "sk-test-master-not-a-placeholder",
    baseUrl: "http://litellm:4000",
    fetchImpl: async (_url, opts) => {
      seen.push(JSON.parse(opts.body));
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"summary":"ok","what_happened":"x","what_did_not":"y","actions":[],"operator_tasks":[]}' } }],
        }),
      };
    },
  });
  const { analyzeInspectSnapshot } = await import("../config/murray-agent/inspect.mjs");
  await analyzeInspectSnapshot({ jobs: [] }, { llm, model: "murray-chat" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tools, undefined);
  assert.equal(seen[0].tool_choice, undefined);
  assert.equal(seen[0].temperature, 0.1);
  assert.equal(seen[0].model, "murray-chat");
});
