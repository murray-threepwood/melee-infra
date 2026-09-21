import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redact } from "./redact.mjs";

export const ALLOWED_GIT_HOSTS = new Set(["github.com", "gitlab.com"]);

export const PROTECTED_BRANCHES = new Set(["main", "master"]);

const GIT_FORBIDDEN = new Set([
  "credential",
  "daemon",
  "filter-branch",
  "update-index",
  "--exec",
  "send-pack",
  "receive-pack",
  "rebase",
  "reset",
  "clean",
]);

const GIT_FORCE = new Set(["--force", "--force-with-lease", "--force-if-includes", "-f"]);

const HTTPS_GIT_RE =
  /https:\/\/(?:www\.)?(github\.com|gitlab\.com)\/[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+/gi;

const WIPE_ALIASES = new Set([
  "",
  ".",
  "./",
  "*",
  "all",
  "todo",
  "todo el workspace",
  "./workspace",
  "workspace",
  "/opt/workspace",
]);

function deny(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function failGit(code, result) {
  const err = new Error(
    redact(String(result?.stderr || result?.stdout || code)).slice(0, 400)
  );
  err.code = code;
  throw err;
}

export function isProtectedBranch(name) {
  return PROTECTED_BRANCHES.has(String(name || "").trim().toLowerCase());
}

export function isSecretWorkspacePath(rel) {
  const n = String(rel || "").replace(/\\/g, "/");
  const base = n.split("/").pop() || "";
  if (base === ".env.example") {
    return false;
  }
  if (base === ".env" || base.startsWith(".env.")) {
    return true;
  }
  if (base === ".gauth.json" || base === "credentials.json") {
    return true;
  }
  if (/\.(pem|p12|key)$/i.test(base)) {
    return true;
  }
  if (base === "id_rsa" || base === "id_ed25519") {
    return true;
  }
  return false;
}

export function sanitizeBranchName(raw) {
  const name = String(raw || "").trim();
  if (!name) {
    deny("git_branch_invalid", "pasame el nombre de la rama");
  }
  if (name.startsWith("-") || name.includes("..") || name.includes("\\") || /\s/.test(name)) {
    deny("git_branch_invalid", `rama inválida: ${name}`);
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.length > 120) {
    deny("git_branch_invalid", `rama inválida: ${name}`);
  }
  return name;
}

export function assertSafeGitArgs(args, { allowPush = false } = {}) {
  const tokens = (args || []).map((item) => String(item));
  for (const token of tokens) {
    const lower = token.toLowerCase();
    const bare = lower.replace(/^-+/, "");
    if (GIT_FORCE.has(token) || GIT_FORCE.has(lower)) {
      deny("git_forbidden", "git force está prohibido");
    }
    if (GIT_FORBIDDEN.has(token) || GIT_FORBIDDEN.has(bare) || GIT_FORBIDDEN.has(lower)) {
      deny("git_forbidden", `git ${token} está prohibido`);
    }
    if (lower === "--global" || lower === "--system" || lower === "--file" || lower === "--blob") {
      deny("git_forbidden", `git flag ${token} está prohibido`);
    }
    if (lower === "push" || bare === "push") {
      if (!allowPush) {
        deny("git_forbidden", "git push exige HITL (allowPush)");
      }
    }
  }
  if (allowPush) {
    for (const token of tokens) {
      const lower = token.toLowerCase();
      const [src, dest] = lower.split(":");
      if (PROTECTED_BRANCHES.has(src) || (dest && PROTECTED_BRANCHES.has(dest))) {
        deny("git_protected_branch", "no hay push a main/master");
      }
    }
  }
  return tokens;
}

export function parseWorkspaceTarget(relPath) {
  const raw = String(relPath ?? "").trim();
  if (WIPE_ALIASES.has(raw.toLowerCase())) {
    return { wipe: true, rel: "" };
  }
  let cleaned = raw.replace(/\\/g, "/");
  cleaned = cleaned.replace(/^\/opt\/workspace\/?/i, "");
  cleaned = cleaned.replace(/^\.\/workspace\/?/i, "");
  cleaned = cleaned.replace(/^workspace\/?/i, "");
  if (cleaned.startsWith("/")) {
    deny("workspace_jail", "path absoluto fuera de ./workspace");
  }
  const normalized = path.posix.normalize(cleaned);
  if (normalized === "." || normalized === "") {
    return { wipe: true, rel: "" };
  }
  if (normalized.startsWith("../") || normalized === "..") {
    deny("workspace_jail", "path fuera de ./workspace");
  }
  return { wipe: false, rel: normalized };
}

export function extractHttpsGitUrl(text) {
  const match = String(text || "").match(HTTPS_GIT_RE);
  if (!match) {
    return "";
  }
  try {
    return parseHttpsGitUrl(match[0]).href;
  } catch {
    return "";
  }
}

export function parseHttpsGitUrl(raw) {
  const value = String(raw || "").trim();
  if (/^git@/i.test(value) || /^(ssh|git):/i.test(value)) {
    deny("git_url_denied", "solo https://github.com o https://gitlab.com");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    deny("git_url_invalid", "URL git inválida");
  }
  if (parsed.protocol !== "https:") {
    deny("git_url_denied", "solo https://github.com o https://gitlab.com");
  }
  if (parsed.username || parsed.password) {
    deny("git_url_denied", "la URL no puede llevar usuario ni token");
  }
  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (!ALLOWED_GIT_HOSTS.has(host)) {
    deny("git_host_denied", `host no permitido: ${host}`);
  }
  const parts = parsed.pathname
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) {
    deny("git_url_invalid", "la URL tiene que ser https://host/owner/repo");
  }
  const repoPath = parts.join("/");
  const slug = parts
    .join("-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) {
    deny("git_url_invalid", "no pude armar un slug de directorio");
  }
  return {
    href: `https://${host}/${repoPath}.git`,
    host,
    repoPath,
    slug,
    owner: parts[0],
    repo: parts[parts.length - 1],
  };
}

function realpathOrAbs(p) {
  const abs = path.resolve(p);
  try {
    if (fs.existsSync(abs)) {
      return fs.realpathSync(abs);
    }
  } catch {
    // ignore
  }
  return abs;
}

function isOutside(rootReal, candidate) {
  const rel = path.relative(rootReal, candidate);
  return rel.startsWith(`..${path.sep}`) || rel === "..";
}

export function assertInsideRoot(root, target) {
  const rootAbs = path.resolve(root);
  const rootReal = realpathOrAbs(root);
  const targetAbs = path.resolve(target);
  if (fs.existsSync(targetAbs)) {
    const real = fs.realpathSync(targetAbs);
    if (isOutside(rootReal, real)) {
      deny("workspace_jail", "path fuera de ./workspace");
    }
    return real;
  }
  const lexicalRel = path.relative(rootAbs, targetAbs);
  if (lexicalRel.startsWith(`..${path.sep}`) || lexicalRel === "..") {
    deny("workspace_jail", "path fuera de ./workspace");
  }
  const mapped = lexicalRel === "" ? rootReal : path.join(rootReal, lexicalRel);
  if (isOutside(rootReal, mapped)) {
    deny("workspace_jail", "path fuera de ./workspace");
  }
  return mapped;
}

async function defaultGitRun(args, { cwd, env = {}, timeoutMs = 120000, allowPush = false } = {}) {
  assertSafeGitArgs(args, { allowPush });
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" },
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

export function tokenForHost(host, { githubToken, gitlabToken } = {}) {
  const token =
    host === "gitlab.com" ? gitlabToken || githubToken : githubToken || gitlabToken;
  if (!token || /CAMBIAR_POR|REEMPLAZAR|ejemplo/i.test(token)) {
    return "";
  }
  return token;
}

export function createEphemeralAskpass({ token, prefix = "murray-askpass-" } = {}) {
  if (!token || /CAMBIAR_POR|REEMPLAZAR|ejemplo/i.test(token)) {
    return {
      env: {},
      scriptPath: null,
      cleanup: () => {},
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const scriptPath = path.join(tmpDir, "askpass.sh");
  const safeToken = String(token).replace(/'/g, "'\\''");
  const content = `#!/bin/sh
case "$1" in
  *Username*|*username*)
    printf '%s\\n' "x-access-token"
    ;;
  *Password*|*password*|*)
    printf '%s\\n' '${safeToken}'
    ;;
esac
`;
  fs.writeFileSync(scriptPath, content, { mode: 0o700 });
  try {
    fs.chmodSync(scriptPath, 0o700);
    fs.chmodSync(tmpDir, 0o700);
  } catch {}

  const env = {
    GIT_ASKPASS: scriptPath,
    GIT_TERMINAL_PROMPT: "0",
  };

  const cleanup = () => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {}
  };

  return { env, scriptPath, cleanup };
}

export function askpassForHost(host, { githubToken, gitlabToken } = {}) {
  const token = tokenForHost(host, { githubToken, gitlabToken });
  return createEphemeralAskpass({ token });
}

function tokenEnvForHost(host, { githubToken, gitlabToken }) {
  const token = tokenForHost(host, { githubToken, gitlabToken });
  if (!token) {
    return {};
  }
  const headerValue =
    host === "github.com"
      ? `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`
      : `AUTHORIZATION: bearer ${token}`;
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: headerValue,
  };
}

function isProbablyBinary(buf) {
  const slice = buf.subarray(0, Math.min(buf.length, 8000));
  return slice.includes(0);
}

function porcelainFiles(stdout) {
  const files = [];
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (line.length < 4) {
      continue;
    }
    if (line.startsWith("##")) {
      continue;
    }
    const rest = line.slice(3);
    const name = rest.includes(" -> ") ? rest.split(" -> ").at(-1) : rest;
    const cleaned = name.replace(/^"|"$/g, "").trim();
    if (cleaned) {
      files.push(cleaned);
    }
  }
  return files;
}

function directoryBytes(dir, { maxEntries = 50000 } = {}) {
  let bytes = 0;
  let count = 0;
  function walk(current) {
    if (count >= maxEntries) {
      return;
    }
    let st;
    try {
      st = fs.lstatSync(current);
    } catch {
      return;
    }
    count += 1;
    if (st.isSymbolicLink()) {
      return;
    }
    if (st.isFile()) {
      bytes += st.size;
      return;
    }
    if (!st.isDirectory()) {
      return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      walk(path.join(current, name));
    }
  }
  walk(dir);
  return { bytes, truncated: count >= maxEntries };
}

function gitIdentity(gitName, gitEmail) {
  const name = String(gitName || "").trim();
  const email = String(gitEmail || "").trim();
  if (
    !name ||
    !email ||
    /CAMBIAR_POR|REEMPLAZAR|ejemplo/i.test(email) ||
    !email.includes("@") ||
    /[\r\n]/.test(name) ||
    /[\r\n]/.test(email)
  ) {
    deny(
      "git_identity_missing",
      "identidad git inválida (name/email). Override opcional: MURRAY_GIT_NAME / MURRAY_GIT_EMAIL"
    );
  }
  return { name, email };
}

export function createWorkspace({
  root = process.env.MURRAY_WORKSPACE_ROOT || "/opt/workspace",
  gitRun = defaultGitRun,
  githubToken = process.env.GITHUB_TOKEN || "",
  gitlabToken = process.env.GITLAB_TOKEN || "",
  gitName = process.env.MURRAY_GIT_NAME || "Murray Threepwood",
  gitEmail = process.env.MURRAY_GIT_EMAIL || "329125804+murray-threepwood@users.noreply.github.com",
  maxFiles = 200,
  maxBytes = 32768,
  maxHits = 40,
  fetchImpl = fetch,
} = {}) {
  function repoDir(slug) {
    const safe = String(slug || "").replace(/[^A-Za-z0-9._-]/g, "");
    if (!safe) {
      deny("workspace_slug_denied", "slug vacío");
    }
    return assertInsideRoot(root, path.join(root, safe));
  }

  function requireRepo(slug) {
    const dest = repoDir(slug);
    if (!fs.existsSync(dest)) {
      deny("workspace_missing", `no hay repo activo ${slug}`);
    }
    return dest;
  }

  async function ensureRepoIdentity(dest) {
    if (!fs.existsSync(path.join(dest, ".git"))) {
      return;
    }
    try {
      const ident = gitIdentity(gitName, gitEmail);
      await gitRun(["-C", dest, "config", "user.name", ident.name], { timeoutMs: 10000 });
      await gitRun(["-C", dest, "config", "user.email", ident.email], { timeoutMs: 10000 });
    } catch {
      // Ignorar si gitRun no está disponible
    }
  }

  async function existingRemote(dest) {
    try {
      const result = await gitRun(["-C", dest, "remote", "get-url", "origin"], {
        timeoutMs: 10000,
      });
      return result.code === 0 ? String(result.stdout || "").trim() : "";
    } catch {
      return "";
    }
  }

  async function envForRepo(dest) {
    const remote = await existingRemote(dest);
    if (!remote) {
      return {};
    }
    try {
      const parsed = parseHttpsGitUrl(remote);
      return tokenEnvForHost(parsed.host, { githubToken, gitlabToken });
    } catch {
      return {};
    }
  }

  async function askpassForRepo(dest) {
    const remote = await existingRemote(dest);
    if (!remote) {
      return { env: {}, cleanup: () => {} };
    }
    try {
      const parsed = parseHttpsGitUrl(remote);
      return askpassForHost(parsed.host, { githubToken, gitlabToken });
    } catch {
      return { env: {}, cleanup: () => {} };
    }
  }

  async function withRepoAskpass(dest, fn) {
    const askpass = await askpassForRepo(dest);
    try {
      return await fn(askpass.env);
    } finally {
      askpass.cleanup();
    }
  }

  async function withHostAskpass(host, fn) {
    const askpass = askpassForHost(host, { githubToken, gitlabToken });
    try {
      return await fn(askpass.env);
    } finally {
      askpass.cleanup();
    }
  }

  async function ensureHistory(dest, callerEnv = {}) {
    await gitRun(["-C", dest, "config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], {
      timeoutMs: 10000,
    }).catch(() => {});
    const shallow = await gitRun(["-C", dest, "rev-parse", "--is-shallow-repository"], {
      timeoutMs: 15000,
    });
    const isShallow = String(shallow.stdout || "").trim() === "true";
    const runFetch = async (authEnv) => {
      const env = { ...callerEnv, ...authEnv };
      if (isShallow) {
        const unshallow = await gitRun(
          ["-C", dest, "fetch", "--unshallow", "--prune", "--", "origin"],
          { env, timeoutMs: 180000 }
        );
        if (unshallow.code === 0) {
          return { unshallowed: true };
        }
      }
      const fetched = await gitRun(["-C", dest, "fetch", "--prune", "--", "origin"], {
        env,
        timeoutMs: 180000,
      });
      if (fetched.code !== 0) {
        failGit("git_fetch_failed", fetched);
      }
      return { unshallowed: isShallow };
    };

    if (callerEnv && (callerEnv.GIT_ASKPASS || callerEnv.GIT_CONFIG_COUNT)) {
      return await runFetch(callerEnv);
    }
    return await withRepoAskpass(dest, runFetch);
  }

  async function clone({ url }) {
    const parsed = parseHttpsGitUrl(url);
    fs.mkdirSync(root, { recursive: true });
    const dest = repoDir(parsed.slug);
    if (fs.existsSync(dest)) {
      const remote = await existingRemote(dest);
      if (remote.replace(/\.git$/i, "") === parsed.href.replace(/\.git$/i, "")) {
        await ensureRepoIdentity(dest);
        return { slug: parsed.slug, url: parsed.href, reused: true, dest };
      }
      deny(
        "workspace_exists",
        `ya hay otro árbol en ${parsed.slug}; pedime borrar ./workspace/${parsed.slug}`
      );
    }
    return await withHostAskpass(parsed.host, async (authEnv) => {
      const result = await gitRun(
        ["clone", "--depth", "1", "--single-branch", "--", parsed.href, dest],
        { env: authEnv, timeoutMs: 120000 }
      );
      if (result.code !== 0) {
        const err = new Error(result.stderr.slice(0, 400) || "git clone falló");
        err.code = /auth|403|401|could not read/i.test(result.stderr)
          ? "git_auth_failed"
          : "git_clone_failed";
        throw err;
      }
      if (!fs.existsSync(dest)) {
        deny("git_clone_failed", "clone no dejó directorio");
      }
      await ensureRepoIdentity(dest);
      return { slug: parsed.slug, url: parsed.href, reused: false, dest };
    });
  }

  function tree(slug) {
    const dest = requireRepo(slug);
    const files = [];
    function walk(dir) {
      if (files.length >= maxFiles) {
        return;
      }
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= maxFiles) {
          return;
        }
        if (entry.name === ".git" || entry.name === "node_modules") {
          continue;
        }
        const full = path.join(dir, entry.name);
        assertInsideRoot(dest, full);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          files.push(path.relative(dest, full));
        }
      }
    }
    walk(dest);
    return { slug, files, truncated: files.length >= maxFiles };
  }

  function read(slug, relPath) {
    const dest = requireRepo(slug);
    const target = assertInsideRoot(dest, path.join(dest, String(relPath || "")));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      deny("workspace_file_missing", `no existe ${relPath}`);
    }
    const buf = fs.readFileSync(target);
    if (isProbablyBinary(buf)) {
      deny("workspace_binary", "no leo binarios");
    }
    const truncated = buf.length > maxBytes;
    return {
      slug,
      path: path.relative(dest, target),
      truncated,
      text: buf.subarray(0, maxBytes).toString("utf8"),
    };
  }

  function grep(slug, pattern) {
    const needle = String(pattern || "").slice(0, 200);
    if (!needle) {
      deny("workspace_grep_empty", "pasame un patrón");
    }
    const dest = requireRepo(slug);
    const hits = [];
    const listing = tree(slug);
    for (const rel of listing.files) {
      if (hits.length >= maxHits) {
        break;
      }
      let text = "";
      try {
        const buf = fs.readFileSync(path.join(dest, rel));
        if (isProbablyBinary(buf)) {
          continue;
        }
        text = buf.toString("utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        if (hits.length >= maxHits) {
          break;
        }
        if (lines[i].toLowerCase().includes(needle.toLowerCase())) {
          hits.push({
            path: rel,
            line: i + 1,
            text: lines[i].slice(0, 240),
          });
        }
      }
    }
    return { slug, pattern: needle, hits, truncated: hits.length >= maxHits };
  }

  function list() {
    fs.mkdirSync(root, { recursive: true });
    const names = fs.readdirSync(root);
    const entries = [];
    let bytes = 0;
    for (const name of names) {
      const full = assertInsideRoot(root, path.join(root, name));
      let st;
      try {
        st = fs.lstatSync(full);
      } catch {
        continue;
      }
      const size =
        st.isDirectory() && !st.isSymbolicLink() ? directoryBytes(full).bytes : st.size;
      bytes += size;
      entries.push({
        name,
        bytes: size,
        is_dir: st.isDirectory(),
        is_symlink: st.isSymbolicLink(),
      });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { entries, bytes };
  }

  function parseTarget(relPath, activeSlug = "") {
    const parsed = parseWorkspaceTarget(relPath);
    if (parsed.wipe) {
      return parsed;
    }
    const direct = path.join(root, parsed.rel);
    if (fs.existsSync(direct)) {
      return parsed;
    }
    const slug = String(activeSlug || "").replace(/[^A-Za-z0-9._-]/g, "");
    if (slug) {
      const nestedRel = path.posix.normalize(`${slug}/${parsed.rel}`);
      if (!nestedRel.startsWith("..") && fs.existsSync(path.join(root, nestedRel))) {
        return { wipe: false, rel: nestedRel };
      }
    }
    return parsed;
  }

  function remove(relPath, { activeSlug = "" } = {}) {
    const target = parseTarget(relPath, activeSlug);
    fs.mkdirSync(root, { recursive: true });
    const removed = [];
    if (target.wipe) {
      for (const name of fs.readdirSync(root)) {
        const full = assertInsideRoot(root, path.join(root, name));
        const st = fs.lstatSync(full);
        if (st.isSymbolicLink()) {
          fs.unlinkSync(full);
        } else {
          fs.rmSync(full, { recursive: true, force: true });
        }
        removed.push(name);
      }
      return { wiped: true, removed, rel: "" };
    }
    const full = assertInsideRoot(root, path.join(root, target.rel));
    if (full === realpathOrAbs(root)) {
      return remove(".", { activeSlug });
    }
    if (!fs.existsSync(full)) {
      deny("workspace_missing", `no existe ./workspace/${target.rel}`);
    }
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(full);
    } else {
      fs.rmSync(full, { recursive: true, force: true });
    }
    removed.push(target.rel);
    return { wiped: false, removed, rel: target.rel };
  }

  async function currentBranch(slug) {
    const dest = requireRepo(slug);
    const result = await gitRun(["-C", dest, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeoutMs: 10000,
    });
    if (result.code !== 0) {
      failGit("git_failed", result);
    }
    return String(result.stdout || "").trim();
  }

  async function status(slug) {
    const dest = requireRepo(slug);
    await ensureRepoIdentity(dest);
    const branch = await currentBranch(slug);
    const result = await gitRun(["-C", dest, "status", "--porcelain=v1", "-b"], {
      timeoutMs: 15000,
    });
    if (result.code !== 0) {
      failGit("git_failed", result);
    }
    return {
      slug,
      branch,
      protected: isProtectedBranch(branch),
      porcelain: redact(result.stdout || "").slice(0, 4000),
      files: porcelainFiles(result.stdout),
    };
  }

  async function diff(slug) {
    const dest = requireRepo(slug);
    const stat = await gitRun(["-C", dest, "diff", "--stat"], { timeoutMs: 15000 });
    const patch = await gitRun(["-C", dest, "diff"], { timeoutMs: 20000 });
    const text = `${stat.stdout || ""}\n${patch.stdout || ""}`.trim();
    return {
      slug,
      text: redact(text).slice(0, 6000),
      truncated: text.length > 6000,
    };
  }

  async function log(slug, { limit = 15 } = {}) {
    const dest = requireRepo(slug);
    const n = Math.min(Math.max(Number(limit) || 15, 1), 50);
    const result = await gitRun(["-C", dest, "log", "-n", String(n), "--oneline"], {
      timeoutMs: 15000,
    });
    if (result.code !== 0) {
      failGit("git_failed", result);
    }
    return { slug, text: redact(result.stdout || "").slice(0, 3000) };
  }

  async function commitsAhead(slug, { base = "main" } = {}) {
    const dest = requireRepo(slug);
    const curr = await currentBranch(slug).catch(() => "");
    const branch = sanitizeBranchName(String(base || "main"));
    const refs = [];
    if (curr && curr !== "main" && curr !== "master" && curr !== "HEAD") {
      refs.push(`origin/${curr}`);
    }
    refs.push(`origin/${branch}`, branch);
    for (const ref of refs) {
      const result = await gitRun(
        ["-C", dest, "rev-list", "--count", `${ref}..HEAD`],
        { timeoutMs: 15000 }
      );
      if (result.code === 0) {
        const n = Number(String(result.stdout || "").trim());
        return Number.isFinite(n) ? n : 0;
      }
    }
    return 0;
  }

  async function pull(slug) {
    const dest = requireRepo(slug);
    return await withRepoAskpass(dest, async (authEnv) => {
      const history = await ensureHistory(dest, authEnv);
      const result = await gitRun(["-C", dest, "pull", "--ff-only", "--", "origin"], {
        env: authEnv,
        timeoutMs: 180000,
      });
      if (result.code !== 0) {
        failGit("git_pull_failed", result);
      }
      return {
        slug,
        unshallowed: history.unshallowed,
        stdout: redact(`${result.stdout || ""}\n${result.stderr || ""}`.trim()).slice(0, 2000),
      };
    });
  }

  async function checkout(slug, { branch, create = false } = {}) {
    const dest = requireRepo(slug);
    await ensureRepoIdentity(dest);
    const name = sanitizeBranchName(branch);
    if (create && isProtectedBranch(name)) {
      deny("git_protected_branch", "no creo ramas main/master");
    }
    if (create) {
      const result = await gitRun(["-C", dest, "checkout", "-b", name], { timeoutMs: 30000 });
      if (result.code !== 0) {
        failGit("git_checkout_failed", result);
      }
      return { slug, branch: name, created: true, stdout: redact(result.stdout || "") };
    }
    const local = await gitRun(["-C", dest, "checkout", name], { timeoutMs: 15000 });
    if (local.code === 0) {
      return { slug, branch: name, created: false, stdout: redact(local.stdout || "") };
    }
    return await withRepoAskpass(dest, async (authEnv) => {
      await ensureHistory(dest, authEnv);
      await gitRun(["-C", dest, "fetch", "--", "origin", name], { env: authEnv, timeoutMs: 120000 });
      const result = await gitRun(["-C", dest, "checkout", name], { timeoutMs: 30000 });
      if (result.code !== 0) {
        failGit("git_checkout_failed", result);
      }
      return { slug, branch: name, created: false, stdout: redact(result.stdout || "") };
    });
  }

  async function commit(slug, { message, paths = [] } = {}) {
    const dest = requireRepo(slug);
    await ensureRepoIdentity(dest);
    const msg = String(message || "").trim();
    if (msg.length < 3) {
      deny("git_commit_message", "pasame un mensaje de commit (≥ 3 caracteres)");
    }
    const ident = gitIdentity(gitName, gitEmail);
    const statusResult = await gitRun(["-C", dest, "status", "--porcelain=v1"], {
      timeoutMs: 15000,
    });
    if (statusResult.code !== 0) {
      failGit("git_failed", statusResult);
    }
    let files = porcelainFiles(statusResult.stdout);
    const wanted = (paths || []).map((item) => String(item).replace(/\\/g, "/")).filter(Boolean);
    if (wanted.length) {
      const allowed = new Set(wanted);
      files = files.filter((file) => allowed.has(file));
    }
    const secrets = files.filter((file) => isSecretWorkspacePath(file));
    files = files.filter((file) => !isSecretWorkspacePath(file));
    if (!files.length) {
      deny(
        secrets.length ? "git_secret_path" : "git_nothing_to_commit",
        secrets.length
          ? `no commiteo secretos (${secrets.slice(0, 5).join(", ")})`
          : "no hay cambios para commit"
      );
    }
    for (const file of files) {
      assertInsideRoot(dest, path.join(dest, file));
    }
    const added = await gitRun(["-C", dest, "add", "--", ...files], { timeoutMs: 30000 });
    if (added.code !== 0) {
      failGit("git_commit_failed", added);
    }
    const result = await gitRun(
      ["-C", dest, "-c", `user.name=${ident.name}`, "-c", `user.email=${ident.email}`, "commit", "-m", msg],
      {
        timeoutMs: 30000,
        env: {
          GIT_AUTHOR_NAME: ident.name,
          GIT_AUTHOR_EMAIL: ident.email,
          GIT_COMMITTER_NAME: ident.name,
          GIT_COMMITTER_EMAIL: ident.email,
        },
      }
    );
    if (result.code !== 0) {
      failGit("git_commit_failed", result);
    }
    return {
      slug,
      files,
      skipped_secrets: secrets,
      stdout: redact(result.stdout || "").slice(0, 1500),
    };
  }

  async function push(slug) {
    const dest = requireRepo(slug);
    await ensureRepoIdentity(dest);
    const branch = await currentBranch(slug);
    if (isProtectedBranch(branch) || !branch || branch === "HEAD") {
      deny(
        "git_protected_branch",
        `estás en ${branch || "HEAD"}. Creá una rama feat/... antes de pushear. main/master están vedados.`
      );
    }
    return await withRepoAskpass(dest, async (authEnv) => {
      await ensureHistory(dest, authEnv);
      const result = await gitRun(["-C", dest, "push", "-u", "--", "origin", "HEAD"], {
        env: authEnv,
        timeoutMs: 180000,
        allowPush: true,
      });
      if (result.code !== 0) {
        const err = new Error(result.stderr.slice(0, 400) || "git push falló");
        err.code = /auth|403|401|could not read/i.test(result.stderr)
          ? "git_auth_failed"
          : "git_push_failed";
        throw err;
      }
      await gitRun(["-C", dest, "fetch", "--", "origin", branch], {
        env: authEnv,
        timeoutMs: 30000,
      }).catch(() => {});
      return {
        slug,
        branch,
        stdout: redact(`${result.stdout || ""}\n${result.stderr || ""}`.trim()).slice(0, 2000),
      };
    });
  }

  async function getLastCommitInfo(slug) {
    const dest = requireRepo(slug);
    const result = await gitRun(
      ["-C", dest, "log", "-1", "--pretty=format:%h|%an|%s|%cI"],
      { timeoutMs: 10000 }
    );
    if (result.code !== 0 || !result.stdout?.trim()) {
      return null;
    }
    const [hash, author, subject, date] = result.stdout.trim().split("|");
    return { hash, author, subject, date };
  }

  async function getRoadmapTickets(slug) {
    const dest = requireRepo(slug);
    const ticketsDir = path.join(dest, "roadmap", "tickets");
    const fallbackDir = path.join(dest, "roadmap");
    let targetDir = "";
    if (fs.existsSync(ticketsDir)) {
      targetDir = ticketsDir;
    } else if (fs.existsSync(fallbackDir)) {
      targetDir = fallbackDir;
    } else {
      return [];
    }

    let files = [];
    try {
      files = fs.readdirSync(targetDir).filter((f) => f.endsWith(".md") && !f.startsWith("README") && !f.startsWith("00-"));
    } catch {
      return [];
    }
    files.sort();

    let logText = "";
    try {
      const logRes = await gitRun(["-C", dest, "log", "-n", "40", "--pretty=format:%s%n%b"], { timeoutMs: 15000 });
      if (logRes.code === 0) {
        logText = logRes.stdout || "";
      }
    } catch {}

    let branchName = "";
    try {
      const branchRes = await gitRun(["-C", dest, "rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 5000 });
      if (branchRes.code === 0) {
        branchName = branchRes.stdout?.trim() || "";
      }
    } catch {}

    const tickets = [];
    for (const file of files) {
      const fullPath = path.join(targetDir, file);
      let title = file.replace(/\.md$/, "");
      let ticketId = "";
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        const headingMatch = content.match(/^#+\s*(.+)$/m);
        if (headingMatch) {
          title = headingMatch[1].trim();
        }
      } catch {}

      const idMatch = file.match(/^([A-Za-z]+)[-_]?([0-9]+)/);
      let completed = false;
      if (idMatch) {
        const prefix = idMatch[1].toUpperCase();
        const num = idMatch[2];
        ticketId = `${prefix}-${num}`;
        const numInt = parseInt(num, 10);
        const patterns = [
          `${prefix}${num}`,
          `${prefix}-${num}`,
          `${prefix}${numInt}`,
          `${prefix}-${numInt}`,
        ];
        const idRegex = new RegExp(`\\b(${patterns.join("|")})\\b`, "i");
        completed = idRegex.test(logText) || idRegex.test(branchName);
      }

      tickets.push({
        id: ticketId || file.replace(/\.md$/, ""),
        filename: file,
        title,
        completed,
      });
    }

    return tickets;
  }

  async function createOrGetPullRequest({
    slug,
    branch,
    title = "",
    body = "",
    base = "main",
    garfioComment = "",
  }) {
    const dest = requireRepo(slug);
    const remote = await existingRemote(dest);
    if (!remote) {
      return { prUrl: "", manual: true, error: "no_remote" };
    }

    let parsed;
    try {
      parsed = parseHttpsGitUrl(remote);
    } catch (err) {
      return { prUrl: "", manual: true, error: err.message || "invalid_remote" };
    }

    const { host, owner, repo } = parsed;
    if (host !== "github.com") {
      if (host === "gitlab.com") {
        return {
          prUrl: `https://gitlab.com/${owner}/${repo}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}`,
          manual: true,
          owner,
          repo,
        };
      }
      return { prUrl: "", manual: true, error: `unsupported_host: ${host}` };
    }

    const compareUrl = `https://github.com/${owner}/${repo}/compare/${encodeURIComponent(branch)}?expand=1`;

    const token = githubToken || process.env.GITHUB_TOKEN || "";
    if (!token || /CAMBIAR_POR|REEMPLAZAR|ejemplo/i.test(token)) {
      return {
        prUrl: compareUrl,
        manual: true,
        reason: "no_github_token",
        owner,
        repo,
      };
    }

    const prTitle = String(title || `feat: ${branch}`).trim();
    const prBody = String(body || `Automated PR generated by Murray & Garfio for branch ${branch}.`).trim();

    let prResult = null;
    try {
      const createRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "murray-agent",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: prTitle,
          head: branch,
          base: base || "main",
          body: prBody,
        }),
      });

      if (createRes.status === 201) {
        const data = await createRes.json();
        prResult = {
          prUrl: data.html_url,
          prNumber: data.number,
          prTitle: data.title,
          created: true,
          owner,
          repo,
        };
      } else if (createRes.status === 422) {
        const getRes = await fetchImpl(
          `https://api.github.com/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "murray-agent",
            },
          }
        );
        if (getRes.ok) {
          const list = await getRes.json();
          if (Array.isArray(list) && list.length > 0) {
            prResult = {
              prUrl: list[0].html_url,
              prNumber: list[0].number,
              prTitle: list[0].title,
              created: false,
              owner,
              repo,
            };
          }
        }
      }

      if (prResult && prResult.prNumber && garfioComment) {
        await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/issues/${prResult.prNumber}/comments`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "murray-agent",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ body: garfioComment }),
        }).catch(() => {});
      }

      if (prResult) {
        return prResult;
      }

      return {
        prUrl: compareUrl,
        manual: true,
        error: `github_api_status_${createRes.status}`,
        owner,
        repo,
      };
    } catch (fetchErr) {
      return {
        prUrl: compareUrl,
        manual: true,
        error: fetchErr.message,
        owner,
        repo,
      };
    }
  }

  return {
    root,
    parseHttpsGitUrl,
    extractHttpsGitUrl,
    parseTarget,
    repoDir,
    clone,
    tree,
    read,
    grep,
    list,
    remove,
    currentBranch,
    status,
    diff,
    log,
    commitsAhead,
    pull,
    checkout,
    commit,
    push,
    getLastCommitInfo,
    getRoadmapTickets,
    createOrGetPullRequest,
  };
}
