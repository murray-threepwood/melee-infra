/**
 * Gmail API adapter (draft-only).
 *
 * Public surface: listUnread + createDraft. There is no send() on purpose.
 * Callers inject fetchImpl so tests never hit Google.
 */
import fs from "node:fs";

export const GMAIL_PATHS = Object.freeze({
  token: "https://oauth2.googleapis.com/token",
  messages: "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  drafts: "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
  profile: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
});

export const DEFAULT_REPLY_BODY =
  "[Murray · borrador draft-only. Editá y enviá desde Gmail. No se envió nada.]";

export class GmailConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "GmailConfigError";
    this.code = "gmail_oauth_missing";
    this.status = 503;
  }
}

export class GmailApiError extends Error {
  constructor(message, status = 502, code = "gmail_api_failed") {
    super(message);
    this.name = "GmailApiError";
    this.code = code;
    this.status = status;
  }
}

export function toBase64Url(text) {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function replySubject(subject) {
  const value = String(subject || "").trim() || "(sin asunto)";
  return /^re:\s?/i.test(value) ? value : `Re: ${value}`;
}

export function buildReplyRfc822({
  to,
  subject,
  body,
  inReplyTo = "",
  references = "",
  from = "",
}) {
  const lines = [];
  if (from) {
    lines.push(`From: ${from}`);
  }
  lines.push(`To: ${to}`);
  lines.push(`Subject: ${replySubject(subject)}`);
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=UTF-8");
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${references || inReplyTo}`);
  }
  lines.push("");
  lines.push(body);
  return lines.join("\r\n");
}

function headerValue(payload, name) {
  const headers = payload?.headers || [];
  const found = headers.find(
    (item) => String(item.name || "").toLowerCase() === name.toLowerCase()
  );
  return found ? String(found.value || "") : "";
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function normalizeSecret(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

export function readGauthClient(gauthPath) {
  const parsed = JSON.parse(fs.readFileSync(gauthPath, "utf8"));
  const cred = parsed.web || parsed.installed || {};
  const clientId = normalizeSecret(cred.client_id);
  const clientSecret = normalizeSecret(cred.client_secret);
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

function isPlaceholderCredential(value) {
  return /REEMPLAZAR|ejemploRefreshToken|ejemplo-client-id|CAMBIAR_POR/i.test(
    String(value || "")
  );
}

export function assertGmailCredentials({ clientId, clientSecret, refreshToken }) {
  const id = normalizeSecret(clientId);
  const secret = normalizeSecret(clientSecret);
  const refresh = normalizeSecret(refreshToken);
  if (!id || !secret || !refresh) {
    throw new GmailConfigError(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN ausentes"
    );
  }
  if ([id, secret, refresh].some(isPlaceholderCredential)) {
    throw new GmailConfigError("GOOGLE_* siguen siendo placeholders de .env.example");
  }
  return { clientId: id, clientSecret: secret, refreshToken: refresh };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true };
  }
}

export function createGmailClient({
  clientId,
  clientSecret,
  refreshToken,
  fallbackClients = [],
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  timeoutMs = 10_000,
  maxUnread = 15,
} = {}) {
  const creds = assertGmailCredentials({ clientId, clientSecret, refreshToken });
  const clientChain = [
    creds,
    ...fallbackClients
      .map((item) => ({
        clientId: normalizeSecret(item.clientId),
        clientSecret: normalizeSecret(item.clientSecret),
        refreshToken: creds.refreshToken,
      }))
      .filter(
        (item) =>
          item.clientId &&
          item.clientSecret &&
          item.clientId !== creds.clientId
      ),
  ];
  let cachedToken = "";
  let expiresAt = 0;

  async function request(url, init = {}) {
    const response = await fetchImpl(url, {
      ...init,
      signal: init.signal || AbortSignal.timeout(timeoutMs),
    });
    const data = await readJson(response);
    if (!response.ok) {
      const googleError = data.error?.message || data.error || `HTTP ${response.status}`;
      const errorCode =
        data.error?.status ||
        data.error?.code ||
        (typeof data.error === "string" ? data.error : "") ||
        `HTTP ${response.status}`;
      console.error(`gmail-client HTTP ${response.status} code=${errorCode}`);
      if (errorCode === "unauthorized_client") {
        throw new GmailApiError(
          "unauthorized_client: el refresh_token no pertenece a este GOOGLE_CLIENT_ID (Desktop vs Web).",
          503,
          "gmail_oauth_client_mismatch"
        );
      }
      if (errorCode === "invalid_grant") {
        throw new GmailApiError(
          "invalid_grant: refresh_token revocado o expirado. Hay que reautorizar en el Playground.",
          503,
          "gmail_oauth_failed"
        );
      }
      throw new GmailApiError(String(googleError), 502);
    }
    return data;
  }

  async function requestToken(client) {
    const data = await request(GMAIL_PATHS.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: client.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!data.access_token) {
      throw new GmailApiError("token response without access_token", 502);
    }
    return data;
  }

  async function accessToken() {
    if (cachedToken && clock() < expiresAt) {
      return cachedToken;
    }
    let lastMismatch;
    for (const client of clientChain) {
      try {
        const data = await requestToken(client);
        cachedToken = data.access_token;
        const ttlMs = Number(data.expires_in || 3600) * 1000;
        expiresAt = clock() + Math.max(ttlMs - 60_000, 0);
        return cachedToken;
      } catch (err) {
        if (err.code !== "gmail_oauth_client_mismatch") {
          throw err;
        }
        lastMismatch = err;
      }
    }
    throw lastMismatch;
  }

  async function gmail(url, init = {}) {
    const token = await accessToken();
    return request(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        authorization: `Bearer ${token}`,
      },
    });
  }

  async function getMessage(messageId) {
    const url = `${GMAIL_PATHS.messages}/${encodeURIComponent(messageId)}?format=full`;
    return gmail(url);
  }

  function mapMessage(message) {
    const sender = headerValue(message.payload, "From");
    const subject = headerValue(message.payload, "Subject") || "(sin asunto)";
    const summary = String(message.snippet || "").trim();
    return {
      id: message.id,
      threadId: message.threadId,
      sender,
      subject,
      summary,
      senderHtml: escapeHtml(sender),
      subjectHtml: escapeHtml(subject),
      summaryHtml: escapeHtml(summary),
      date: headerValue(message.payload, "Date"),
      inReplyTo: headerValue(message.payload, "Message-ID"),
    };
  }

  async function listUnread() {
    const query = new URLSearchParams({
      q: "is:unread",
      maxResults: String(maxUnread),
    });
    const listed = await gmail(`${GMAIL_PATHS.messages}?${query.toString()}`);
    const refs = listed.messages || [];
    const messages = [];
    for (const ref of refs) {
      const full = await getMessage(ref.id);
      messages.push(mapMessage(full));
    }
    return {
      status: "ok",
      unread_count: messages.length,
      messages,
    };
  }

  async function createDraft(input = {}) {
    let threadId = input.threadId || "";
    let to = input.to || "";
    let subject = input.subject || "";
    let inReplyTo = input.inReplyTo || "";

    if (input.messageId && (!threadId || !to || !subject)) {
      const full = await getMessage(input.messageId);
      const mapped = mapMessage(full);
      threadId = threadId || mapped.threadId;
      to = to || mapped.sender;
      subject = subject || mapped.subject;
      inReplyTo = inReplyTo || mapped.inReplyTo;
    }

    if (!to) {
      const profile = await gmail(GMAIL_PATHS.profile);
      to = profile.emailAddress || "";
    }
    if (!to) {
      throw new GmailApiError("no hay destinatario para el borrador", 400, "gmail_draft_invalid");
    }

    const replyBody =
      String(input.replyBody || input.body || "").trim() || DEFAULT_REPLY_BODY;
    const rfc822 = buildReplyRfc822({
      to,
      subject,
      body: replyBody,
      inReplyTo,
    });
    const created = await gmail(GMAIL_PATHS.drafts, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          ...(threadId ? { threadId } : {}),
          raw: toBase64Url(rfc822),
        },
      }),
    });

    return {
      ok: true,
      draft: true,
      sent: false,
      id: created.id,
      messageId: created.message?.id || "",
      threadId: created.message?.threadId || threadId,
      status: "created",
    };
  }

  return { listUnread, createDraft };
}
