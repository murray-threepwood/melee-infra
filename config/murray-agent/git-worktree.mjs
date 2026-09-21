import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { redact } from "./redact.mjs";

export function assertValidSlug(slug) {
  const clean = String(slug || "").trim();
  if (!clean) {
    const err = new Error("slug de repositorio vacío");
    err.code = "git_slug_invalid";
    throw err;
  }
  if (
    clean.includes("..") ||
    clean.includes("/") ||
    clean.includes("\\") ||
    clean.startsWith("-") ||
    !/^[A-Za-z0-9_.\-]+$/.test(clean)
  ) {
    const err = new Error(`slug de repositorio inválido: ${clean}`);
    err.code = "git_slug_invalid";
    throw err;
  }
  if (clean === "murray-infra") {
    const err = new Error("murray-infra permanece vedado e inmutable");
    err.code = "git_slug_forbidden";
    throw err;
  }
  return clean;
}

export function defaultGitRun(args, { cwd, env = {}, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const err = new Error("git_timeout");
      err.code = "git_timeout";
      reject(err);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: redact(stdout),
        stderr: redact(stderr),
      });
    });
  });
}

export function createSafeGitWorkspaceManager({
  gitCacheRoot = process.env.MURRAY_GIT_CACHE_ROOT || "/opt/git-cache",
  workspaceRoot = process.env.MURRAY_WORKSPACE_ROOT || "/opt/workspace",
  gitRun = defaultGitRun,
} = {}) {
  const resolvedCacheRoot = path.resolve(gitCacheRoot);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);

  function barePath(slug) {
    const s = assertValidSlug(slug);
    return path.join(resolvedCacheRoot, `${s}.bare`);
  }

  function worktreePath(slug) {
    const s = assertValidSlug(slug);
    return path.join(resolvedWorkspaceRoot, s);
  }

  async function ensureBareRepo({ url, slug, env = {} }) {
    const s = assertValidSlug(slug);
    const dest = barePath(s);
    fs.mkdirSync(resolvedCacheRoot, { recursive: true });

    if (!fs.existsSync(dest)) {
      const cloneRes = await gitRun(["clone", "--bare", "--", url, dest], {
        env,
        timeoutMs: 120000,
      });
      if (cloneRes.code !== 0) {
        const err = new Error(cloneRes.stderr || "falló git clone --bare");
        err.code = "git_clone_failed";
        throw err;
      }
      // Configurar refspecs completos para tracking de todas las ramas remotas
      const configRes = await gitRun(
        ["-C", dest, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
        { env }
      );
      if (configRes.code !== 0) {
        const err = new Error(configRes.stderr || "falló configuración de refspec");
        err.code = "git_config_failed";
        throw err;
      }
      await gitRun(["-C", dest, "fetch", "origin"], { env, timeoutMs: 60000 });
      return { slug: s, barePath: dest, initialized: true };
    }

    // Si ya existe, actualizamos refs
    await gitRun(["-C", dest, "fetch", "origin", "--prune"], { env, timeoutMs: 60000 });
    return { slug: s, barePath: dest, initialized: false };
  }

  async function createOrAttachWorktree({
    slug,
    branch = "feat/agent-work",
    baseRef = "origin/main",
    env = {},
  }) {
    const s = assertValidSlug(slug);
    const bare = barePath(s);
    const wt = worktreePath(s);

    if (!fs.existsSync(bare)) {
      const err = new Error(`repositorio bare no existe en ${bare}`);
      err.code = "git_bare_missing";
      throw err;
    }

    fs.mkdirSync(resolvedWorkspaceRoot, { recursive: true });

    if (fs.existsSync(wt)) {
      return {
        slug: s,
        worktreePath: wt,
        branch,
        reused: true,
      };
    }

    const addRes = await gitRun(
      ["-C", bare, "worktree", "add", "-B", branch, wt, baseRef],
      { env, timeoutMs: 60000 }
    );
    if (addRes.code !== 0) {
      // Fallback si baseRef falla (ej. origin/master en vez de origin/main)
      const fallbackRes = await gitRun(
        ["-C", bare, "worktree", "add", "-B", branch, wt, "HEAD"],
        { env, timeoutMs: 60000 }
      );
      if (fallbackRes.code !== 0) {
        const err = new Error(addRes.stderr || fallbackRes.stderr || "falló git worktree add");
        err.code = "git_worktree_add_failed";
        throw err;
      }
    }

    return {
      slug: s,
      worktreePath: wt,
      branch,
      reused: false,
    };
  }

  async function removeWorktree({ slug, force = false, env = {} }) {
    const s = assertValidSlug(slug);
    const bare = barePath(s);
    const wt = worktreePath(s);

    if (fs.existsSync(bare) && fs.existsSync(wt)) {
      const args = ["-C", bare, "worktree", "remove"];
      if (force) {
        args.push("--force");
      }
      args.push(wt);
      await gitRun(args, { env });
      await gitRun(["-C", bare, "worktree", "prune"], { env });
    }

    if (fs.existsSync(wt)) {
      fs.rmSync(wt, { recursive: true, force: true });
    }

    return { slug: s, removed: true };
  }

  async function listWorktrees({ slug, env = {} }) {
    const s = assertValidSlug(slug);
    const bare = barePath(s);
    if (!fs.existsSync(bare)) {
      return [];
    }
    const res = await gitRun(["-C", bare, "worktree", "list", "--porcelain"], { env });
    if (res.code !== 0) {
      return [];
    }

    const worktrees = [];
    let current = {};
    for (const line of res.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (current.worktree) {
          worktrees.push(current);
          current = {};
        }
        continue;
      }
      const [key, ...rest] = trimmed.split(" ");
      const val = rest.join(" ");
      if (key === "worktree") {
        current.worktree = val;
      } else if (key === "HEAD") {
        current.head = val;
      } else if (key === "branch") {
        current.branch = val.replace(/^refs\/heads\//, "");
      }
    }
    if (current.worktree) {
      worktrees.push(current);
    }
    return worktrees;
  }

  return {
    barePath,
    worktreePath,
    ensureBareRepo,
    createOrAttachWorktree,
    removeWorktree,
    listWorktrees,
    resolvedCacheRoot,
    resolvedWorkspaceRoot,
  };
}
