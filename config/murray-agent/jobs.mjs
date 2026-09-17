import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LOG_CAP = 40;
const LIST_CAP = 20;
const TERMINAL = new Set(["done", "failed", "stuck"]);

function jobSubject(job) {
  const payload = job?.payload || {};
  return payload.slug || payload.rel || payload.branch || "";
}

function collectLogLines(job) {
  const stored = Array.isArray(job?.log) ? job.log.map((line) => String(line)) : [];
  const extra = String(job?.payload?.log || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const merged = [...stored];
  for (const line of extra) {
    if (!merged.includes(line)) {
      merged.push(line);
    }
  }
  return merged.map((line) => line.slice(0, 400));
}

export const JOBS_HINT = "Si te pica la impaciencia: /jobs.";

export function jobsHint(jobId = "") {
  const id = String(jobId || "").trim();
  return id ? `${JOBS_HINT} Este bicho: /jobs ${id}.` : JOBS_HINT;
}

export function formatAge(ts, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - Number(ts || 0)) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h`;
  }
  return `${Math.floor(seconds / 86400)}d`;
}

export function formatJobsSummary(rows, { now = Date.now(), limit = LIST_CAP } = {}) {
  if (!rows.length) {
    return "No hay jobs. Clone, pull, código, push y borrar encolan acá. Si te pica la impaciencia: /jobs.";
  }
  const shown = rows.slice(0, limit);
  const lines = shown.map((job) => {
    const subject = jobSubject(job);
    const err = job.error ? ` error: ${String(job.error).slice(0, 80)}` : "";
    return `- ${job.id} ${job.type} ${job.status} ${formatAge(job.updatedAt, now)}${subject ? ` ${subject}` : ""}${err}`;
  });
    return [
    `Jobs (${shown.length}${rows.length > shown.length ? "+" : ""}, más nuevos primero):`,
    ...lines,
    "Si se tranca uno: /jobs <id> para las últimas 20 líneas.",
  ].join("\n");
}

export function formatJobDetail(job, { now = Date.now(), tail = 20 } = {}) {
  if (!job) {
    return "No hay ese job. /jobs lista los últimos 20.";
  }
  const payload = job.payload || {};
  const lines = collectLogLines(job).slice(-Math.max(1, Number(tail) || 20));
  const header = [
    `Job ${job.id}`,
    `type: ${job.type}`,
    `status: ${job.status}`,
    `age: ${formatAge(job.updatedAt, now)}`,
    payload.slug ? `slug: ${payload.slug}` : "",
    payload.branch ? `branch: ${payload.branch}` : "",
    payload.rel ? `path: ${payload.rel}` : "",
    job.error ? `error: ${job.error}` : "",
  ].filter(Boolean);
  if (!lines.length) {
    return [...header, "log: (vacío)"].join("\n");
  }
  return [...header, `log (últimas ${lines.length}):`, ...lines.map((line) => `- ${line}`)].join(
    "\n"
  );
}

export function createJobStore({
  filePath = process.env.MURRAY_JOBS_PATH || "/var/lib/murray-agent/jobs.json",
} = {}) {
  function load() {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(raw);
      return data && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  }

  function save(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
  }

  function enqueue(job) {
    const all = load();
    const id = job.id || crypto.randomBytes(8).toString("hex");
    const row = {
      id,
      type: job.type,
      status: "queued",
      chatId: String(job.chatId || ""),
      payload: job.payload || {},
      error: "",
      log: Array.isArray(job.log) ? job.log.slice(-LOG_CAP) : [],
      createdAt: Date.now(),
      runAfter: Number(job.runAfter || 0),
      updatedAt: Date.now(),
    };
    all[id] = row;
    save(all);
    return row;
  }

  function get(id) {
    return load()[String(id)] || null;
  }

  function update(id, patch) {
    const all = load();
    const key = String(id);
    if (!all[key]) {
      return null;
    }
    const prev = all[key];
    const next = { ...prev, ...patch, updatedAt: Date.now() };
    let log = Array.isArray(patch.log)
      ? patch.log.map(String)
      : Array.isArray(prev.log)
        ? [...prev.log]
        : [];
    if (!Array.isArray(patch.log) && patch.status && patch.status !== prev.status && TERMINAL.has(patch.status)) {
      const err = String(patch.error || "").slice(0, 400);
      log.push(`status=${patch.status}${err ? ` ${err}` : ""}`);
    }
    next.log = log.slice(-LOG_CAP);
    all[key] = next;
    save(all);
    return next;
  }

  function appendLog(id, line) {
    const all = load();
    const key = String(id);
    if (!all[key]) {
      return null;
    }
    const chunks = String(line || "")
      .split(/\n/)
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => row.slice(0, 500));
    if (!chunks.length) {
      return all[key];
    }
    const log = [...(all[key].log || []), ...chunks].slice(-LOG_CAP);
    all[key] = { ...all[key], log, updatedAt: Date.now() };
    save(all);
    return all[key];
  }

  function list({ chatId = "", limit = LIST_CAP } = {}) {
    const cap = Math.max(1, Math.min(Number(limit) || LIST_CAP, 50));
    const rows = Object.values(load()).filter(
      (job) => !chatId || String(job.chatId) === String(chatId)
    );
    rows.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    return rows.slice(0, cap);
  }

  function due(now = Date.now()) {
    return Object.values(load()).filter(
      (job) =>
        (job.status === "queued" || job.status === "running") &&
        Number(job.runAfter || 0) <= now
    );
  }

  return { enqueue, get, update, appendLog, list, due };
}

export function createJobWorker({
  store,
  handlers = {},
  intervalMs = 2000,
  now = () => Date.now(),
} = {}) {
  let timer = null;
  let busy = false;

  async function kick(jobId) {
    const job = store.get(jobId);
    if (!job) {
      return null;
    }
    if (job.status === "done" || job.status === "failed" || job.status === "stuck") {
      return job;
    }
    const handler = handlers[job.type];
    if (!handler) {
      store.update(jobId, {
        status: "failed",
        error: `unknown_job_type:${job.type}`,
      });
      return store.get(jobId);
    }
    store.update(jobId, { status: "running", error: "" });
    try {
      await handler(store.get(jobId));
    } catch (err) {
      store.update(jobId, {
        status: "failed",
        error: err.code || err.message || "job_failed",
      });
    }
    return store.get(jobId);
  }

  async function drain() {
    if (busy) {
      return;
    }
    busy = true;
    try {
      const jobs = store.due(now());
      for (const job of jobs) {
        await kick(job.id);
      }
    } finally {
      busy = false;
    }
  }

  function start() {
    if (timer) {
      return;
    }
    timer = setInterval(() => {
      drain().catch(() => {});
    }, intervalMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    drain().catch(() => {});
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { kick, drain, start, stop };
}
