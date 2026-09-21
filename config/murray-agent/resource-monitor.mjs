import fs from "node:fs";
import path from "node:path";
import { escapeTelegramHtml } from "./telegram.mjs";

export const MAX_RAM_MB = 4200; // 4.2 GB
export const MAX_TASK_DURATION_MS = 20 * 60 * 1000; // 20 minutos
export const OOM_EXIT_CODE = 137;

export function checkResourceSaturation({
  memTotalMb = 0,
  exitCode = null,
  durationMs = 0,
} = {}) {
  const reasons = [];

  if (Number(exitCode) === OOM_EXIT_CODE) {
    reasons.push("oom_137_killed: Contenedor sandbox colapsó por Out-Of-Memory (exit code 137)");
  }

  if (Number(memTotalMb) > MAX_RAM_MB) {
    reasons.push(
      `high_memory_pressure: Consumo de RAM acumulado (${Math.round(memTotalMb)} MB) superó el umbral crítico de 4.2 GB`
    );
  }

  if (Number(durationMs) > MAX_TASK_DURATION_MS) {
    reasons.push(
      `task_duration_exceeded: Tarea excedió 20 min continuos (${Math.round(durationMs / 60000)} min)`
    );
  }

  const saturated = reasons.length > 0;
  return {
    saturated,
    reasons,
    recommendation:
      "Delegar ejecución pesada a MicroVMs remotas de E2B (SANDBOX_BACKEND=e2b) para desacoplar de Docker Desktop en macOS ARM64.",
  };
}

export function formatE2BTelegramAlert({
  slug = "",
  jobId = "",
  reasons = [],
  memTotalMb = 0,
} = {}) {
  const reasonLines = (reasons || []).map(
    (r) => `• <code>${escapeTelegramHtml(r)}</code>`
  );

  return [
    "🚨 <b>Alerta de Saturación de Recursos (macOS ARM64)</b>",
    slug ? `Repositorio: <code>${escapeTelegramHtml(slug)}</code>` : "",
    jobId ? `Job ID: <code>${escapeTelegramHtml(jobId)}</code>` : "",
    memTotalMb > 0 ? `Uso RAM detectado: <b>${Math.round(memTotalMb)} MB</b>` : "",
    "",
    "<b>Causas detectadas:</b>",
    ...reasonLines,
    "",
    "💡 <b>Solución Arquitectónica Recomendada:</b>",
    "El anfitrión local ha alcanzado el límite térmico/memoria de Docker Desktop.",
    "Se recomienda migrar la ejecución de sandboxes a MicroVMs remotas configurando:",
    "<code>SANDBOX_BACKEND=e2b</code> y proveyendo <code>E2B_API_KEY</code>.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function recordResourceWarning({
  operatorInboxDir = process.env.MURRAY_OPERATOR_INBOX || "/opt/operator-inbox",
  warning,
  now = () => new Date(),
} = {}) {
  try {
    fs.mkdirSync(operatorInboxDir, { recursive: true });
    const targetFile = path.join(operatorInboxDir, "RESOURCE_WARNINGS.md");
    const dateStr = now().toISOString();
    const entry = [
      `\n## [${dateStr}] Saturación de Recursos Detectada`,
      `- **Job ID**: ${warning.jobId || "N/A"}`,
      `- **Repo Slug**: ${warning.slug || "N/A"}`,
      `- **RAM Total**: ${warning.memTotalMb ? Math.round(warning.memTotalMb) + " MB" : "N/A"}`,
      `- **Causas**:`,
      ...(warning.reasons || []).map((r) => `  - ${r}`),
      `- **Recomendación**: ${warning.recommendation || "Delegar a E2B (SANDBOX_BACKEND=e2b)"}`,
      "",
    ].join("\n");

    fs.appendFileSync(targetFile, entry, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function createResourceMonitor({
  ops,
  jobs,
  operatorInboxDir = process.env.MURRAY_OPERATOR_INBOX || "/opt/operator-inbox",
  telegram,
  now = () => Date.now(),
} = {}) {
  async function inspectAndAlert({
    jobId = "",
    chatId = "",
    slug = "",
    exitCode = null,
    startedAt = 0,
  } = {}) {
    let memTotalMb = 0;
    if (ops && typeof ops.memorySnapshot === "function") {
      try {
        const snap = await ops.memorySnapshot();
        memTotalMb = snap?.totalMiB || 0;
      } catch {
        memTotalMb = 0;
      }
    }

    const durationMs = startedAt > 0 ? now() - startedAt : 0;
    const check = checkResourceSaturation({
      memTotalMb,
      exitCode,
      durationMs,
    });

    if (!check.saturated) {
      return { saturated: false };
    }

    const warning = {
      jobId,
      slug,
      reasons: check.reasons,
      recommendation: check.recommendation,
      memTotalMb,
    };

    recordResourceWarning({ operatorInboxDir, warning });

    if (jobs && jobId && typeof jobs.update === "function") {
      try {
        const existing = jobs.get(jobId);
        const payload = existing?.payload || {};
        jobs.update(jobId, {
          payload: {
            ...payload,
            resourceWarning: warning,
          },
        });
      } catch {}
    }

    const message = formatE2BTelegramAlert(warning);

    if (telegram && chatId && typeof telegram.send === "function") {
      try {
        await telegram.send({
          chat_id: chatId,
          text: message,
          terminal: true,
        });
      } catch {}
    }

    return {
      saturated: true,
      warning,
      message,
    };
  }

  return {
    inspectAndAlert,
    checkResourceSaturation,
    formatE2BTelegramAlert,
    recordResourceWarning,
  };
}
