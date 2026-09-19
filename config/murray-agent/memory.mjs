import { openMurrayDb } from "./db.mjs";

const MAX_MESSAGES = 20;

function parseMessages(text) {
  try {
    const rows = JSON.parse(String(text || "[]"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function createMemory({
  filePath = process.env.MURRAY_MEMORY_PATH || "/var/lib/murray-agent/memory.json",
  dbPath,
  db,
} = {}) {
  const database =
    db ||
    openMurrayDb({
      filePath,
      dbPath,
      memoryPath: filePath && String(filePath).endsWith(".json") ? filePath : undefined,
    });

  const select = database.prepare(
    `SELECT messages FROM session_context WHERE chat_id = ?`
  );
  const ensure = database.prepare(
    `INSERT OR IGNORE INTO session_context (chat_id) VALUES (?)`
  );
  const write = database.prepare(
    `UPDATE session_context SET messages = ? WHERE chat_id = ?`
  );

  return {
    get(chatId) {
      const row = select.get(String(chatId));
      return parseMessages(row?.messages).slice(-MAX_MESSAGES);
    },
    append(chatId, role, content) {
      const key = String(chatId);
      ensure.run(key);
      const rows = parseMessages(select.get(key)?.messages);
      rows.push({ role, content: String(content ?? "") });
      write.run(JSON.stringify(rows.slice(-MAX_MESSAGES)), key);
    },
  };
}
