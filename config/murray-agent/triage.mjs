const HEAL_CODES = new Set([
  "zombie_sandbox",
  "sandbox_oom_137",
  "sandbox_error",
  "mem_pressure",
  "sandbox_busy",
]);

function codesOf(findings) {
  return new Set((findings || []).map((row) => row.code));
}

export function parseSandboxPs(stdout) {
  const rows = [];
  for (const line of String(stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [id, name, ...statusParts] = trimmed.split(/\s+/);
    if (!id || !name) {
      continue;
    }
    const status = statusParts.join(" ");
    const exitMatch = status.match(/\((\d+)\)/);
    rows.push({
      id,
      name,
      status,
      running: /^up\b/i.test(status),
      exitCode: exitMatch ? Number(exitMatch[1]) : null,
    });
  }
  return rows;
}

function parseMemToken(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/^([\d.]+)\s*(B|KiB|MiB|GiB)$/i);
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "b") {
    return value / (1024 * 1024);
  }
  if (unit === "kib") {
    return value / 1024;
  }
  if (unit === "gib") {
    return value * 1024;
  }
  return value;
}

export function parseMemStats(stdout) {
  let usedMiB = 0;
  let limitMiB = 0;
  for (const line of String(stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const tab = trimmed.includes("\t") ? trimmed.split("\t") : trimmed.split(/\s{2,}/);
    const usage = tab.length > 1 ? tab.slice(1).join(" ").trim() : trimmed;
    const parts = usage.split("/").map((part) => part.trim());
    if (parts.length < 2) {
      continue;
    }
    usedMiB += parseMemToken(parts[0].split(/\s+/).pop());
    const cap = parseMemToken(parts[1].split(/\s+/).shift());
    if (cap > limitMiB) {
      limitMiB = cap;
    }
  }
  return { usedMiB, limitMiB };
}

function countStarts(job) {
  const chunks = [
    ...(Array.isArray(job?.log) ? job.log : []),
    job?.payload?.log || "",
  ];
  const text = chunks.join("\n");
  return (text.match(/OpenHands arrancó/g) || []).length;
}

function jobError(job) {
  return String(job?.error || "");
}

export function analyzeSnapshot(snapshot = {}) {
  const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
  const sandboxes = Array.isArray(snapshot.sandboxes) ? snapshot.sandboxes : [];
  const git = snapshot.git || {};
  const mem = snapshot.mem || {};
  const findings = [];
  const ohSandboxes = sandboxes.filter((row) =>
    /^oh-agent-server-/.test(String(row.name || ""))
  );
  const running = ohSandboxes.filter((row) => row.running);
  const oom = ohSandboxes.filter((row) => Number(row.exitCode) === 137);
  const activePoll = jobs.some(
    (job) =>
      job.type === "oh_poll" && (job.status === "queued" || job.status === "running")
  );

  for (const job of jobs) {
    if (job.type === "code" && countStarts(job) >= 2) {
      findings.push({
        code: "double_start",
        detail: `job ${job.id} arrancó OpenHands más de una vez`,
      });
      break;
    }
  }

  if (oom.length) {
    findings.push({
      code: "sandbox_oom_137",
      detail: `${oom.length} sandbox(es) murieron con exit 137 (OOM/SIGKILL)`,
    });
  }

  if (running.length && !activePoll) {
    findings.push({
      code: "zombie_sandbox",
      detail: `${running.length} oh-agent-server Up sin oh_poll activo`,
    });
  }

  if (running.length >= 2) {
    findings.push({
      code: "sandbox_busy",
      detail: `${running.length} sandboxes vivos; otro start dispara 429`,
    });
  }

  if (jobs.some((job) => jobError(job) === "sandbox_error")) {
    findings.push({
      code: "sandbox_error",
      detail: "último poll en sandbox_error",
    });
  }
  if (jobs.some((job) => jobError(job) === "sandbox_paused")) {
    findings.push({
      code: "sandbox_paused",
      detail: "sandbox PAUSED: no es misión lista",
    });
  }
  if (jobs.some((job) => jobError(job) === "empty_finish")) {
    findings.push({
      code: "empty_finish",
      detail: "OpenHands dijo finished y el árbol quedó limpio",
    });
  }
  if (jobs.some((job) => jobError(job) === "sandbox_busy")) {
    if (!findings.some((row) => row.code === "sandbox_busy")) {
      findings.push({
        code: "sandbox_busy",
        detail: "misión rechazada: ya había sandboxes vivos",
      });
    }
  }
  if (jobs.some((job) => /poll_error:.*23/.test(jobError(job)) || job.payload?.lastPollError === "23")) {
    findings.push({
      code: "poll_noise_23",
      detail: "GET de OpenHands falló con error 23 (ruido de poll)",
    });
  }

  const used = Number(mem.usedMiB || 0);
  const limit = Number(mem.limitMiB || 0);
  if (limit > 0 && used / limit >= 0.85) {
    findings.push({
      code: "mem_pressure",
      detail: `RAM Docker ${Math.round(used)}/${Math.round(limit)} MiB`,
    });
  }

  const dirty = Array.isArray(git.files) ? git.files : [];
  if (
    !findings.some((row) => row.code === "empty_finish") &&
    jobs.some((job) => job.type === "oh_poll" && job.status === "done") &&
    dirty.length === 0 &&
    jobs.some((job) => (job.log || []).some((line) => /Misión lista/.test(String(line))))
  ) {
    findings.push({
      code: "empty_finish",
      detail: "misión lista con git vacío",
    });
  }

  const found = codesOf(findings);
  const runningOrOom = running.length > 0 || oom.length > 0;
  const wantsHeal =
    [...found].some((code) => HEAL_CODES.has(code)) ||
    (found.has("double_start") && runningOrOom);

  let severity = "ok";
  if (findings.length) {
    severity = found.has("sandbox_oom_137") || found.has("sandbox_error") || found.has("double_start")
      ? "fail"
      : "warn";
  }

  const summary = findings.length
    ? findings.map((row) => row.code).join(", ")
    : "sin hallazgos";

  return {
    findings,
    severity,
    summary,
    sandboxCount: ohSandboxes.length,
    jobHint: jobs[0] ? `${jobs[0].type} ${jobs[0].status}` : "sin jobs",
    heal: wantsHeal ? { action: "heal_openhands" } : null,
  };
}

export function formatTriage(report = {}) {
  const findings = report.findings || [];
  const n = Number(report.sandboxCount || 0);
  const jobsLabel = report.jobHint || "sin jobs";
  if (!findings.length) {
    return `Obrero quieto. ${n} sandbox(es) oh-agent-server, jobs: ${jobsLabel}. Nada que sanar. /jobs si querés el detalle.`;
  }
  const lines = [
    `Obrero: ${report.summary || "hallazgos"}.`,
    ...findings.map((row) => `- ${row.code}: ${row.detail}`),
  ];
  if (report.heal?.action === "heal_openhands") {
    lines.push(
      "Aprobar limpia sandboxes oh-agent-server-* y reinicia openhands. No toca postgres/n8n."
    );
  } else {
    lines.push("Sin heal de Docker. /jobs o el teclado stuck (Reintentar/Parar).");
  }
  return lines.join("\n");
}
