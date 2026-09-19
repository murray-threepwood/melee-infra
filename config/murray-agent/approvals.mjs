import crypto from "node:crypto";
import { openMurrayDb } from "./db.mjs";

function parsePayload(text) {
  try {
    const data = JSON.parse(String(text || "{}"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function rowToToken(row) {
  if (!row) {
    return null;
  }
  const payload = parsePayload(row.payload);
  return {
    ...payload,
    id: row.id,
    expiresAt: Number(row.expires_at),
    used: Boolean(row.used),
  };
}

export function createApprovalStore({
  ttlMs = 15 * 60 * 1000,
  filePath,
  dbPath,
  db,
} = {}) {
  const database =
    db ||
    openMurrayDb({
      filePath: filePath || (dbPath ? undefined : ":memory:"),
      dbPath,
    });

  const insert = database.prepare(
    `INSERT INTO hitl_tokens (id, payload, expires_at, used) VALUES (?, ?, ?, 0)`
  );
  const select = database.prepare(`SELECT * FROM hitl_tokens WHERE id = ?`);
  const markUsed = database.prepare(`UPDATE hitl_tokens SET used = 1 WHERE id = ?`);

  function live(id) {
    const item = rowToToken(select.get(String(id || "")));
    if (!item || item.used || item.expiresAt < Date.now()) {
      return null;
    }
    return item;
  }

  function issue(payload) {
    const id = crypto.randomBytes(8).toString("hex");
    const expiresAt = Date.now() + ttlMs;
    insert.run(id, JSON.stringify({ ...payload, id }), expiresAt);
    return id;
  }

  function peek(id) {
    const item = live(id);
    return item ? { ...item } : null;
  }

  function take(id) {
    const item = live(id);
    if (!item) {
      return null;
    }
    markUsed.run(String(id));
    return { ...item, used: true };
  }

  return { issue, peek, take };
}
