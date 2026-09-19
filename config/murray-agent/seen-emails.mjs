import { openMurrayDb } from "./db.mjs";
import { formatClock } from "./jobs.mjs";

export const SEEN_TZ = process.env.MURRAY_TZ || "America/Montevideo";

export function isSeenEmailsIntent(text) {
  const t = String(text || "").trim().toLowerCase();
  return (
    /qu[eé]\s+mails\s+procesaste\s+hoy/.test(t) ||
    /\bmails de hoy\b/.test(t) ||
    /\bcorreos de hoy\b/.test(t)
  );
}

export function formatSeenToday(rows, { now = Date.now(), timeZone = SEEN_TZ } = {}) {
  if (!rows.length) {
    return `Hoy no marqué ningún mail visto. Cero subjects: solo ids.`;
  }
  const lines = rows.map((row) => {
    const clock = formatClock(row.processed_at, { now, timeZone });
    return `- ${row.message_id} ${clock}`;
  });
  return [
    `Mails vistos hoy (${rows.length}), solo ids:`,
    ...lines,
    "Cero asuntos ni remitentes. No toqué Gmail unread.",
  ].join("\n");
}

export function civilDay(ts, timeZone = SEEN_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Number(ts) || 0));
}

export function createSeenEmailStore({ filePath, dbPath, db } = {}) {
  const database = db || openMurrayDb({ filePath, dbPath });
  const exists = database.prepare(
    `SELECT 1 AS ok FROM seen_emails WHERE message_id = ?`
  );
  const upsert = database.prepare(
    `INSERT INTO seen_emails (message_id, thread_id, processed_at)
     VALUES (?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET
       thread_id = excluded.thread_id,
       processed_at = excluded.processed_at`
  );
  const countOne = database.prepare(
    `SELECT COUNT(*) AS n FROM seen_emails WHERE message_id = ?`
  );
  const selectAll = database.prepare(
    `SELECT message_id, thread_id, processed_at FROM seen_emails ORDER BY processed_at ASC`
  );

  function uniqueIds(ids) {
    const seen = new Set();
    const ordered = [];
    for (const raw of ids) {
      const id = String(raw || "").trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      ordered.push(id);
    }
    return ordered;
  }

  function filterNew(ids) {
    return uniqueIds(ids).filter((id) => !exists.get(id));
  }

  function markSeen({ messageId, threadId = "" } = {}) {
    const id = String(messageId || "").trim();
    if (!id) {
      const err = new Error("message_id_required");
      err.code = "message_id_required";
      throw err;
    }
    upsert.run(id, String(threadId || ""), Date.now());
    return { status: "ok" };
  }

  function count(messageId) {
    return Number(countOne.get(String(messageId || "")).n);
  }

  function listToday({ now = Date.now(), timeZone = SEEN_TZ } = {}) {
    const today = civilDay(now, timeZone);
    return selectAll.all()
      .filter((row) => civilDay(row.processed_at, timeZone) === today)
      .map((row) => ({
        message_id: row.message_id,
        processed_at: Number(row.processed_at),
      }));
  }

  return { filterNew, markSeen, count, listToday };
}
