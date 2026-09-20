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
  micromanage_interval: 0,
  micromanageInterval: 0,
};

function rowToSession(row) {
  if (!row) {
    return { ...EMPTY };
  }
  const gm = row.garfio_model || "";
  const mi = Number(row.micromanage_interval || 0);
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
    micromanage_interval: mi,
    micromanageInterval: mi,
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
            last_job_id, awaiting_instruction, active_model, garfio_model,
            micromanage_interval
       FROM session_context WHERE chat_id = ?`
  );
  const upsert = database.prepare(
    `INSERT INTO session_context (
      chat_id, slug, url, conversation_id, last_test_command, last_mission,
      last_job_id, awaiting_instruction, active_model, garfio_model,
      micromanage_interval
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      slug = excluded.slug,
      url = excluded.url,
      conversation_id = excluded.conversation_id,
      last_test_command = excluded.last_test_command,
      last_mission = excluded.last_mission,
      last_job_id = excluded.last_job_id,
      awaiting_instruction = excluded.awaiting_instruction,
      active_model = excluded.active_model,
      garfio_model = excluded.garfio_model,
      micromanage_interval = excluded.micromanage_interval`
  );

  return {
    get(chatId) {
      return rowToSession(select.get(String(chatId)));
    },
    patch(chatId, fields) {
      const next = { ...EMPTY, ...rowToSession(select.get(String(chatId))), ...fields };
      const gm = String(fields.garfio_model !== undefined ? fields.garfio_model : (fields.garfioModel !== undefined ? fields.garfioModel : (next.garfio_model || "")));
      const mi = Number(fields.micromanage_interval !== undefined ? fields.micromanage_interval : (fields.micromanageInterval !== undefined ? fields.micromanageInterval : (next.micromanage_interval || 0)));
      next.garfio_model = gm;
      next.garfioModel = gm;
      next.micromanage_interval = mi;
      next.micromanageInterval = mi;
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
        gm,
        mi
      );
      return next;
    },
  };
}
