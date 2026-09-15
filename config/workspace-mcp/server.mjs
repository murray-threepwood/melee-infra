#!/usr/bin/env node
/**
 * HTTP shim for workspace-mcp.
 *
 * The roadmap package `@j3k0/mcp-google-workspace` is not published on npm
 * (404). This process keeps the Docker service alive, exposes the endpoints
 * n8n calls, and enforces draft-only guardrails in-process.
 *
 * Real Gmail OAuth is completed later by the human operator
 * (roadmap/99_HUMAN_OPERATOR.md). Until then, unread mail is empty and
 * draft creation is accepted only as a guarded stub — never sent.
 */
import http from "node:http";

const PORT = Number.parseInt(process.env.MCP_HTTP_PORT || "8000", 10);
const ALLOW_SENDING = String(process.env.GMAIL_ALLOW_SENDING || "").toLowerCase() === "true";
const ALLOW_DRAFTS = String(process.env.GMAIL_ALLOW_DRAFTS || "").toLowerCase() === "true";

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-murray-gmail-allow-sending": String(ALLOW_SENDING),
    "x-murray-gmail-allow-drafts": String(ALLOW_DRAFTS),
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

function isSendPath(pathname) {
  return /\/gmail\/(send|batch-send|batch_send)\b/i.test(pathname);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && (pathname === "/healthz" || pathname === "/health")) {
    sendJson(res, 200, {
      status: "ok",
      service: "workspace-mcp",
      gmail_allow_sending: ALLOW_SENDING,
      gmail_allow_drafts: ALLOW_DRAFTS,
    });
    return;
  }

  if (isSendPath(pathname) || (ALLOW_SENDING === false && /gmail.*send/i.test(pathname))) {
    sendJson(res, 403, {
      error: "gmail_send_blocked",
      message: "GMAIL_ALLOW_SENDING=false. El envío directo está prohibido; solo borradores.",
    });
    return;
  }

  if (req.method === "GET" && pathname === "/gmail/unread") {
    sendJson(res, 200, {
      unread_count: 0,
      messages: [],
      status: "awaiting_oauth",
    });
    return;
  }

  if (req.method === "POST" && pathname === "/gmail/drafts") {
    if (!ALLOW_DRAFTS) {
      sendJson(res, 403, {
        error: "gmail_drafts_disabled",
        message: "GMAIL_ALLOW_DRAFTS debe ser true para crear borradores.",
      });
      return;
    }
    if (ALLOW_SENDING) {
      sendJson(res, 500, {
        error: "guardrail_violation",
        message: "GMAIL_ALLOW_SENDING no puede ser true en este stack.",
      });
      return;
    }
    await readBody(req);
    sendJson(res, 200, {
      ok: true,
      draft: true,
      sent: false,
      status: "stub_until_oauth",
    });
    return;
  }

  sendJson(res, 404, { error: "not_found", path: pathname });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `workspace-mcp HTTP shim listening on :${PORT} sending=${ALLOW_SENDING} drafts=${ALLOW_DRAFTS}`
  );
  if (ALLOW_SENDING) {
    console.error("CRITICAL: GMAIL_ALLOW_SENDING=true. Este proceso no enviará correo, pero la config viola el guardrail.");
  }
});
