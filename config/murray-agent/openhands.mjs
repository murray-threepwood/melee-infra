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

export function detectStuck({
  executionStatus = "",
  sandboxStatus = "",
  events = [],
  startedAt = Date.now(),
  now = Date.now(),
  maxMs = 12 * 60 * 1000,
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
  if (now - Number(startedAt || 0) > maxMs) {
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
    const ev = events[i];
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
    if (role === "assistant" || kind === "MessageEvent" || ev.source === "agent") {
      if (text && (text.includes("###") || text.length > 40)) {
        lastAgentText = text;
        break;
      }
    }
  }

  function extractSection(heading) {
    const regex = new RegExp(`###\\s*${heading}[^\\n]*\\n([\\s\\S]*?)(?=(?:###|\\Z))`, "i");
    const match = lastAgentText.match(regex);
    return match ? match[1].trim() : "";
  }

  const summary = extractSection("Resumen de Cambios");
  const decisions = extractSection("Racional Técnico y Decisiones");
  const antiPatternsAvoided = extractSection("Humo y Antipatrones Descartados");
  const testStatus = extractSection("Estado de Tests");

  return {
    raw: lastAgentText,
    summary,
    decisions,
    antiPatternsAvoided,
    testStatus,
  };
}

export function createOpenHandsClient({
  baseUrl = process.env.OPENHANDS_URL || "http://openhands:3000",
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
    if (llmModel && typeof llmModel === "string" && llmModel.trim()) {
      const clean = llmModel.trim();
      body.llm_model = clean.startsWith("openai/") ? clean : `openai/${clean}`;
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
