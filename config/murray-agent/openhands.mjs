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

export function createOpenHandsClient({
  baseUrl = process.env.OPENHANDS_URL || "http://openhands:3000",
  fetchImpl = fetch,
  timeoutMs = 20000,
} = {}) {
  const root = String(baseUrl).replace(/\/+$/, "");

  async function request(method, path, { query, body } = {}) {
    const url = new URL(path, `${root}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }
    const res = await fetchImpl(url, {
      method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text.slice(0, 400) };
    }
    if (!res.ok) {
      deny(
        "openhands_http_failed",
        json.detail || json.message || `openhands_http_${res.status}`,
        res.status
      );
    }
    return json;
  }

  async function health() {
    const res = await fetchImpl(`${root}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text.slice(0, 80) };
  }

  async function startConversation({ title, text }) {
    const mission = String(text || "");
    return request("POST", "/api/v1/app-conversations", {
      body: {
        title: String(title || "murray-code").slice(0, 80),
        initial_message: {
          role: "user",
          content: [{ type: "text", text: mission }],
        },
        system_message_suffix:
          "Trabajá SOLO en el repo ya clonado. No hagas git push. No edites murray-infra. Si el mismo comando falla 3 veces, parate y reportá.",
      },
    });
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
