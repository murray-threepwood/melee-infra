import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let garfioPersonaText = "";
try {
  garfioPersonaText = fs.readFileSync(
    path.join(__dirname, "garfio-persona.md"),
    "utf8"
  ).trim();
} catch {
  garfioPersonaText =
    "Sos Garfio (Meathook), Obrero Mecánico Senior (AACC 130+, 30+ años IT). Trabajá SOLO en el repo ya clonado. No hagas git push. No edites murray-infra. Si el mismo comando falla 3 veces, parate y reportá.";
}

function deny(code, message, status = 502) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  throw err;
}

const SANDBOX_UNREACHABLE_LLM_HOSTS = new Set([
  "litellm",
  "openhands",
  "murray-agent",
  "n8n",
  "postgres_db",
  "workspace-mcp",
  "cloudflared",
]);

export function openHandsLlmModel(llmModel) {
  const clean = String(llmModel || "").trim();
  if (!clean) {
    return "";
  }
  return clean.startsWith("openai/") ? clean : `openai/${clean}`;
}

export function sandboxLlmBaseUrl({
  baseUrl = process.env.OPENHANDS_SANDBOX_LLM_BASE_URL ||
    "http://host.docker.internal:4000",
} = {}) {
  return assertSandboxReachableLlmBaseUrl(baseUrl);
}

export function assertSandboxReachableLlmBaseUrl(url) {
  const raw = String(url || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    const err = new Error("sandbox_llm_unreachable: URL inválida");
    err.code = "sandbox_llm_unreachable";
    throw err;
  }
  if (SANDBOX_UNREACHABLE_LLM_HOSTS.has(parsed.hostname)) {
    const err = new Error(
      `sandbox_llm_unreachable: ${parsed.hostname} no resuelve en oh-agent-server (bridge). Usá host.docker.internal.`
    );
    err.code = "sandbox_llm_unreachable";
    throw err;
  }
  return raw.replace(/\/+$/, "");
}

const RESERVED_SECRET_PREFIXES = ["LLM_"];

export function conversationSecrets(llmApiKey) {
  const key = String(llmApiKey || "").trim();
  if (!key) {
    return undefined;
  }
  return assertNoReservedSecretNames({ OPENAI_API_KEY: key });
}

export function assertNoReservedSecretNames(secrets) {
  for (const name of Object.keys(secrets || {})) {
    if (RESERVED_SECRET_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      const err = new Error(
        `reserved_secret_name: '${name}' starts with reserved prefix and cannot be used`
      );
      err.code = "reserved_secret_name";
      throw err;
    }
  }
  return secrets;
}

export const DEFAULT_MISSION_MAX_MS = 12 * 60 * 1000;
export const DEFAULT_MISSION_HARD_MAX_MS = 4 * 60 * 60 * 1000;

export function gitChangeCount(changes) {
  if (!changes) {
    return 0;
  }
  if (Array.isArray(changes.items)) {
    return changes.items.length;
  }
  if (Array.isArray(changes)) {
    return changes.length;
  }
  return 0;
}

export function consecutiveFailedCommands(events = []) {
  const fails = [];
  for (const event of events) {
    const kind = event.kind || event.event_type || "";
    const payload = event.payload || event.observation || event;
    const text = JSON.stringify(payload).slice(0, 2000);
    const cmd =
      payload?.action?.command ||
      payload?.command ||
      payload?.args?.command ||
      "";
    const exitMatch = text.match(/exit[_ ]?code["']?\s*[:=]\s*(-?\d+)/i);
    const exitCode = exitMatch ? Number(exitMatch[1]) : null;
    if (kind === "ObservationEvent" && exitCode !== null && exitCode !== 0 && cmd) {
      fails.push(String(cmd));
    }
  }
  if (!fails.length) {
    return { repeats: 0, command: "" };
  }
  const last = fails[fails.length - 1];
  let repeats = 0;
  for (let i = fails.length - 1; i >= 0; i -= 1) {
    if (fails[i] === last) {
      repeats += 1;
    } else {
      break;
    }
  }
  return { repeats, command: last };
}

export function missionHasDeliverable({ changes, files, commitsAhead } = {}) {
  if (gitChangeCount(changes) > 0) {
    return true;
  }
  if (Array.isArray(files) && files.length > 0) {
    return true;
  }
  return Number(commitsAhead) > 0;
}

function sandboxIsLive(executionStatus, sandboxStatus) {
  const status = String(executionStatus || "").toLowerCase();
  const sandbox = String(sandboxStatus || "").toUpperCase();
  return sandbox === "RUNNING" || status === "running";
}

export function detectStuck({
  executionStatus = "",
  sandboxStatus = "",
  events = [],
  startedAt = Date.now(),
  now = Date.now(),
  maxMs = DEFAULT_MISSION_MAX_MS,
  hardMaxMs = DEFAULT_MISSION_HARD_MAX_MS,
  maxRepeats = 3,
} = {}) {
  const status = String(executionStatus || "").toLowerCase();
  const sandbox = String(sandboxStatus || "").toUpperCase();
  if (status === "stuck" || status === "error") {
    return { stuck: true, reason: status };
  }
  if (status === "waiting_for_confirmation") {
    return { stuck: true, reason: "waiting_for_confirmation" };
  }
  if (sandbox === "ERROR") {
    return { stuck: true, reason: "sandbox_error" };
  }
  const elapsed = now - Number(startedAt || 0);
  if (elapsed > Number(hardMaxMs || DEFAULT_MISSION_HARD_MAX_MS)) {
    return { stuck: true, reason: "timeout" };
  }
  if (elapsed > maxMs && !sandboxIsLive(status, sandbox)) {
    return { stuck: true, reason: "timeout" };
  }
  const loop = consecutiveFailedCommands(events);
  if (loop.repeats >= maxRepeats) {
    return {
      stuck: true,
      reason: "stuck_loop_detected",
      command: loop.command,
      repeats: loop.repeats,
    };
  }
  return { stuck: false, reason: "" };
}

export function isAgentDone({ executionStatus = "", sandboxStatus = "" } = {}) {
  const status = String(executionStatus || "").toLowerCase();
  const sandbox = String(sandboxStatus || "").toUpperCase();
  if (sandbox === "ERROR" || sandbox === "MISSING") {
    return false;
  }
  if (sandbox === "PAUSED" && status !== "finished" && status !== "idle") {
    return false;
  }
  return status === "finished" || status === "idle" || status === "paused";
}

export function isSandboxPaused({ executionStatus = "", sandboxStatus = "" } = {}) {
  const sandbox = String(sandboxStatus || "").toUpperCase();
  if (sandbox !== "PAUSED") {
    return false;
  }
  const status = String(executionStatus || "").toLowerCase();
  return status !== "finished" && status !== "idle";
}

export function summarizeEvents(events = [], { maxChars = 1800 } = {}) {
  const lines = [];
  for (const event of events) {
    const kind = event.kind || event.event_type || "event";
    const payload = event.payload || event.message || event;
    let text = "";
    if (typeof payload === "string") {
      text = payload;
    } else if (payload?.content) {
      text = Array.isArray(payload.content)
        ? payload.content.map((part) => part.text || "").join(" ")
        : String(payload.content);
    } else {
      text = JSON.stringify(payload);
    }
    text = String(text || "")
      .replace(/\s+/g, " ")
      .slice(0, 220);
    if (text) {
      lines.push(`${kind}: ${text}`);
    }
    if (lines.join("\n").length > maxChars) {
      break;
    }
  }
  return lines.join("\n").slice(0, maxChars) || "(sin eventos útiles)";
}

export function extractGarfioRationale(events = []) {
  let lastAgentText = "";
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i] || {};
    const kind = ev.kind || ev.event_type || "";
    const payload = ev.payload || ev.message || ev;
    const role = String(payload?.role || payload?.sender || "").toLowerCase();
    let text = "";

    if (typeof payload === "string") {
      text = payload;
    } else if (payload?.content) {
      text = Array.isArray(payload.content)
        ? payload.content.map((p) => p.text || "").join(" ")
        : String(payload.content);
    } else if (payload?.text) {
      text = String(payload.text);
    }

    if (!text || text.length < 20) {
      const actionMsg =
        ev.action?.message ||
        ev.action?.args?.message ||
        (typeof ev.action === "string" ? ev.action : "");
      if (actionMsg) {
        text = String(actionMsg);
      }
    }

    if (!text || text.length < 20) {
      if (Array.isArray(ev.thought)) {
        text = ev.thought.map((t) => t?.text || "").filter(Boolean).join("\n");
      } else if (typeof ev.thought === "string") {
        text = ev.thought;
      }
    }

    const isAgent =
      role === "assistant" ||
      kind === "MessageEvent" ||
      kind === "ActionEvent" ||
      ev.source === "agent" ||
      ev.tool_name === "finish" ||
      ev.action?.kind === "FinishAction";

    if (isAgent) {
      if (text && (text.includes("###") || text.includes("##") || text.length > 40)) {
        lastAgentText = text;
        break;
      }
    }
  }

  function extractSection(headingPattern) {
    const regex = new RegExp(`#{2,4}\\s*${headingPattern}[^\\n]*\\n([\\s\\S]*?)(?=(?:#{2,4}|$))`, "i");
    const match = lastAgentText.match(regex);
    return match ? match[1].trim() : "";
  }

  const summary = extractSection("(?:Resumen(?: de Cambios)?)");
  const decisions = extractSection("(?:Racional(?: T[eé]cnico)?(?: y Decisiones)?)");
  const antiPatternsAvoided = extractSection("(?:Humo(?: y Antipatrones Descartados)?)");
  const testStatus = extractSection("(?:Estado de Tests|Tests)");

  return {
    raw: lastAgentText,
    summary,
    decisions,
    antiPatternsAvoided,
    testStatus,
  };
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function extractGarfioLiveActivity(events = []) {
  if (!Array.isArray(events) || events.length === 0) {
    return {
      lastCommand: "",
      lastExitCode: null,
      lastFile: "",
      lastThought: "",
      actionCount: 0,
    };
  }

  let lastCommand = "";
  let lastExitCode = null;
  let lastFile = "";
  let lastThought = "";
  let actionCount = 0;

  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i] || {};
    const payload = ev.payload || ev;
    const actionName = String(ev.action || payload?.action || ev.kind || "").toLowerCase();
    const args = payload?.args || ev.args || {};

    if (!lastCommand) {
      const cmd =
        args?.command ||
        payload?.command ||
        (actionName === "run" || actionName === "execute_bash" ? payload?.content : "") ||
        "";
      if (typeof cmd === "string" && cmd.trim()) {
        let clean = cmd.trim();
        clean = clean.replace(/^cd\s+\/workspace(?:\/[^&]+)?\s*&&\s*/i, "");
        clean = clean.replace(/\s+/g, " ").slice(0, 95);
        lastCommand = clean;
      }
    }

    if (lastExitCode === null) {
      const exitMatch = JSON.stringify(payload).match(/exit[_ ]?code["']?\s*[:=]\s*(-?\d+)/i);
      if (exitMatch) {
        lastExitCode = Number(exitMatch[1]);
      } else if (typeof payload?.exit_code === "number") {
        lastExitCode = payload.exit_code;
      }
    }

    if (!lastFile) {
      const filePath =
        args?.path ||
        args?.file_path ||
        payload?.path ||
        payload?.file_path ||
        "";
      if (typeof filePath === "string" && filePath.trim()) {
        let clean = filePath.trim();
        clean = clean.replace(/^\/workspace\/project\/[^/]+\//i, "");
        clean = clean.replace(/^\/workspace\/[^/]+\//i, "");
        lastFile = clean;
      }
    }

    if (!lastThought) {
      const thought =
        payload?.thought ||
        payload?.reasoning_content ||
        ev?.thought ||
        (ev?.source === "agent" && typeof payload?.content === "string" && !payload.content.startsWith("###")
          ? payload.content
          : "");
      if (typeof thought === "string" && thought.trim()) {
        const clean = thought.trim().replace(/\s+/g, " ");
        if (clean.length > 10 && clean.split(" ").length >= 3 && !clean.startsWith("<") && !clean.startsWith("###")) {
          lastThought = clean.slice(0, 110);
        }
      }
    }

    if (ev.source === "agent" || ev.action) {
      actionCount++;
    }

    if (lastCommand && lastFile && lastThought) {
      break;
    }
  }

  return {
    lastCommand,
    lastExitCode,
    lastFile,
    lastThought,
    actionCount,
  };
}

export function formatMalManagerReport({
  elapsedMs = 0,
  sandboxStatus = "RUNNING",
  activity = {},
  slug = "",
  inline = false,
} = {}) {
  const mins = Math.floor(elapsedMs / 60000);
  const secs = Math.floor((elapsedMs % 60000) / 1000);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const sand = escapeHtml(String(sandboxStatus || "RUNNING").toUpperCase());
  const repoSlug = escapeHtml(slug || "");

  const lines = [];
  if (!inline) {
    lines.push(`💀 <b>[Murray: Mal Manager Report]</b>`);
  }
  lines.push(
    `⏱️ <b>En vuelo:</b> <code>${timeStr}</code> | <b>Sandbox:</b> <code>${sand}</code>${
      repoSlug ? ` | <b>Repo:</b> <code>${repoSlug}</code>` : ""
    }`
  );
  lines.push(``);
  lines.push(`📋 <b>En qué anda Garfio:</b>`);

  if (activity.lastCommand) {
    const exitPart =
      activity.lastExitCode !== null && activity.lastExitCode !== undefined
        ? ` (Exit: ${activity.lastExitCode})`
        : "";
    lines.push(`• <b>Comando:</b> <code>${escapeHtml(activity.lastCommand)}</code>${exitPart}`);
  }
  if (activity.lastFile) {
    lines.push(`• <b>Archivo:</b> <code>${escapeHtml(activity.lastFile)}</code>`);
  }
  if (activity.lastThought) {
    lines.push(`• <b>Paso:</b> ${escapeHtml(activity.lastThought)}`);
  } else if (!activity.lastFile && !activity.lastCommand) {
    lines.push(`• <i>Iniciando entorno y analizando el árbol de archivos...</i>`);
  }

  const verdicts = [
    `"El manco sigue picando de espaldas al monitor. Por ahora no prendió fuego nada."`,
    `"Tiene los garfios echando humo. No parece trancado, pero tampoco cantes victoria todavía."`,
    `"Sigue peleando con el código como grumete en tormenta caribeña. Lo tengo bajo la lupa."`,
    `"Trabaja a buen ritmo. Le estoy contando los segundos como todo buen jefe insoportable."`,
    `"Avanza paso a paso. No lo interrumpas con preguntas filosóficas que se desconcentra."`,
  ];
  const verdictIndex = Math.floor(elapsedMs / 30000) % verdicts.length;
  lines.push(``, `👁️ <b>El ojo de Murray:</b>`, `<i>${verdicts[verdictIndex]}</i>`);

  return lines.join("\n");
}

export function createOpenHandsClient({
  baseUrl = process.env.OPENHANDS_URL || "http://openhands:3000",
  llmApiKey = process.env.LITELLM_MASTER_KEY || "",
  fetchImpl = fetch,
  timeoutMs = 20000,
} = {}) {
  const root = String(baseUrl).replace(/\/+$/, "");

  async function request(method, path, { query, body } = {}) {
    const url = new URL(`${root}${path}`);
    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const headers = { Accept: "application/json" };
    let bodyText = null;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyText = JSON.stringify(body);
    }
    const res = await fetchImpl(url.toString(), {
      method,
      headers,
      body: bodyText,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      deny(
        "openhands_http_error",
        `OpenHands ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`,
        res.status >= 500 ? 502 : res.status
      );
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return res.json();
    }
    return res.text();
  }

  async function health() {
    const res = await fetchImpl(`${root}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 80) };
  }

  async function startConversation({ title, text, llmModel }) {
    const mission = String(text || "");
    const body = {
      title: String(title || "garfio-code").slice(0, 80),
      initial_message: {
        role: "user",
        content: [{ type: "text", text: mission }],
      },
      system_message_suffix: garfioPersonaText,
    };
    const prefixed = openHandsLlmModel(llmModel);
    if (prefixed) {
      body.llm_model = prefixed;
    }
    const secrets = conversationSecrets(llmApiKey);
    if (secrets) {
      body.secrets = secrets;
    }
    return request("POST", "/api/v1/app-conversations", { body });
  }

  async function getStartTask(id) {
    const rows = await request("GET", "/api/v1/app-conversations/start-tasks", {
      query: { ids: id },
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async function getConversation(id) {
    const rows = await request("GET", "/api/v1/app-conversations", {
      query: { ids: id },
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async function sendMessage(id, text) {
    return request("POST", `/api/v1/app-conversations/${id}/send-message`, {
      body: {
        role: "user",
        run: true,
        content: [{ type: "text", text: String(text || "") }],
      },
    });
  }

  async function searchEvents(id, { limit = 50 } = {}) {
    const page = await request(
      "GET",
      `/api/v1/conversation/${id}/events/search`,
      { query: { limit: String(limit) } }
    );
    return page.items || page.events || [];
  }

  async function gitChanges(id) {
    try {
      return await request("GET", `/api/v1/app-conversations/${id}/git/changes`);
    } catch {
      return { items: [] };
    }
  }

  return {
    health,
    startConversation,
    getStartTask,
    getConversation,
    sendMessage,
    searchEvents,
    gitChanges,
  };
}
