import { openMurrayDb } from "./db.mjs";

const EMPTY = {
  slug: "",
  url: "",
  conversationId: "",
  lastTestCommand: "",
  lastMission: "",
  lastJobId: "",
  awaiting_instruction: false,
  active_model: "",
  garfio_model: "",
  garfioModel: "",
};

function rowToSession(row) {
  if (!row) {
    return { ...EMPTY };
  }
  const gm = row.garfio_model || "";
  return {
    slug: row.slug || "",
    url: row.url || "",
    conversationId: row.conversation_id || "",
    lastTestCommand: row.last_test_command || "",
    lastMission: row.last_mission || "",
    lastJobId: row.last_job_id || "",
    awaiting_instruction: Boolean(row.awaiting_instruction),
    active_model: row.active_model || "",
    garfio_model: gm,
    garfioModel: gm,
  };
}

export function createSessionStore({
  filePath = process.env.MURRAY_SESSION_PATH ||
    "/var/lib/murray-agent/session.json",
  dbPath,
  db,
} = {}) {
  const database =
    db ||
    openMurrayDb({
      filePath,
      dbPath,
      sessionPath: filePath && String(filePath).endsWith(".json") ? filePath : undefined,
    });

  const select = database.prepare(
    `SELECT slug, url, conversation_id, last_test_command, last_mission,
            last_job_id, awaiting_instruction, active_model, garfio_model
       FROM session_context WHERE chat_id = ?`
  );
  const upsert = database.prepare(
    `INSERT INTO session_context (
      chat_id, slug, url, conversation_id, last_test_command, last_mission,
      last_job_id, awaiting_instruction, active_model, garfio_model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      slug = excluded.slug,
      url = excluded.url,
      conversation_id = excluded.conversation_id,
      last_test_command = excluded.last_test_command,
      last_mission = excluded.last_mission,
      last_job_id = excluded.last_job_id,
      awaiting_instruction = excluded.awaiting_instruction,
      active_model = excluded.active_model,
      garfio_model = excluded.garfio_model`
  );

  return {
    get(chatId) {
      return rowToSession(select.get(String(chatId)));
    },
    patch(chatId, fields) {
      const next = { ...EMPTY, ...rowToSession(select.get(String(chatId))), ...fields };
      const gm = String(fields.garfio_model !== undefined ? fields.garfio_model : (fields.garfioModel !== undefined ? fields.garfioModel : (next.garfio_model || "")));
      next.garfio_model = gm;
      next.garfioModel = gm;
      upsert.run(
        String(chatId),
        String(next.slug || ""),
        String(next.url || ""),
        String(next.conversationId || ""),
        String(next.lastTestCommand || ""),
        String(next.lastMission || ""),
        String(next.lastJobId || ""),
        next.awaiting_instruction ? 1 : 0,
        String(next.active_model || ""),
        gm
      );
      return next;
    },
  };
}
