#!/usr/bin/env node
/**
 * HTTP shim for workspace-mcp.
 *
 * The roadmap package `@j3k0/mcp-google-workspace` is not published on npm
 * (404). This process exposes the endpoints n8n calls, talks to Gmail API
 * with the operator OAuth refresh token, and enforces draft-only guardrails.
 *
 * There is no send implementation. Routes that look like send return 403
 * before Gmail is touched.
 */
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGmailClient, readGauthClient } from "./gmail-client.mjs";

function sendJson(res, status, body, flags) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-murray-gmail-allow-sending": String(flags.allowSending),
    "x-murray-gmail-allow-drafts": String(flags.allowDrafts),
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
  return /\/gmail\/(.*\/)?(send|batch-send|batch_send)\b/i.test(pathname);
}

function mapGmailError(err) {
  const code = err.code || "gmail_api_failed";
  const status = Number(err.status) || (code === "gmail_oauth_missing" ? 503 : 502);
  return {
    status,
    body: {
      error: code,
      message: err.message || "gmail error",
    },
  };
}

export function createWorkspaceMcpServer({
  allowSending = false,
  allowDrafts = true,
  gmailClient,
  gmailMode = "live",
} = {}) {
  if (!gmailClient || typeof gmailClient.listUnread !== "function") {
    throw new Error("createWorkspaceMcpServer requiere gmailClient.listUnread");
  }

  const flags = {
    allowSending: allowSending === true,
    allowDrafts: allowDrafts === true,
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (req.method === "GET" && (pathname === "/healthz" || pathname === "/health")) {
        sendJson(
          res,
          200,
          {
            status: "ok",
            service: "workspace-mcp",
            gmail_allow_sending: flags.allowSending,
            gmail_allow_drafts: flags.allowDrafts,
            gmail_mode: gmailMode,
          },
          flags
        );
        return;
      }

      if (isSendPath(pathname) || (flags.allowSending === false && /gmail.*send/i.test(pathname))) {
        sendJson(
          res,
          403,
          {
            error: "gmail_send_blocked",
            message: "GMAIL_ALLOW_SENDING=false. El envío directo está prohibido; solo borradores.",
          },
          flags
        );
        return;
      }

      if (req.method === "GET" && pathname === "/gmail/unread") {
        const result = await gmailClient.listUnread();
        sendJson(res, 200, result, flags);
        return;
      }

      if (req.method === "POST" && pathname === "/gmail/drafts") {
        if (!flags.allowDrafts) {
          sendJson(
            res,
            403,
            {
              error: "gmail_drafts_disabled",
              message: "GMAIL_ALLOW_DRAFTS debe ser true para crear borradores.",
            },
            flags
          );
          return;
        }
        if (flags.allowSending) {
          sendJson(
            res,
            500,
            {
              error: "guardrail_violation",
              message: "GMAIL_ALLOW_SENDING no puede ser true en este stack.",
            },
            flags
          );
          return;
        }
        const raw = await readBody(req);
        let payload = {};
        if (raw.trim()) {
          try {
            payload = JSON.parse(raw);
          } catch {
            sendJson(
              res,
              400,
              { error: "gmail_draft_invalid", message: "JSON de borrador inválido" },
              flags
            );
            return;
          }
        }
        const result = await gmailClient.createDraft(payload);
        sendJson(res, 200, result, flags);
        return;
      }

      sendJson(res, 404, { error: "not_found", path: pathname }, flags);
    } catch (err) {
      const mapped = mapGmailError(err);
      sendJson(res, mapped.status, mapped.body, flags);
    }
  });
}

function envFlag(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

export function createServerFromEnv() {
  const allowSending = envFlag("GMAIL_ALLOW_SENDING");
  const allowDrafts = envFlag("GMAIL_ALLOW_DRAFTS");
  const fallbackClients = [];
  try {
    const fromGauth = readGauthClient("/app/auth/.gauth.json");
    if (fromGauth) {
      fallbackClients.push(fromGauth);
    }
  } catch {
    // .gauth.json es opcional; el env alcanza si client y refresh coinciden.
  }
  let gmailClient;
  let gmailMode = "live";
  try {
    gmailClient = createGmailClient({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
      fallbackClients,
    });
  } catch (err) {
    gmailMode = "unconfigured";
    console.error(`workspace-mcp OAuth unconfigured: ${err.code || err.name}: ${err.message}`);
    gmailClient = {
      listUnread: async () => {
        throw err;
      },
      createDraft: async () => {
        throw err;
      },
    };
  }
  if (allowSending) {
    console.error(
      "CRITICAL: GMAIL_ALLOW_SENDING=true. Este proceso no enviará correo, pero la config viola el guardrail."
    );
  }
  return createWorkspaceMcpServer({
    allowSending,
    allowDrafts,
    gmailClient,
    gmailMode,
  });
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  const port = Number.parseInt(process.env.MCP_HTTP_PORT || "8000", 10);
  const server = createServerFromEnv();
  server.listen(port, "0.0.0.0", () => {
    console.log(
      `workspace-mcp Gmail API listening on :${port} sending=${envFlag("GMAIL_ALLOW_SENDING")} drafts=${envFlag("GMAIL_ALLOW_DRAFTS")}`
    );
  });
}
