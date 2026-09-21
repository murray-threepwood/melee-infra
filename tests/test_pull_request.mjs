import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createWorkspace } from "../config/murray-agent/workspace.mjs";
import { createCodingSession } from "../config/murray-agent/coding.mjs";
import { openMurrayDb } from "../config/murray-agent/db.mjs";
import { createJobStore, createJobWorker } from "../config/murray-agent/jobs.mjs";
import { createSessionStore } from "../config/murray-agent/session.mjs";
import { createApprovalStore } from "../config/murray-agent/approvals.mjs";

test("createOrGetPullRequest: crea PR exitosamente en GitHub (201)", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ws-pr-test-"));
  const repoSlug = "test-repo";
  const repoDir = path.join(tmpRoot, repoSlug);
  fs.mkdirSync(repoDir, { recursive: true });

  const mockGitRun = async (args) => {
    if (args.includes("remote") && args.includes("get-url")) {
      return { code: 0, stdout: "https://github.com/hbauzan/semantic-firewall.git\n", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };

  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      status: 201,
      ok: true,
      json: async () => ({
        html_url: "https://github.com/hbauzan/semantic-firewall/pull/1",
        number: 1,
        title: "feat(precision): eradicate decimal truncation",
      }),
    };
  };

  const ws = createWorkspace({
    root: tmpRoot,
    gitRun: mockGitRun,
    githubToken: "test_token_123",
    fetchImpl: mockFetch,
  });

  const res = await ws.createOrGetPullRequest({
    slug: repoSlug,
    branch: "feat/tk01-numerical-purity",
    title: "feat(precision): eradicate decimal truncation",
    body: "PR details",
  });

  assert.equal(res.created, true);
  assert.equal(res.prUrl, "https://github.com/hbauzan/semantic-firewall/pull/1");
  assert.equal(res.prNumber, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.ok(calls[0].options.headers.Authorization.includes("test_token_123"));
});

test("createOrGetPullRequest: recupera PR existente ante 422 (already exists)", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ws-pr-422-"));
  const repoSlug = "test-repo-422";
  const repoDir = path.join(tmpRoot, repoSlug);
  fs.mkdirSync(repoDir, { recursive: true });

  const mockGitRun = async (args) => {
    if (args.includes("remote") && args.includes("get-url")) {
      return { code: 0, stdout: "https://github.com/hbauzan/semantic-firewall.git\n", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };

  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/pulls") && options.method === "POST") {
      return {
        status: 422,
        ok: false,
        json: async () => ({ message: "A pull request already exists for hbauzan:feat/tk01." }),
      };
    }
    return {
      status: 200,
      ok: true,
      json: async () => [
        {
          html_url: "https://github.com/hbauzan/semantic-firewall/pull/1",
          number: 1,
          title: "feat(precision): existing PR",
        },
      ],
    };
  };

  const ws = createWorkspace({
    root: tmpRoot,
    gitRun: mockGitRun,
    githubToken: "test_token_123",
    fetchImpl: mockFetch,
  });

  const res = await ws.createOrGetPullRequest({
    slug: repoSlug,
    branch: "feat/tk01",
  });

  assert.equal(res.created, false);
  assert.equal(res.prUrl, "https://github.com/hbauzan/semantic-firewall/pull/1");
  assert.equal(res.prNumber, 1);
  assert.equal(calls.length, 2);
});

test("createOrGetPullRequest: fallback a compare URL si no hay token", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ws-pr-notoken-"));
  const repoSlug = "test-notoken";
  fs.mkdirSync(path.join(tmpRoot, repoSlug), { recursive: true });

  const mockGitRun = async (args) => {
    if (args.includes("remote") && args.includes("get-url")) {
      return { code: 0, stdout: "https://github.com/hbauzan/semantic-firewall.git\n", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };

  const ws = createWorkspace({
    root: tmpRoot,
    gitRun: mockGitRun,
    githubToken: "",
  });

  const res = await ws.createOrGetPullRequest({
    slug: repoSlug,
    branch: "feat/tk01",
  });

  assert.equal(res.manual, true);
  assert.ok(res.prUrl.includes("compare/feat%2Ftk01?expand=1"));
});

test("handlePushJob: ejecuta push y notifica a Telegram con link al PR", async () => {
  const db = openMurrayDb({ filePath: ":memory:" });
  const jobs = createJobStore({ db });
  const approvals = createApprovalStore({ db });
  const session = createSessionStore({ db });

  session.patch("chat123", {
    slug: "my-repo",
    lastTestCommand: "pytest",
    lastMission: "Implementar TK-01",
  });

  let pushDone = false;
  let prCreated = false;
  const mockWorkspace = {
    push: async (slug) => {
      pushDone = true;
      return { slug, branch: "feat/tk01", stdout: "Pushed to origin" };
    },
    getLastCommitInfo: async () => ({
      hash: "e209b4e",
      author: "Murray",
      subject: "fix(precision): eradicate truncation",
    }),
    createOrGetPullRequest: async () => {
      prCreated = true;
      return {
        prUrl: "https://github.com/hbauzan/semantic-firewall/pull/42",
        prNumber: 42,
        prTitle: "fix(precision): eradicate truncation",
        created: true,
      };
    },
  };

  const notifications = [];
  const mockTelegram = {
    send: async (msg) => {
      notifications.push(msg);
      return { ok: true };
    },
  };

  const cs = createCodingSession({
    db,
    jobs,
    approvals,
    session,
    workspace: mockWorkspace,
    telegram: mockTelegram,
  });
  const worker = createJobWorker({ store: jobs, handlers: cs.handlers, intervalMs: 60000 });

  const pushJob = jobs.enqueue({
    type: "push",
    chatId: "chat123",
    payload: { slug: "my-repo" },
  });
  await worker.kick(pushJob.id);

  assert.equal(pushDone, true);
  assert.equal(prCreated, true);
  const updatedJob = jobs.get(pushJob.id);
  assert.equal(updatedJob.status, "done");
  assert.equal(updatedJob.payload.prUrl, "https://github.com/hbauzan/semantic-firewall/pull/42");

  assert.equal(notifications.length, 1);
  assert.ok(notifications[0].text.includes("Pull Request Abierto con Éxito"));
  assert.ok(notifications[0].text.includes("https://github.com/hbauzan/semantic-firewall/pull/42"));
  assert.ok(notifications[0].text.includes("#42 fix(precision): eradicate truncation"));
});

test("handlePollJob: emite teclado HITL Aprobar Push & Abrir PR al terminar con commits", async () => {
  const db = openMurrayDb({ filePath: ":memory:" });
  const jobs = createJobStore({ db });
  const approvals = createApprovalStore({ db });
  const session = createSessionStore({ db });

  session.patch("chat_poll", { slug: "my-repo", url: "https://github.com/owner/my-repo.git" });

  const mockWorkspace = {
    currentBranch: async () => "feat/my-ticket",
    status: async () => ({ files: [] }),
    commitsAhead: async () => 2,
  };

  const mockOpenHands = {
    getConversation: async () => ({ execution_status: "finished", sandbox_status: "RUNNING" }),
    searchEvents: async () => [
      {
        tool_name: "finish",
        action: { kind: "FinishAction", message: "### Resumen\nTrabajo completado con éxito." },
      },
    ],
    gitChanges: async () => ({}),
  };

  const notifications = [];
  const mockTelegram = {
    send: async (msg) => {
      notifications.push(msg);
      return { ok: true };
    },
  };

  const cs = createCodingSession({
    db,
    jobs,
    approvals,
    session,
    workspace: mockWorkspace,
    openhands: mockOpenHands,
    telegram: mockTelegram,
  });
  const worker = createJobWorker({ store: jobs, handlers: cs.handlers, intervalMs: 60000 });

  const pollJob = jobs.enqueue({
    type: "oh_poll",
    chatId: "chat_poll",
    payload: {
      slug: "my-repo",
      conversationId: "conv_done_123",
    },
  });

  await worker.kick(pollJob.id);

  const finishedJob = jobs.get(pollJob.id);
  assert.equal(finishedJob.status, "done");

  assert.equal(notifications.length, 1);
  const notify = notifications[0];
  assert.ok(notify.text.includes("Aprobar Push & Abrir PR"));
  assert.ok(Array.isArray(notify.buttons));
  assert.equal(notify.buttons[0][0].text, "🚀 Aprobar Push & Abrir PR");
  assert.ok(notify.buttons[0][0].callback_data.startsWith("APPROVE_PUSH:"));
  assert.equal(notify.buttons[0][1].text, "❌ Rechazar");
  assert.ok(notify.buttons[0][1].callback_data.startsWith("REJECT_PUSH:"));
});
