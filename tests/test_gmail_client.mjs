import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GMAIL_PATHS,
  buildReplyRfc822,
  createGmailClient,
  toBase64Url,
} from "../config/workspace-mcp/gmail-client.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockGoogle({
  unreadIds = [],
  messages = {},
  draftId = "draft-1",
  accessToken = "ya29.test-token",
  tokenStatus = 200,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ url: u, method, body: init.body || null });
    if (/\/send(\b|\?|$)/.test(u) || u.includes("drafts/send")) {
      throw new Error(`SEND_CALLED ${method} ${u}`);
    }
    if (u.startsWith(GMAIL_PATHS.token)) {
      if (tokenStatus !== 200) {
        return jsonResponse({ error: "invalid_grant" }, tokenStatus);
      }
      return jsonResponse({
        access_token: accessToken,
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    if (u.startsWith(`${GMAIL_PATHS.messages}?`) || u === GMAIL_PATHS.messages) {
      return jsonResponse({
        messages: unreadIds.map((id) => ({ id, threadId: `th-${id}` })),
        resultSizeEstimate: unreadIds.length,
      });
    }
    const messageMatch = u.match(/\/messages\/([^/?]+)(?:\?|$)/);
    if (messageMatch && method === "GET") {
      const id = decodeURIComponent(messageMatch[1]);
      if (!messages[id]) {
        return jsonResponse({ error: { message: "not found" } }, 404);
      }
      return jsonResponse(messages[id]);
    }
    if (u === GMAIL_PATHS.profile && method === "GET") {
      return jsonResponse({ emailAddress: "ceo@example.test" });
    }
    if (u === GMAIL_PATHS.drafts && method === "POST") {
      const parsed = JSON.parse(String(init.body || "{}"));
      return jsonResponse({
        id: draftId,
        message: {
          id: "msg-draft-1",
          threadId: parsed.message?.threadId || "th-new",
        },
      });
    }
    return jsonResponse({ error: `unexpected ${method} ${u}` }, 500);
  };
  return { fetchImpl, calls };
}

const CREDENTIALS = {
  clientId: "web-client.apps.googleusercontent.com",
  clientSecret: "GOCSPX-test",
  refreshToken: "1//test-refresh-token",
};

test("listUnread mapea headers Gmail y no llama send", async () => {
  const { fetchImpl, calls } = mockGoogle({
    unreadIds: ["m1"],
    messages: {
      m1: {
        id: "m1",
        threadId: "th-1",
        snippet: "Necesito la factura",
        payload: {
          headers: [
            { name: "From", value: "Ana <ana@example.test>" },
            { name: "Subject", value: "Factura <Q3>" },
            { name: "Date", value: "Wed, 16 Sep 2026 20:00:00 -0300" },
            { name: "Message-ID", value: "<m1@example.test>" },
          ],
        },
      },
    },
  });
  const client = createGmailClient({ ...CREDENTIALS, fetchImpl });
  const result = await client.listUnread();
  assert.equal(result.status, "ok");
  assert.equal(result.unread_count, 1);
  assert.equal(result.messages[0].id, "m1");
  assert.equal(result.messages[0].threadId, "th-1");
  assert.equal(result.messages[0].sender, "Ana <ana@example.test>");
  assert.equal(result.messages[0].subject, "Factura <Q3>");
  assert.equal(result.messages[0].subjectHtml, "Factura &lt;Q3&gt;");
  assert.equal(result.messages[0].summary, "Necesito la factura");
  assert.equal(result.messages[0].inReplyTo, "<m1@example.test>");
  assert.ok(!result.status.includes("stub"));
  assert.ok(!calls.some((c) => /send/i.test(c.url)));
  assert.ok(calls.some((c) => c.url.startsWith(GMAIL_PATHS.token)));
  assert.ok(calls.some((c) => c.url.includes("q=is%3Aunread") || c.url.includes("q=is:unread")));
});

test("listUnread con inbox vacía es ok y no awaiting_oauth", async () => {
  const { fetchImpl } = mockGoogle({ unreadIds: [] });
  const client = createGmailClient({ ...CREDENTIALS, fetchImpl });
  const result = await client.listUnread();
  assert.equal(result.status, "ok");
  assert.equal(result.unread_count, 0);
  assert.deepEqual(result.messages, []);
  assert.notEqual(result.status, "awaiting_oauth");
});

test("sin refresh token lanza gmail_oauth_missing (no finge unread_count=0)", () => {
  assert.throws(
    () =>
      createGmailClient({
        clientId: CREDENTIALS.clientId,
        clientSecret: CREDENTIALS.clientSecret,
        refreshToken: "",
      }),
    (err) => err.code === "gmail_oauth_missing"
  );
});

test("createDraft pega /drafts, nunca /send, y sent=false", async () => {
  const { fetchImpl, calls } = mockGoogle({ draftId: "r123" });
  const client = createGmailClient({ ...CREDENTIALS, fetchImpl });
  const result = await client.createDraft({
    messageId: "m1",
    threadId: "th-1",
    to: "Ana <ana@example.test>",
    subject: "Factura",
    replyBody: "Gracias, lo miro.",
    inReplyTo: "<m1@example.test>",
  });
  assert.equal(result.ok, true);
  assert.equal(result.draft, true);
  assert.equal(result.sent, false);
  assert.equal(result.id, "r123");
  assert.equal(result.status, "created");
  const draftCalls = calls.filter((c) => c.url === GMAIL_PATHS.drafts);
  assert.equal(draftCalls.length, 1);
  assert.equal(draftCalls[0].method, "POST");
  const payload = JSON.parse(draftCalls[0].body);
  assert.equal(payload.message.threadId, "th-1");
  assert.ok(payload.message.raw);
  assert.ok(!calls.some((c) => /\/send/.test(c.url)));
});

test("createDraft con messageId hidrata el hilo y no despacha", async () => {
  const { fetchImpl, calls } = mockGoogle({
    unreadIds: ["m9"],
    messages: {
      m9: {
        id: "m9",
        threadId: "th-9",
        snippet: "hola",
        payload: {
          headers: [
            { name: "From", value: "Bob <bob@example.test>" },
            { name: "Subject", value: "Ping" },
            { name: "Message-ID", value: "<m9@example.test>" },
          ],
        },
      },
    },
  });
  const client = createGmailClient({ ...CREDENTIALS, fetchImpl });
  const result = await client.createDraft({ messageId: "m9" });
  assert.equal(result.sent, false);
  assert.equal(result.threadId, "th-9");
  const draftCall = calls.find((c) => c.url === GMAIL_PATHS.drafts && c.method === "POST");
  assert.ok(draftCall);
  const payload = JSON.parse(draftCall.body);
  assert.equal(payload.message.threadId, "th-9");
  const rfc822 = Buffer.from(
    payload.message.raw.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
  assert.match(rfc822, /To: Bob <bob@example.test>/);
  assert.match(rfc822, /Subject: Re: Ping/);
  assert.match(rfc822, /editá y enviá desde Gmail/i);
});

test("toBase64Url y RFC822 no usan + ni /", () => {
  const raw = buildReplyRfc822({
    to: "a@b.c",
    subject: "Hola",
    body: "cuerpo con +++ ///",
  });
  const encoded = toBase64Url(raw);
  assert.equal(encoded.includes("+"), false);
  assert.equal(encoded.includes("/"), false);
  assert.match(raw, /\r\n\r\ncuerpo/);
});

test("token inválido no se cachea como unread vacío", async () => {
  const { fetchImpl } = mockGoogle({ tokenStatus: 400 });
  const client = createGmailClient({ ...CREDENTIALS, fetchImpl });
  await assert.rejects(() => client.listUnread(), (err) => err.code === "gmail_oauth_failed");
});

test("unauthorized_client reintenta con fallback gauth", async () => {
  const bodies = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://oauth2.googleapis.com/token")) {
      const params = new URLSearchParams(String(init.body || ""));
      bodies.push(params.get("client_id"));
      if (params.get("client_id") === "web-from-gauth.apps.googleusercontent.com") {
        return new Response(
          JSON.stringify({ access_token: "ya29.ok", expires_in: 3600, token_type: "Bearer" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ error: "unauthorized_client" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("/messages?")) {
      return new Response(JSON.stringify({ messages: [], resultSizeEstimate: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected ${u}`);
  };
  const client = createGmailClient({
    clientId: "desktop-old.apps.googleusercontent.com",
    clientSecret: "GOCSPX-desktop",
    refreshToken: "1//test-refresh-token",
    fallbackClients: [
      {
        clientId: "web-from-gauth.apps.googleusercontent.com",
        clientSecret: "GOCSPX-web",
      },
    ],
    fetchImpl,
  });
  const result = await client.listUnread();
  assert.equal(result.status, "ok");
  assert.equal(result.unread_count, 0);
  assert.deepEqual(bodies, [
    "desktop-old.apps.googleusercontent.com",
    "web-from-gauth.apps.googleusercontent.com",
  ]);
});

test("unauthorized_client es mismatch de OAuth client, no inbox vacía", async () => {
  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ error: "unauthorized_client" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error("no debe pegarle a Gmail sin token");
  };
  const client = createGmailClient({
    clientId: "web-client.apps.googleusercontent.com",
    clientSecret: "GOCSPX-test",
    refreshToken: "1//test-refresh-token",
    fetchImpl,
  });
  await assert.rejects(
    () => client.listUnread(),
    (err) => err.code === "gmail_oauth_client_mismatch" && err.status === 503
  );
});
