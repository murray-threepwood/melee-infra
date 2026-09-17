#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApprovalStore } from "./approvals.mjs";
import { createChatEngine } from "./chat.mjs";
import { readDoc } from "./docs.mjs";
import { fetchGmailMeta } from "./gmail-meta.mjs";
import { createLlm } from "./llm.mjs";
import { createMemory } from "./memory.mjs";
import { createOps } from "./ops.mjs";

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
  const ops = createOps();
  const llm = createLlm();
  const memory = createMemory();
  const approvals = createApprovalStore();
  return createChatEngine({
    ops,
    llm,
    memory,
    approvals,
    gmailMeta: () => fetchGmailMeta(),
    readDoc,
    personaText,
  });
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  const port = Number.parseInt(process.env.MURRAY_AGENT_PORT || "8080", 10);
  const engine = createEngineFromEnv();
  const server = createMurrayAgentServer({ engine });
  server.listen(port, "0.0.0.0", () => {
    console.log(`murray-agent listening on :${port}`);
  });
}
