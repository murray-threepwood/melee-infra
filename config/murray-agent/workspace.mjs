import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { redact } from "./redact.mjs";

export const ALLOWED_GIT_HOSTS = new Set(["github.com", "gitlab.com"]);

const GIT_FORBIDDEN = new Set([
  "push",
  "credential",
  "daemon",
  "filter-branch",
  "update-index",
  "--exec",
  "send-pack",
  "receive-pack",
]);

const HTTPS_GIT_RE =
  /https:\/\/(?:www\.)?(github\.com|gitlab\.com)\/[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)+/gi;

function deny(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

export function assertSafeGitArgs(args) {
  const tokens = (args || []).map((item) => String(item));
  for (const token of tokens) {
    const bare = token.replace(/^-+/, "").toLowerCase();
    if (GIT_FORBIDDEN.has(token) || GIT_FORBIDDEN.has(bare) || token.toLowerCase() === "push") {
      deny("git_forbidden", `git ${token} está prohibido (no hay push desde el bot)`);
    }
  }
  return tokens;
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

export function assertInsideRoot(root, target) {
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(target);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (resolved !== rootResolved && !resolved.startsWith(prefix)) {
    deny("workspace_jail", "path fuera de ./workspace");
  }
  return resolved;
}

function defaultGitRun(args, { cwd, env = {}, timeoutMs = 120000 } = {}) {
  assertSafeGitArgs(args);
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

function tokenEnvForHost(host, { githubToken, gitlabToken }) {
  const token =
    host === "gitlab.com" ? gitlabToken || githubToken : githubToken || gitlabToken;
  if (!token || /CAMBIAR_POR|REEMPLAZAR|ejemplo/i.test(token)) {
    return {};
  }
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: bearer ${token}`,
  };
}

function isProbablyBinary(buf) {
  const slice = buf.subarray(0, Math.min(buf.length, 8000));
  return slice.includes(0);
}

export function createWorkspace({
  root = process.env.MURRAY_WORKSPACE_ROOT || "/opt/workspace",
  gitRun = defaultGitRun,
  githubToken = process.env.GITHUB_TOKEN || "",
  gitlabToken = process.env.GITLAB_TOKEN || "",
  maxFiles = 200,
  maxBytes = 32768,
  maxHits = 40,
} = {}) {
  function repoDir(slug) {
    const safe = String(slug || "").replace(/[^A-Za-z0-9._-]/g, "");
    if (!safe) {
      deny("workspace_slug_denied", "slug vacío");
    }
    return assertInsideRoot(root, path.join(root, safe));
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

  async function clone({ url }) {
    const parsed = parseHttpsGitUrl(url);
    fs.mkdirSync(root, { recursive: true });
    const dest = repoDir(parsed.slug);
    if (fs.existsSync(dest)) {
      const remote = await existingRemote(dest);
      if (remote.replace(/\.git$/i, "") === parsed.href.replace(/\.git$/i, "")) {
        return { slug: parsed.slug, url: parsed.href, reused: true, dest };
      }
      deny(
        "workspace_exists",
        `ya hay otro árbol en ${parsed.slug}; pedime otro slug o borralo a mano en ./workspace`
      );
    }
    const env = tokenEnvForHost(parsed.host, { githubToken, gitlabToken });
    const result = await gitRun(
      ["clone", "--depth", "1", "--single-branch", "--", parsed.href, dest],
      { env, timeoutMs: 120000 }
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
    return { slug: parsed.slug, url: parsed.href, reused: false, dest };
  }

  function tree(slug) {
    const dest = repoDir(slug);
    if (!fs.existsSync(dest)) {
      deny("workspace_missing", `no hay repo activo ${slug}`);
    }
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
    const dest = repoDir(slug);
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
    const dest = repoDir(slug);
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

  return {
    root,
    parseHttpsGitUrl,
    extractHttpsGitUrl,
    repoDir,
    clone,
    tree,
    read,
    grep,
  };
}
