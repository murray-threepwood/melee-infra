import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertValidSlug,
  createSafeGitWorkspaceManager,
  defaultGitRun,
} from "../config/murray-agent/git-worktree.mjs";

test("assertValidSlug rechaza murray-infra, transversales y slugs inválidos", () => {
  assert.equal(assertValidSlug("repo-valido_1.0"), "repo-valido_1.0");

  assert.throws(() => assertValidSlug(""), { code: "git_slug_invalid" });
  assert.throws(() => assertValidSlug("murray-infra"), { code: "git_slug_forbidden" });
  assert.throws(() => assertValidSlug("../escape"), { code: "git_slug_invalid" });
  assert.throws(() => assertValidSlug("sub/dir"), { code: "git_slug_invalid" });
  assert.throws(() => assertValidSlug("-flag"), { code: "git_slug_invalid" });
});

test("SafeGitWorkspaceManager: ciclo de vida mockeado (bare repo + refspec + worktree)", async () => {
  const commands = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "murray-git-mock-"));
  const cacheRoot = path.join(tmpRoot, "git-cache");
  const workspaceRoot = path.join(tmpRoot, "workspace");

  const mockGitRun = async (args, opts) => {
    commands.push(args);
    // Simular que el clone crea el directorio .bare
    if (args[0] === "clone" && args[1] === "--bare") {
      const dest = args[args.length - 1];
      fs.mkdirSync(dest, { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };

  const manager = createSafeGitWorkspaceManager({
    gitCacheRoot: cacheRoot,
    workspaceRoot,
    gitRun: mockGitRun,
  });

  // 1. ensureBareRepo
  const bareRes = await manager.ensureBareRepo({
    url: "https://github.com/owner/demo.git",
    slug: "demo",
  });
  assert.equal(bareRes.initialized, true);
  assert.equal(bareRes.slug, "demo");

  // Verificar que configuró el refspec completo para todas las ramas remotas
  const refspecCmd = commands.find(
    (cmd) => cmd.includes("remote.origin.fetch") && cmd.includes("+refs/heads/*:refs/remotes/origin/*")
  );
  assert.ok(refspecCmd, "Debe configurar el refspec completo remote.origin.fetch");

  // 2. createOrAttachWorktree
  const wtRes = await manager.createOrAttachWorktree({
    slug: "demo",
    branch: "feat/nueva-idea",
  });
  assert.equal(wtRes.reused, false);
  assert.equal(wtRes.branch, "feat/nueva-idea");

  const worktreeCmd = commands.find(
    (cmd) => cmd.includes("worktree") && cmd.includes("add") && cmd.includes("-B")
  );
  assert.ok(worktreeCmd, "Debe ejecutar git worktree add -B");

  // 3. removeWorktree
  const rmRes = await manager.removeWorktree({ slug: "demo", force: true });
  assert.equal(rmRes.removed, true);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test("SafeGitWorkspaceManager: integración local real con git bare y worktree", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "murray-git-real-"));
  const originDir = path.join(tmpRoot, "origin");
  const cacheRoot = path.join(tmpRoot, "git-cache");
  const workspaceRoot = path.join(tmpRoot, "workspace");

  // Crear repo origen real
  fs.mkdirSync(originDir, { recursive: true });
  await defaultGitRun(["init", "-b", "main"], { cwd: originDir });
  await defaultGitRun(["config", "user.name", "Murray Test"], { cwd: originDir });
  await defaultGitRun(["config", "user.email", "test@murray.local"], { cwd: originDir });
  fs.writeFileSync(path.join(originDir, "README.md"), "# Origin\n");
  await defaultGitRun(["add", "README.md"], { cwd: originDir });
  await defaultGitRun(["commit", "-m", "init: commit base"], { cwd: originDir });

  const manager = createSafeGitWorkspaceManager({
    gitCacheRoot: cacheRoot,
    workspaceRoot,
    gitRun: defaultGitRun,
  });

  // 1. Clonar a bare
  const bareRes = await manager.ensureBareRepo({
    url: originDir,
    slug: "demo-real",
  });
  assert.equal(bareRes.initialized, true);
  assert.ok(fs.existsSync(bareRes.barePath));

  // 2. Crear worktree efímero
  const wtRes = await manager.createOrAttachWorktree({
    slug: "demo-real",
    branch: "feat/worktree-test",
    baseRef: "HEAD",
  });
  assert.equal(wtRes.reused, false);
  assert.ok(fs.existsSync(path.join(wtRes.worktreePath, "README.md")));

  // Reusar worktree existente
  const wtReuse = await manager.createOrAttachWorktree({
    slug: "demo-real",
    branch: "feat/worktree-test",
  });
  assert.equal(wtReuse.reused, true);

  // 3. Listar worktrees
  const list = await manager.listWorktrees({ slug: "demo-real" });
  assert.ok(list.length >= 2, "Debe listar el bare repo y el worktree vinculado");
  const featWt = list.find((w) => w.branch === "feat/worktree-test");
  assert.ok(featWt, "Debe listar la rama feat/worktree-test en los worktrees");

  // 4. Remover worktree
  const rm = await manager.removeWorktree({ slug: "demo-real", force: true });
  assert.equal(rm.removed, true);
  assert.equal(fs.existsSync(wtRes.worktreePath), false);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
