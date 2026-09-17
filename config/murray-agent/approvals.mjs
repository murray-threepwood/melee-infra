import crypto from "node:crypto";

export function createApprovalStore({ ttlMs = 15 * 60 * 1000 } = {}) {
  const items = new Map();

  function issue(payload) {
    const id = crypto.randomBytes(8).toString("hex");
    items.set(id, {
      ...payload,
      id,
      expiresAt: Date.now() + ttlMs,
      used: false,
    });
    return id;
  }

  function take(id) {
    const key = String(id || "");
    const item = items.get(key);
    if (!item || item.used || item.expiresAt < Date.now()) {
      return null;
    }
    item.used = true;
    return { ...item };
  }

  return { issue, take };
}
