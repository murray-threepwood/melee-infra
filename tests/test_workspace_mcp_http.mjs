import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceMcpServer } from "../config/workspace-mcp/server.mjs";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

async function withServer(deps, fn) {
  const server = createWorkspaceMcpServer(deps);
  const port = await listen(server);
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /healthz 200 y sending=false", async () => {
  await withServer(
    {
      allowSending: false,
      allowDrafts: true,
      gmailClient: {
        listUnread: async () => ({ status: "ok", unread_count: 0, messages: [] }),
        createDraft: async () => {
          throw new Error("no debe crear draft en healthz");
        },
      },
    },
    async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.gmail_allow_sending, false);
      assert.equal(body.gmail_allow_drafts, true);
      assert.equal(body.gmail_mode, "live");
    }
  );
});

test("cualquier ruta send responde 403 y no toca Gmail", async () => {
  let gmailHits = 0;
  await withServer(
    {
      allowSending: false,
      allowDrafts: true,
      gmailClient: {
        listUnread: async () => {
          gmailHits += 1;
          return { status: "ok", unread_count: 0, messages: [] };
        },
        createDraft: async () => {
          gmailHits += 1;
          return { ok: true };
        },
      },
    },
    async (port) => {
      for (const path of ["/gmail/send", "/gmail/batch-send", "/gmail/messages/send"]) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST" });
        const body = await res.json();
        assert.equal(res.status, 403, path);
        assert.equal(body.error, "gmail_send_blocked");
      }
      assert.equal(gmailHits, 0);
    }
  );
});

test("GET /gmail/unread live no es stub awaiting_oauth", async () => {
  await withServer(
    {
      allowSending: false,
      allowDrafts: true,
      gmailClient: {
        listUnread: async () => ({
          status: "ok",
          unread_count: 1,
          messages: [
            {
              id: "m1",
              threadId: "th-1",
              sender: "Ada",
              subject: "Hola",
              summary: "snippet",
            },
          ],
        }),
        createDraft: async () => {
          throw new Error("unread no crea draft");
        },
      },
    },
    async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/gmail/unread`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.status, "ok");
      assert.equal(body.unread_count, 1);
      assert.equal(body.messages[0].sender, "Ada");
      assert.equal(body.status === "awaiting_oauth", false);
      assert.equal(body.status === "stub_until_oauth", false);
    }
  );
});

test("POST /gmail/drafts crea borrador sent=false", async () => {
  let seen = null;
  await withServer(
    {
      allowSending: false,
      allowDrafts: true,
      gmailClient: {
        listUnread: async () => ({ status: "ok", unread_count: 0, messages: [] }),
        createDraft: async (input) => {
          seen = input;
          return {
            ok: true,
            draft: true,
            sent: false,
            id: "d1",
            status: "created",
          };
        },
      },
    },
    async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/gmail/drafts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: "m1", replyBody: "ok" }),
      });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.sent, false);
      assert.equal(body.draft, true);
      assert.equal(body.id, "d1");
      assert.equal(seen.messageId, "m1");
    }
  );
});

test("POST /gmail/drafts con ALLOW_DRAFTS=false da 403", async () => {
  let created = false;
  await withServer(
    {
      allowSending: false,
      allowDrafts: false,
      gmailClient: {
        listUnread: async () => ({ status: "ok", unread_count: 0, messages: [] }),
        createDraft: async () => {
          created = true;
          return { ok: true };
        },
      },
    },
    async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/gmail/drafts`, {
        method: "POST",
        body: JSON.stringify({ messageId: "m1" }),
      });
      assert.equal(res.status, 403);
      assert.equal(created, false);
    }
  );
});

test("ALLOW_SENDING=true en drafts es 500 guardrail_violation", async () => {
  let created = false;
  await withServer(
    {
      allowSending: true,
      allowDrafts: true,
      gmailClient: {
        listUnread: async () => ({ status: "ok", unread_count: 0, messages: [] }),
        createDraft: async () => {
          created = true;
          return { ok: true };
        },
      },
    },
    async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/gmail/drafts`, {
        method: "POST",
        body: JSON.stringify({ messageId: "m1" }),
      });
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.error, "guardrail_violation");
      assert.equal(created, false);
    }
  );
});

test("oauth missing en unread es 503, no unread_count=0 stub", async () => {
  const err = new Error("missing");
  err.code = "gmail_oauth_missing";
  err.status = 503;
  await withServer(
    {
      allowSending: false,
      allowDrafts: true,
      gmailClient: {
        listUnread: async () => {
          throw err;
        },
        createDraft: async () => {
          throw err;
        },
      },
    },
    async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/gmail/unread`);
      const body = await res.json();
      assert.equal(res.status, 503);
      assert.equal(body.error, "gmail_oauth_missing");
      assert.equal(Object.hasOwn(body, "unread_count"), false);
    }
  );
});
