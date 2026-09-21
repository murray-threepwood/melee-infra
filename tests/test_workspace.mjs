import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertSafeGitArgs,
  createEphemeralAskpass,
  askpassForHost,
  createWorkspace,
  extractHttpsGitUrl,
  isProtectedBranch,
  isSecretWorkspacePath,
  parseHttpsGitUrl,
  parseWorkspaceTarget,
  sanitizeBranchName,
} from "../config/murray-agent/workspace.mjs";

function gitVerb(args) {
  const list = [...args];
  for (let i = 0; i < list.length; ) {
    if (list[i] === "-C" || list[i] === "-c") {
      list.splice(i, 2);
      continue;
    }
    i += 1;
  }
  return list[0];
}

function recordingGit({
  shallow = "true",
  branch = "main",
  porcelain = "",
  origin = "https://github.com/octocat/Hello-World.git",
} = {}) {
  const calls = [];
  const gitRun = async (args, opts = {}) => {
    assertSafeGitArgs(args, { allowPush: Boolean(opts.allowPush) });
    calls.push(args);
    const verb = gitVerb(args);
    if (verb === "clone") {
      const dest = args.at(-1);
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, "README.md"), "# hello main\n");
      fs.writeFileSync(path.join(dest, "app.js"), "console.log(1)\n");
      return { code: 0, stdout: "", stderr: "" };
    }
    if (verb === "rev-parse") {
      if (args.includes("--is-shallow-repository")) {
        return { code: 0, stdout: `${shallow}\n`, stderr: "" };
      }
      if (args.includes("--abbrev-ref")) {
        return { code: 0, stdout: `${branch}\n`, stderr: "" };
      }
    }
    if (verb === "remote") {
      return { code: 0, stdout: origin, stderr: "" };
    }
    if (verb === "status") {
      return { code: 0, stdout: porcelain, stderr: "" };
    }
    if (verb === "diff") {
      return { code: 0, stdout: "diff --git a/README.md\n+hola\n", stderr: "" };
    }
    if (verb === "log") {
      return { code: 0, stdout: "abc123 hello\n", stderr: "" };
    }
    if (verb === "rev-list") {
      const spec = args.find((item) => String(item).includes("..HEAD")) || "";
      if (spec.startsWith("origin/main") || spec.startsWith("main")) {
        return { code: 0, stdout: "5\n", stderr: "" };
      }
      return { code: 128, stdout: "", stderr: "unknown revision" };
    }
    if (verb === "checkout" && args.includes("-b")) {
      branch = args.at(-1);
      return { code: 0, stdout: `Switched to a new branch '${branch}'\n`, stderr: "" };
    }
    if (verb === "checkout") {
      branch = args.at(-1);
      return { code: 0, stdout: `Switched to branch '${branch}'\n`, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { gitRun, calls, getBranch: () => branch };
}

test("parseHttpsGitUrl solo github/gitlab https", () => {
  const gh = parseHttpsGitUrl("https://github.com/octocat/Hello-World");
  assert.equal(gh.slug, "octocat-Hello-World");
  assert.equal(gh.host, "github.com");
  assert.equal(extractHttpsGitUrl("cloná https://github.com/octocat/Hello-World porfa"), gh.href);
  assert.throws(() => parseHttpsGitUrl("git@github.com:octocat/Hello-World.git"), {
    code: "git_url_denied",
  });
  assert.throws(() => parseHttpsGitUrl("https://evil.example/x/y"), {
    code: "git_host_denied",
  });
  assert.throws(
    () => parseHttpsGitUrl("https://user:ghp_secret@github.com/octocat/Hello-World"),
    { code: "git_url_denied" }
  );
});

test("git push está prohibido en el seam sin allowPush", () => {
  assert.throws(() => assertSafeGitArgs(["push", "origin", "HEAD"]), {
    code: "git_forbidden",
  });
});

test("git push --force y push a main siguen prohibidos aunque allowPush", () => {
  assert.throws(() => assertSafeGitArgs(["push", "--force", "origin", "HEAD"], { allowPush: true }), {
    code: "git_forbidden",
  });
  assert.throws(() => assertSafeGitArgs(["push", "-u", "origin", "main"], { allowPush: true }), {
    code: "git_protected_branch",
  });
  assert.deepEqual(assertSafeGitArgs(["push", "-u", "--", "origin", "HEAD"], { allowPush: true }), [
    "push",
    "-u",
    "--",
    "origin",
    "HEAD",
  ]);
});

test("git config local está permitido pero --global/--system prohibidos", () => {
  assert.deepEqual(
    assertSafeGitArgs(["config", "user.name", "Murray Threepwood"]),
    ["config", "user.name", "Murray Threepwood"]
  );
  assert.deepEqual(
    assertSafeGitArgs(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]),
    ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]
  );
  assert.throws(() => assertSafeGitArgs(["config", "--global", "user.name", "x"]), {
    code: "git_forbidden",
  });
  assert.throws(() => assertSafeGitArgs(["config", "--system", "user.name", "x"]), {
    code: "git_forbidden",
  });
  assert.throws(() => assertSafeGitArgs(["config", "--file", "/etc/gitconfig"]), {
    code: "git_forbidden",
  });
  assert.throws(() => assertSafeGitArgs(["rebase", "main"]), {
    code: "git_forbidden",
  });
});

test("parseWorkspaceTarget jail y wipe", () => {
  assert.equal(parseWorkspaceTarget(".").wipe, true);
  assert.equal(parseWorkspaceTarget("todo el workspace").wipe, true);
  assert.equal(parseWorkspaceTarget("octocat-Hello-World/node_modules").rel, "octocat-Hello-World/node_modules");
  assert.throws(() => parseWorkspaceTarget("../secret"), { code: "workspace_jail" });
  assert.throws(() => parseWorkspaceTarget("/etc/passwd"), { code: "workspace_jail" });
});

test("sanitizeBranch y secret paths", () => {
  assert.equal(sanitizeBranchName("feat/foo"), "feat/foo");
  assert.throws(() => sanitizeBranchName("-evil"), { code: "git_branch_invalid" });
  assert.throws(() => sanitizeBranchName("../x"), { code: "git_branch_invalid" });
  assert.equal(isProtectedBranch("main"), true);
  assert.equal(isProtectedBranch("feat/x"), false);
  assert.equal(isSecretWorkspacePath(".env"), true);
  assert.equal(isSecretWorkspacePath(".env.example"), false);
  assert.equal(isSecretWorkspacePath("src/app.js"), false);
});

test("clone + tree + read + grep con git mock y jail", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "murray-ws-"));
  const { gitRun, calls } = recordingGit();
  const workspace = createWorkspace({ root, gitRun });
  const cloned = await workspace.clone({
    url: "https://github.com/octocat/Hello-World",
  });
  assert.equal(cloned.slug, "octocat-Hello-World");
  assert.equal(calls[0][0], "clone");
  assert.equal(calls[0].includes("--depth"), true);
  assert.equal(calls[0].includes("push"), false);
  const listing = workspace.tree(cloned.slug);
  assert.equal(listing.files.includes("README.md"), true);
  const readme = workspace.read(cloned.slug, "README.md");
  assert.match(readme.text, /hello main/);
  const hits = workspace.grep(cloned.slug, "hello");
  assert.equal(hits.hits[0].path, "README.md");
  assert.throws(() => workspace.read(cloned.slug, "../secret.txt"), {
    code: "workspace_jail",
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test("list + remove path/slug/wipe y no sale del jail", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "murray-ws-"));
  const slug = "octocat-Hello-World";
  const repo = path.join(root, slug);
  fs.mkdirSync(path.join(repo, "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(repo, "README.md"), "hola\n");
  fs.writeFileSync(path.join(repo, "node_modules", "x.js"), "1");
  fs.writeFileSync(path.join(root, "orphan.txt"), "basura\n");
  const workspace = createWorkspace({
    root,
    gitRun: async () => ({ code: 1, stdout: "", stderr: "" }),
  });
  const listed = workspace.list();
  assert.equal(listed.entries.some((row) => row.name === slug), true);
  assert.equal(listed.bytes > 0, true);

  const nested = workspace.remove("node_modules", { activeSlug: slug });
  assert.equal(nested.rel, `${slug}/node_modules`);
  assert.equal(fs.existsSync(path.join(repo, "node_modules")), false);
  assert.equal(fs.existsSync(path.join(repo, "README.md")), true);

  const one = workspace.remove(slug);
  assert.equal(fs.existsSync(repo), false);

  const wiped = workspace.remove(".");
  assert.equal(wiped.wiped, true);
  assert.equal(fs.existsSync(path.join(root, "orphan.txt")), false);
  assert.equal(fs.existsSync(root), true);

  assert.throws(() => workspace.remove("../secret"), { code: "workspace_jail" });
  fs.rmSync(root, { recursive: true, force: true });
});

test("pull unshallow + status/diff/log", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "murray-ws-"));
  const { gitRun, calls } = recordingGit({
    shallow: "true",
    branch: "feat/x",
    porcelain: "## feat/x\n M README.md\n",
  });
  const workspace = createWorkspace({ root, gitRun });
  await workspace.clone({ url: "https://github.com/octocat/Hello-World" });
  const pulled = await workspace.pull("octocat-Hello-World");
  assert.equal(pulled.unshallowed, true);
  assert.equal(
    calls.some((args) => args.includes("--unshallow")),
    true
  );
  assert.equal(
    calls.some((args) => args.includes("pull") && args.includes("--ff-only")),
    true
  );
  const st = await workspace.status("octocat-Hello-World");
  assert.equal(st.branch, "feat/x");
  assert.equal(st.protected, false);
  assert.equal(st.files.includes("README.md"), true);
  const patch = await workspace.diff("octocat-Hello-World");
  assert.match(patch.text, /README/);
  const history = await workspace.log("octocat-Hello-World");
  assert.match(history.text, /abc123/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("commit saltea .env, defaulta identidad Murray y exige mensaje", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "murray-ws-"));
  const { gitRun, calls } = recordingGit({
    porcelain: "?? README.md\n?? .env\n",
    branch: "feat/x",
  });
  const noIdent = createWorkspace({ root, gitRun, gitName: "", gitEmail: "" });
  await noIdent.clone({ url: "https://github.com/octocat/Hello-World" });
  await assert.rejects(() => noIdent.commit("octocat-Hello-World", { message: "wip" }), {
    code: "git_identity_missing",
  });
  const workspace = createWorkspace({ root, gitRun });
  const identCommit = await workspace.commit("octocat-Hello-World", {
    message: "feat: default author",
  });
  assert.deepEqual(identCommit.files, ["README.md"]);
  assert.equal(
    calls.some((args) => args.includes("user.email=329125804+murray-threepwood@users.noreply.github.com")),
    true
  );
  await assert.rejects(() => workspace.commit("octocat-Hello-World", { message: "x" }), {
    code: "git_commit_message",
  });
  const committed = await workspace.commit("octocat-Hello-World", {
    message: "feat: saludar",
  });
  assert.deepEqual(committed.files, ["README.md"]);
  assert.deepEqual(committed.skipped_secrets, [".env"]);
  assert.equal(
    calls.some((args) => args[0] === "-C" && args.includes("add") && args.includes("README.md") && !args.includes(".env")),
    true
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("push rechaza main y permite HEAD de feature", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "murray-ws-"));
  const mainGit = recordingGit({ branch: "main" });
  const onMain = createWorkspace({ root, gitRun: mainGit.gitRun });
  await onMain.clone({ url: "https://github.com/octocat/Hello-World" });
  await assert.rejects(() => onMain.push("octocat-Hello-World"), {
    code: "git_protected_branch",
  });
  assert.equal(
    mainGit.calls.some((args) => args.includes("push")),
    false
  );

  const featGit = recordingGit({ branch: "feat/disk", shallow: "true" });
  const onFeat = createWorkspace({ root, gitRun: featGit.gitRun });
  const pushed = await onFeat.push("octocat-Hello-World");
  assert.equal(pushed.branch, "feat/disk");
  const pushArgs = featGit.calls.find((args) => args.includes("push"));
  assert.ok(pushArgs);
  assert.equal(pushArgs.includes("HEAD"), true);
  assert.equal(pushArgs.includes("main"), false);
  assert.equal(pushArgs.includes("--force"), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("checkout -b local no hace fetch; rama tóxica denegada", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "murray-ws-"));
  const { gitRun, calls } = recordingGit({ branch: "main" });
  const workspace = createWorkspace({ root, gitRun });
  await workspace.clone({ url: "https://github.com/octocat/Hello-World" });
  const created = await workspace.checkout("octocat-Hello-World", {
    branch: "feat/limpiar-disco",
    create: true,
  });
  assert.equal(created.created, true);
  assert.equal(created.branch, "feat/limpiar-disco");
  assert.equal(
    calls.some((args) => args.includes("checkout") && args.includes("-b")),
    true
  );
  await assert.rejects(
    () => workspace.checkout("octocat-Hello-World", { branch: "main", create: true }),
    { code: "git_protected_branch" }
  );
  await assert.rejects(
    () => workspace.checkout("octocat-Hello-World", { branch: "../escape" }),
    { code: "git_branch_invalid" }
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("commitsAhead cuenta origin/main..HEAD", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "murray-ws-"));
  const { gitRun, calls } = recordingGit({ branch: "feat/ola-q" });
  const workspace = createWorkspace({ root, gitRun });
  await workspace.clone({ url: "https://github.com/octocat/Hello-World" });
  assert.equal(await workspace.commitsAhead("octocat-Hello-World"), 5);
  assert.equal(
    calls.some((args) => args.includes("rev-list") && args.some((item) => String(item).includes("origin/main..HEAD"))),
    true
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("createEphemeralAskpass: genera script ejecutable 0700 y limpia en cleanup", () => {
  const secret = "ghp_superSecretToken123456789";
  const askpass = createEphemeralAskpass({ token: secret });
  assert.ok(askpass.scriptPath);
  assert.equal(askpass.env.GIT_ASKPASS, askpass.scriptPath);
  assert.equal(askpass.env.GIT_TERMINAL_PROMPT, "0");

  assert.ok(fs.existsSync(askpass.scriptPath));
  const stat = fs.statSync(askpass.scriptPath);
  assert.equal(stat.mode & 0o777, 0o700, "El script askpass debe tener permisos 0700");

  const content = fs.readFileSync(askpass.scriptPath, "utf8");
  assert.ok(content.includes("x-access-token"));
  assert.ok(content.includes(secret));

  askpass.cleanup();
  assert.equal(fs.existsSync(askpass.scriptPath), false, "El script debe ser eliminado al llamar cleanup");
});

test("createEphemeralAskpass: tokens vacíos o placeholders retornan env vacío sin script", () => {
  const empty = createEphemeralAskpass({ token: "" });
  assert.deepEqual(empty.env, {});
  assert.equal(empty.scriptPath, null);

  const placeholder = createEphemeralAskpass({ token: "REEMPLAZAR_POR_TOKEN" });
  assert.deepEqual(placeholder.env, {});
  assert.equal(placeholder.scriptPath, null);
});
