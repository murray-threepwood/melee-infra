const ALL_KINDS = Object.freeze([
  "clone",
  "code",
  "delete",
  "push",
  "ops",
  "stuck",
]);

export function parseHitlBypass(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text || text === "0" || text === "false" || text === "off" || text === "none") {
    return new Set();
  }
  if (text === "1" || text === "true" || text === "all" || text === "on") {
    return new Set(ALL_KINDS);
  }
  return new Set(
    text
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter((item) => ALL_KINDS.includes(item))
  );
}

export function shouldBypassHitl(kind, bypass = parseHitlBypass(process.env.MURRAY_HITL_BYPASS)) {
  return bypass instanceof Set ? bypass.has(String(kind || "")) : false;
}

export function isTelegramQuiet(raw = process.env.MURRAY_TELEGRAM_QUIET) {
  const text = String(raw ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "on" || text === "quiet";
}
