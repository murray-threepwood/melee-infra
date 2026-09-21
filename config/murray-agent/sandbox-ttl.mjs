import { isOpenHandsSandboxName } from "./ops.mjs";

export const TTL_MS = 30 * 60 * 1000;
export const WATCH_EVERY_MS = 5 * 60 * 1000;
const FLIGHT_TYPES = new Set(["code", "oh_poll", "inspect"]);
const FLIGHT_STATUSES = new Set(["running", "queued"]);

export function isCodeFlight(jobs, { exceptId = "" } = {}) {
  const skip = String(exceptId || "");
  return (jobs || []).some((job) => {
    if (!job || !FLIGHT_STATUSES.has(job.status)) {
      return false;
    }
    if (!FLIGHT_TYPES.has(job.type)) {
      return false;
    }
    if (skip && String(job.id) === skip) {
      return false;
    }
    return true;
  });
}

export function selectOrphans(rows) {
  return (rows || []).filter((row) => isOpenHandsSandboxName(row?.name));
}

export function isOrphanSandboxState(row) {
  if (!row || !isOpenHandsSandboxName(row.name)) {
    return false;
  }
  if (row.running === false) {
    return true;
  }
  const s = String(row.status || "").trim().toLowerCase();
  if (s.startsWith("exited") || s.startsWith("dead") || s.startsWith("created")) {
    return true;
  }
  if (typeof row.exitCode === "number" && !Number.isNaN(row.exitCode)) {
    return true;
  }
  return false;
}

export function selectExpiredSandboxes(rows, { now = Date.now(), ttlMs = TTL_MS } = {}) {
  const cutoff = Number(now) - Number(ttlMs);
  return selectOrphans(rows).filter((row) => Number(row.createdAt || 0) <= cutoff);
}

export function selectPurgeableSandboxes(rows, { now = Date.now(), ttlMs = TTL_MS } = {}) {
  const cutoff = Number(now) - Number(ttlMs);
  return selectOrphans(rows).filter((row) => {
    if (isOrphanSandboxState(row)) {
      return true;
    }
    const created = Number(row.createdAt);
    if (Number.isFinite(created) && created > 0 && created <= cutoff) {
      return true;
    }
    if (created === 0) {
      return true;
    }
    return false;
  });
}

export function createSandboxJanitor({
  ops,
  store,
  now = () => Date.now(),
  ttlMs = Number(process.env.MURRAY_SANDBOX_TTL_MS) || TTL_MS,
  watchEveryMs = Number(process.env.MURRAY_SANDBOX_WATCH_MS) || WATCH_EVERY_MS,
  list,
  purge,
} = {}) {
  const listFn =
    list ||
    (async () =>
      ops && typeof ops.listOpenHandsSandboxes === "function"
        ? ops.listOpenHandsSandboxes({ withCreated: true })
        : []);
  const purgeFn =
    purge ||
    ((ids) =>
      ops && typeof ops.purgeOpenHandsSandboxes === "function"
        ? ops.purgeOpenHandsSandboxes(ids)
        : { removed: [] });

  function flightJobs() {
    if (!store || typeof store.running !== "function") {
      return [];
    }
    return store.running({
      types: ["code", "oh_poll", "inspect"],
      statuses: ["running", "queued"],
    });
  }

  async function purgeOrphans({ exceptJobId = "" } = {}) {
    if (isCodeFlight(flightJobs(), { exceptId: exceptJobId })) {
      return { skipped: "code_flight", removed: [] };
    }
    const rows = selectOrphans(await listFn());
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (!ids.length) {
      return { removed: [] };
    }
    return purgeFn(ids);
  }

  async function tick() {
    if (isCodeFlight(flightJobs())) {
      return { skipped: "code_flight", removed: [] };
    }
    const rows = await listFn();
    const targets = selectPurgeableSandboxes(rows, { now: now(), ttlMs });
    const ids = targets.map((row) => row.id).filter(Boolean);
    if (!ids.length) {
      return { removed: [] };
    }
    return purgeFn(ids);
  }

  function start() {
    const timer = setInterval(() => {
      tick().catch(() => {});
    }, watchEveryMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    return {
      stop() {
        clearInterval(timer);
      },
    };
  }

  return { purgeOrphans, tick, start, ttlMs, watchEveryMs };
}
