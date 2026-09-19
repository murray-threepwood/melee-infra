import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redact } from "./redact.mjs";

export const DEFAULT_INBOX_ROOT =
  process.env.MURRAY_OPERATOR_INBOX || "/opt/operator-inbox";

export function inboxDayStamp(now = Date.now(), timeZone = "America/Montevideo") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Number(now) || Date.now()));
  const get = (type) => parts.find((row) => row.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function createOperatorInbox({
  root = DEFAULT_INBOX_ROOT,
  db,
  now = () => Date.now(),
} = {}) {
  const base = path.resolve(String(root || DEFAULT_INBOX_ROOT));

  function append({
    chatId = "",
    jobId = "",
    title = "tarea humana",
    why = "permiso",
    path: fileHint = "",
    body = "",
  } = {}) {
    fs.mkdirSync(base, { recursive: true });
    const id = crypto.randomBytes(8).toString("hex");
    const createdAt = Number(now()) || Date.now();
    const rel = `${inboxDayStamp(createdAt)}.md`;
    const abs = path.join(base, rel);
    const cleanTitle = redact(String(title || "tarea humana")).slice(0, 180);
    const cleanWhy = redact(String(why || "permiso")).slice(0, 240);
    const cleanPath = redact(String(fileHint || "")).slice(0, 180);
    const cleanBody = redact(String(body || "")).slice(0, 8000);
    const block = [
      `## ${cleanTitle}`,
      "",
      `- id: \`${id}\``,
      `- job: \`${jobId || ""}\``,
      `- chat: \`${chatId || ""}\``,
      `- why: ${cleanWhy}`,
      cleanPath ? `- path: \`${cleanPath}\`` : "",
      `- at: ${new Date(createdAt).toISOString()}`,
      "",
      cleanBody,
      "",
    ]
      .filter((line) => line !== "")
      .join("\n");
    fs.appendFileSync(abs, `${block}\n`, "utf8");
    if (db && typeof db.prepare === "function") {
      db.prepare(
        `INSERT INTO operator_notes (
          id, chat_id, job_id, title, why, path, body, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, String(chatId || ""), String(jobId || ""), cleanTitle, cleanWhy, cleanPath, cleanBody, createdAt);
    }
    return { id, rel, abs, createdAt };
  }

  function list({ chatId = "", limit = 20 } = {}) {
    if (!db || typeof db.prepare !== "function") {
      return [];
    }
    const cap = Math.max(1, Math.min(Number(limit) || 20, 50));
    const needle = String(chatId || "");
    const rows = needle
      ? db
          .prepare(
            `SELECT * FROM operator_notes WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?`
          )
          .all(needle, cap)
      : db
          .prepare(`SELECT * FROM operator_notes ORDER BY created_at DESC LIMIT ?`)
          .all(cap);
    return rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      jobId: row.job_id,
      title: row.title,
      why: row.why,
      path: row.path,
      body: row.body,
      createdAt: Number(row.created_at),
    }));
  }

  return { append, list, root: base };
}
