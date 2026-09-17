import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
    all[key] = { ...all[key], ...patch, updatedAt: Date.now() };
    save(all);
    return all[key];
  }

  function due(now = Date.now()) {
    return Object.values(load()).filter(
      (job) =>
        (job.status === "queued" || job.status === "running") &&
        Number(job.runAfter || 0) <= now
    );
  }

  return { enqueue, get, update, due };
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
