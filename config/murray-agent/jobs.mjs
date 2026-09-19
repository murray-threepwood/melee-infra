import crypto from "node:crypto";
import { openMurrayDb } from "./db.mjs";

const LOG_CAP = 40;
const LIST_CAP = 20;
export const TERMINAL = new Set(["done", "failed", "stuck", "paused"]);

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

export const JOBS_TZ = process.env.MURRAY_TZ || "America/Montevideo";

export function jobsHint(jobId = "") {
  const id = String(jobId || "").trim();
  return id ? `${JOBS_HINT} Este bicho: /jobs ${id}.` : JOBS_HINT;
}

function zonedParts(ts, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Number(ts) || 0));
  const get = (type) => parts.find((row) => row.type === type)?.value || "";
  return {
    day: get("day"),
    month: get("month"),
    year: get("year"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

export function formatClock(ts, { now = Date.now(), timeZone = JOBS_TZ } = {}) {
  const start = zonedParts(ts, timeZone);
  const today = zonedParts(now, timeZone);
  const time = `${start.hour}:${start.minute}`;
  if (start.year === today.year && start.month === today.month && start.day === today.day) {
    return time;
  }
  return `${start.day}/${start.month} ${time}`;
}

function jobStartedAt(job) {
  return Number(job?.createdAt || job?.updatedAt || 0);
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

export function formatJobsSummary(rows, { now = Date.now(), limit = LIST_CAP, timeZone = JOBS_TZ } = {}) {
  if (!rows.length) {
    return "No hay jobs. Clone, pull, código, push y borrar encolan acá. Si te pica la impaciencia: /jobs.";
  }
  const shown = rows.slice(0, limit);
  const lines = shown.map((job) => {
    const subject = jobSubject(job);
    const started = jobStartedAt(job);
    const err = job.error ? ` error: ${String(job.error).slice(0, 80)}` : "";
    return `- ${job.id} ${job.type} ${job.status} ${formatClock(started, { now, timeZone })} ${formatAge(started, now)}${subject ? ` ${subject}` : ""}${err}`;
  });
  return [
    `Jobs (${shown.length}${rows.length > shown.length ? "+" : ""}, más nuevos primero):`,
    ...lines,
    "Si se tranca uno: /jobs <id> para las últimas 20 líneas.",
  ].join("\n");
}

export function formatJobDetail(job, { now = Date.now(), tail = 20, timeZone = JOBS_TZ } = {}) {
  if (!job) {
    return "No hay ese job. /jobs lista los últimos 20.";
  }
  const payload = job.payload || {};
  const started = jobStartedAt(job);
  const lines = collectLogLines(job).slice(-Math.max(1, Number(tail) || 20));
  const header = [
    `Job ${job.id}`,
    `type: ${job.type}`,
    `status: ${job.status}`,
    `start: ${formatClock(started, { now, timeZone })} (hace ${formatAge(started, now)})`,
    payload.slug ? `slug: ${payload.slug}` : "",
    payload.branch ? `branch: ${payload.branch}` : "",
    payload.rel ? `path: ${payload.rel}` : "",
    payload.conversationId ? `conversation: ${payload.conversationId}` : "",
    payload.startTaskId ? `task: ${payload.startTaskId}` : "",
    job.error ? `error: ${job.error}` : "",
  ].filter(Boolean);
  if (!lines.length) {
    return [...header, "log: (vacío)"].join("\n");
  }
  return [...header, `log (últimas ${lines.length}):`, ...lines.map((line) => `- ${line}`)].join(
    "\n"
  );
}

function parseJson(text, fallback) {
  try {
    const data = JSON.parse(String(text || ""));
    return data == null ? fallback : data;
  } catch {
    return fallback;
  }
}

function rowToJob(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    chatId: row.chat_id,
    payload: parseJson(row.payload, {}),
    error: row.error || "",
    log: parseJson(row.log, []),
    createdAt: Number(row.created_at),
    runAfter: Number(row.run_after),
    updatedAt: Number(row.updated_at),
  };
}

export function createJobStore({
  filePath = process.env.MURRAY_JOBS_PATH || "/var/lib/murray-agent/jobs.json",
  dbPath,
  db,
} = {}) {
  const database =
    db ||
    openMurrayDb({
      filePath,
      dbPath,
      jobsPath: filePath && String(filePath).endsWith(".json") ? filePath : undefined,
    });

  const selectOne = database.prepare(`SELECT * FROM jobs WHERE id = ?`);
  const insert = database.prepare(
    `INSERT OR REPLACE INTO jobs (
      id, type, status, chat_id, payload, error, log, created_at, run_after, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const selectChat = database.prepare(`SELECT * FROM jobs WHERE chat_id = ?`);
  const selectAll = database.prepare(`SELECT * FROM jobs`);
  const selectDue = database.prepare(
    `SELECT * FROM jobs WHERE status IN ('queued', 'running') AND run_after <= ?`
  );

  function writeJob(job) {
    insert.run(
      job.id,
      job.type,
      job.status,
      job.chatId,
      JSON.stringify(job.payload && typeof job.payload === "object" ? job.payload : {}),
      String(job.error || ""),
      JSON.stringify(Array.isArray(job.log) ? job.log : []),
      Number(job.createdAt),
      Number(job.runAfter || 0),
      Number(job.updatedAt)
    );
    return job;
  }

  function enqueue(job) {
    const now = Date.now();
    const row = {
      id: job.id || crypto.randomBytes(8).toString("hex"),
      type: job.type,
      status: "queued",
      chatId: String(job.chatId || ""),
      payload: job.payload || {},
      error: "",
      log: Array.isArray(job.log) ? job.log.slice(-LOG_CAP) : [],
      createdAt: now,
      runAfter: Number(job.runAfter || 0),
      updatedAt: now,
    };
    return writeJob(row);
  }

  function get(id) {
    return rowToJob(selectOne.get(String(id)));
  }

  function update(id, patch) {
    const prev = get(id);
    if (!prev) {
      return null;
    }
    const now = Date.now();
    const next = {
      ...prev,
      ...patch,
      updatedAt: now <= Number(prev.updatedAt) ? Number(prev.updatedAt) + 1 : now,
    };
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
    return writeJob(next);
  }

  function appendLog(id, line) {
    const prev = get(id);
    if (!prev) {
      return null;
    }
    const chunks = String(line || "")
      .split(/\n/)
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => row.slice(0, 500));
    if (!chunks.length) {
      return prev;
    }
    const now = Date.now();
    return writeJob({
      ...prev,
      log: [...(prev.log || []), ...chunks].slice(-LOG_CAP),
      updatedAt: now <= Number(prev.updatedAt) ? Number(prev.updatedAt) + 1 : now,
    });
  }

  function list({ chatId = "", limit = LIST_CAP } = {}) {
    const cap = Math.max(1, Math.min(Number(limit) || LIST_CAP, 50));
    const rows = (chatId ? selectChat.all(String(chatId)) : selectAll.all())
      .map(rowToJob)
      .filter((job) => !chatId || String(job.chatId) === String(chatId));
    rows.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    return rows.slice(0, cap);
  }

  function find({ chatId = "", ref = "" } = {}) {
    const needle = String(ref || "").trim().toLowerCase();
    if (!needle) {
      return null;
    }
    const rows = (chatId ? selectChat.all(String(chatId)) : selectAll.all())
      .map(rowToJob)
      .filter((job) => !chatId || String(job.chatId) === String(chatId));
    return (
      rows.find((job) => {
        const payload = job.payload || {};
        return (
          String(job.id).toLowerCase() === needle ||
          String(payload.conversationId || "").toLowerCase() === needle ||
          String(payload.startTaskId || "").toLowerCase() === needle
        );
      }) || null
    );
  }

  function due(now = Date.now()) {
    return selectDue.all(Number(now)).map(rowToJob);
  }

  function running({ types } = {}) {
    const allow = types ? new Set(types) : null;
    return selectAll
      .all()
      .map(rowToJob)
      .filter((job) => {
        if (job.status !== "running") {
          return false;
        }
        if (allow && !allow.has(job.type)) {
          return false;
        }
        return true;
      });
  }

  return { enqueue, get, update, appendLog, list, find, due, running };
}

export function createJobWorker({
  store,
  handlers = {},
  intervalMs = 2000,
  now = () => Date.now(),
  onBeforeCodeKick,
} = {}) {
  let timer = null;
  let busy = false;
  const inFlight = new Map();

  function kick(jobId) {
    const id = String(jobId || "");
    const job = store.get(id);
    if (!job) {
      return Promise.resolve(null);
    }
    if (TERMINAL.has(job.status)) {
      return Promise.resolve(job);
    }
    if (inFlight.has(id)) {
      return inFlight.get(id);
    }
    let settle;
    const pending = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    inFlight.set(id, pending);
    (async () => {
      try {
        const current = store.get(id);
        if (!current || TERMINAL.has(current.status)) {
          settle.resolve(current);
          return;
        }
        const handler = handlers[current.type];
        if (!handler) {
          store.update(id, {
            status: "failed",
            error: `unknown_job_type:${current.type}`,
          });
          settle.resolve(store.get(id));
          return;
        }
        if (current.type === "code" && typeof onBeforeCodeKick === "function") {
          try {
            await onBeforeCodeKick(current);
          } catch (err) {
            store.appendLog(id, `sandbox_ttl_purge_failed ${err.code || err.message}`);
          }
        }
        if (current.status !== "running") {
          store.update(id, { status: "running", error: "" });
        }
        await handler(store.get(id));
        settle.resolve(store.get(id));
      } catch (err) {
        store.update(id, {
          status: "failed",
          error: err.code || err.message || "job_failed",
        });
        settle.resolve(store.get(id));
      } finally {
        inFlight.delete(id);
      }
    })();
    return pending;
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
