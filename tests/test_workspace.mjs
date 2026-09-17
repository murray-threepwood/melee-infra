import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertSafeGitArgs,
  createWorkspace,
  extractHttpsGitUrl,
  parseHttpsGitUrl,
} from "../config/murray-agent/workspace.mjs";

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

test("git push está prohibido en el seam", () => {
  assert.throws(() => assertSafeGitArgs(["push", "origin", "main"]), {
    code: "git_forbidden",
  });
});

test("clone + tree + read + grep con git mock y jail", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "murray-ws-"));
  const calls = [];
  const workspace = createWorkspace({
    root,
    gitRun: async (args) => {
      calls.push(args);
      if (args[0] === "clone") {
        const dest = args.at(-1);
        fs.mkdirSync(dest, { recursive: true });
        fs.writeFileSync(path.join(dest, "README.md"), "# hello main\n");
        fs.writeFileSync(path.join(dest, "app.js"), "console.log(1)\n");
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    },
  });
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
