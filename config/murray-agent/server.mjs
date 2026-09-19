#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApprovalStore } from "./approvals.mjs";
import { createChatEngine } from "./chat.mjs";
import { createCodingSession } from "./coding.mjs";
import { openMurrayDb } from "./db.mjs";
import { readDoc } from "./docs.mjs";
import { fetchGmailMeta } from "./gmail-meta.mjs";
import { createJobStore, createJobWorker } from "./jobs.mjs";
import { createLlm } from "./llm.mjs";
import { createMemory } from "./memory.mjs";
import { createOpenHandsClient } from "./openhands.mjs";
import { createOps } from "./ops.mjs";
import { createSeenEmailStore } from "./seen-emails.mjs";
import { createSessionStore } from "./session.mjs";
import { createTelegramNotifier } from "./telegram.mjs";
import { createSandboxJanitor } from "./sandbox-ttl.mjs";
import { createWorkspace } from "./workspace.mjs";
import { createGarfioStore } from "./garfio-store.mjs";
import { createOperatorInbox } from "./operator-inbox.mjs";

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

export function createMurrayAgentServer({
  engine,
  seen,
  model = process.env.DEEPSEEK_MODEL || "deepseek-chat",
} = {}) {
  if (!engine || typeof engine.handleChat !== "function") {
    throw new Error("createMurrayAgentServer requiere engine.handleChat");
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (req.method === "GET" && (pathname === "/healthz" || pathname === "/health")) {
        sendJson(res, 200, {
          status: "ok",
          service: "murray-agent",
          model,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/chat") {
        const body = await parseJsonBody(req);
        const result = await engine.handleChat({
          chat_id: body.chat_id,
          text: body.text,
          message_id: body.message_id,
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/ops/execute") {
        const body = await parseJsonBody(req);
        const result = await engine.executeOps({
          approval_id: body.approval_id,
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/ops/reject") {
        const body = await parseJsonBody(req);
        const result = await engine.rejectOps({
          approval_id: body.approval_id,
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/triage/filter") {
        if (!seen || typeof seen.filterNew !== "function") {
          sendJson(res, 503, { error: "seen_store_unconfigured" });
          return;
        }
        const body = await parseJsonBody(req);
        if (!Array.isArray(body.ids)) {
          sendJson(res, 400, { error: "ids_required" });
          return;
        }
        sendJson(res, 200, { new_ids: seen.filterNew(body.ids) });
        return;
      }

      if (req.method === "POST" && pathname === "/triage/mark-seen") {
        if (!seen || typeof seen.markSeen !== "function") {
          sendJson(res, 503, { error: "seen_store_unconfigured" });
          return;
        }
        const body = await parseJsonBody(req);
        const messageId = String(body.message_id || "").trim();
        if (!messageId) {
          sendJson(res, 400, { error: "message_id_required" });
          return;
        }
        seen.markSeen({
          messageId,
          threadId: String(body.thread_id || ""),
        });
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (req.method === "POST" && pathname === "/workspace/hitl") {
        if (typeof engine.handleWorkspaceHitl !== "function") {
          sendJson(res, 503, { error: "coding_session_unconfigured" });
          return;
        }
        const body = await parseJsonBody(req);
        const result = await engine.handleWorkspaceHitl({
          callback_data: body.callback_data,
          chat_id: body.chat_id,
        });
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { error: "not_found", path: pathname });
    } catch (err) {
      const status = Number(err.status) || (err.code === "ops_approval_denied" ? 403 : 500);
      sendJson(res, status, {
        error: err.code || "murray_agent_failed",
        message: err.message || "murray-agent error",
      });
    }
  });
}

export function createEngineFromEnv() {
  const personaPath =
    process.env.MURRAY_PERSONA_PATH ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "persona.md");
  const personaText = fs.readFileSync(personaPath, "utf8");
  const db = openMurrayDb();
  const ops = createOps();
  const llm = createLlm();
  const memory = createMemory({ db });
  const approvals = createApprovalStore({ db });
  const session = createSessionStore({ db });
  const seen = createSeenEmailStore({ db });
  const workspace = createWorkspace();
  const jobs = createJobStore({ db });
  const openhands = createOpenHandsClient();
  const telegram = createTelegramNotifier();
  const janitor = createSandboxJanitor({ ops, store: jobs });
  const garfio = createGarfioStore({ db });
  const operatorInbox = createOperatorInbox({ db });
  const workerRef = { current: null };
  const coding = createCodingSession({
    workspace,
    session,
    jobs,
    approvals,
    openhands,
    telegram,
    ops,
    garfioStore: garfio,
    llm,
    readDoc,
    operatorInbox,
    worker: {
      kick(id) {
        return workerRef.current ? workerRef.current.kick(id) : Promise.resolve(null);
      },
    },
  });
  workerRef.current = createJobWorker({
    store: jobs,
    handlers: coding.handlers,
    intervalMs: Number(process.env.MURRAY_JOB_INTERVAL_MS || 2000),
    onBeforeCodeKick: (job) => janitor.purgeOrphans({ exceptJobId: job.id }),
  });
  const engine = createChatEngine({
    ops,
    llm,
    memory,
    approvals,
    gmailMeta: () => fetchGmailMeta(),
    seen,
    readDoc,
    personaText,
    coding,
    workspace,
    session,
    garfioStore: garfio,
  });
  return { engine, jobs, worker: workerRef.current, seen, janitor, garfio };
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  const port = Number.parseInt(process.env.MURRAY_AGENT_PORT || "8080", 10);
  const { engine, worker, seen, janitor } = createEngineFromEnv();
  const server = createMurrayAgentServer({ engine, seen });
  server.listen(port, "0.0.0.0", () => {
    console.log(`murray-agent listening on :${port}`);
    worker.start();
    janitor.start();
  });
}
