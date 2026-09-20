import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_DB_PATH =
  process.env.MURRAY_DB_PATH || "/var/lib/murray-agent/murray.db";

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  chat_id TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  log TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  run_after INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hitl_tokens (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL DEFAULT '{}',
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_context (
  chat_id TEXT PRIMARY KEY,
  messages TEXT NOT NULL DEFAULT '[]',
  slug TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  last_test_command TEXT NOT NULL DEFAULT '',
  last_mission TEXT NOT NULL DEFAULT '',
  last_job_id TEXT NOT NULL DEFAULT '',
  awaiting_instruction INTEGER NOT NULL DEFAULT 0,
  active_model TEXT NOT NULL DEFAULT '',
  garfio_model TEXT NOT NULL DEFAULT '',
  micromanage_interval INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS seen_emails (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL DEFAULT '',
  processed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS garfio_rationales (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  instruction TEXT NOT NULL DEFAULT '',
  test_command TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  decisions TEXT NOT NULL DEFAULT '',
  anti_patterns_avoided TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_garfio_slug ON garfio_rationales(slug);

CREATE TABLE IF NOT EXISTS operator_notes (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL DEFAULT '',
  job_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operator_notes_chat ON operator_notes(chat_id);
`;

const MEMORY_CAP = 20;

function isMemoryDb(filePath) {
  return filePath === ":memory:";
}

export function resolveMurrayDbPath({ filePath, dbPath } = {}) {
  if (dbPath) {
    return dbPath;
  }
  if (filePath) {
    if (isMemoryDb(filePath)) {
      return filePath;
    }
    const base = path.basename(filePath);
    if (base.endsWith(".db") || base === "murray.db") {
      return filePath;
    }
    return path.join(path.dirname(filePath), "murray.db");
  }
  return process.env.MURRAY_DB_PATH || "/var/lib/murray-agent/murray.db";
}

function parseJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function tableCount(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
}

function jsonSource(dbFile, siblingName, envValue, explicit) {
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }
  if (!dbFile || isMemoryDb(dbFile)) {
    return "";
  }
  const sibling = path.join(path.dirname(dbFile), siblingName);
  if (fs.existsSync(sibling)) {
    return sibling;
  }
  if (!envValue || !fs.existsSync(envValue)) {
    return "";
  }
  const prodDb = process.env.MURRAY_DB_PATH || "/var/lib/murray-agent/murray.db";
  const sameDir =
    path.resolve(path.dirname(envValue)) === path.resolve(path.dirname(dbFile));
  if (path.resolve(dbFile) === path.resolve(prodDb) || sameDir) {
    return envValue;
  }
  return "";
}

function renameMigrated(filePath) {
  fs.renameSync(filePath, `${filePath}.migrated`);
}

function withTxn(db, fn) {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure after the original error
    }
    throw err;
  }
}

function migrateJobs(db, jobsPath) {
  if (!jobsPath || tableCount(db, "jobs") > 0) {
    return;
  }
  const data = parseJsonFile(jobsPath);
  if (!data) {
    return;
  }
  const insert = db.prepare(
    `INSERT INTO jobs (
      id, type, status, chat_id, payload, error, log, created_at, run_after, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  withTxn(db, () => {
    for (const job of Object.values(data)) {
      if (!job || typeof job !== "object" || !job.id) {
        continue;
      }
      insert.run(
        String(job.id),
        String(job.type || ""),
        String(job.status || "queued"),
        String(job.chatId || job.chat_id || ""),
        JSON.stringify(job.payload && typeof job.payload === "object" ? job.payload : {}),
        String(job.error || ""),
        JSON.stringify(Array.isArray(job.log) ? job.log : []),
        Number(job.createdAt || job.created_at || Date.now()),
        Number(job.runAfter || job.run_after || 0),
        Number(job.updatedAt || job.updated_at || Date.now())
      );
    }
  });
  renameMigrated(jobsPath);
}

function migrateMemory(db, memoryPath) {
  if (!memoryPath || tableCount(db, "session_context") > 0) {
    return false;
  }
  const data = parseJsonFile(memoryPath);
  if (!data) {
    return false;
  }
  const insert = db.prepare(
    `INSERT INTO session_context (chat_id, messages) VALUES (?, ?)`
  );
  withTxn(db, () => {
    for (const [chatId, rows] of Object.entries(data)) {
      const messages = Array.isArray(rows) ? rows.slice(-MEMORY_CAP) : [];
      insert.run(String(chatId), JSON.stringify(messages));
    }
  });
  renameMigrated(memoryPath);
  return true;
}

function sessionFields(row) {
  const src = row && typeof row === "object" ? row : {};
  return {
    slug: String(src.slug || ""),
    url: String(src.url || ""),
    conversationId: String(src.conversationId || src.conversation_id || ""),
    lastTestCommand: String(src.lastTestCommand || src.last_test_command || ""),
    lastMission: String(src.lastMission || src.last_mission || ""),
    lastJobId: String(src.lastJobId || src.last_job_id || ""),
    awaiting: src.awaiting_instruction ? 1 : 0,
  };
}

function migrateSession(db, sessionPath, { allowUpdate }) {
  if (!sessionPath) {
    return;
  }
  if (!allowUpdate && tableCount(db, "session_context") > 0) {
    return;
  }
  const data = parseJsonFile(sessionPath);
  if (!data) {
    return;
  }
  const getRow = db.prepare(`SELECT chat_id FROM session_context WHERE chat_id = ?`);
  const insert = db.prepare(
    `INSERT INTO session_context (
      chat_id, slug, url, conversation_id, last_test_command, last_mission,
      last_job_id, awaiting_instruction
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    `UPDATE session_context SET
      slug = ?, url = ?, conversation_id = ?, last_test_command = ?,
      last_mission = ?, last_job_id = ?, awaiting_instruction = ?
     WHERE chat_id = ?`
  );
  withTxn(db, () => {
    for (const [chatId, row] of Object.entries(data)) {
      const fields = sessionFields(row);
      const key = String(chatId);
      if (getRow.get(key)) {
        update.run(
          fields.slug,
          fields.url,
          fields.conversationId,
          fields.lastTestCommand,
          fields.lastMission,
          fields.lastJobId,
          fields.awaiting,
          key
        );
      } else {
        insert.run(
          key,
          fields.slug,
          fields.url,
          fields.conversationId,
          fields.lastTestCommand,
          fields.lastMission,
          fields.lastJobId,
          fields.awaiting
        );
      }
    }
  });
  renameMigrated(sessionPath);
}

export function migrateJsonIfNeeded(db, {
  dbFile,
  jobsPath,
  memoryPath,
  sessionPath,
} = {}) {
  const jobs = jsonSource(dbFile, "jobs.json", process.env.MURRAY_JOBS_PATH, jobsPath);
  const memory = jsonSource(
    dbFile,
    "memory.json",
    process.env.MURRAY_MEMORY_PATH,
    memoryPath
  );
  const session = jsonSource(
    dbFile,
    "session.json",
    process.env.MURRAY_SESSION_PATH,
    sessionPath
  );
  migrateJobs(db, jobs);
  const memoryMigrated = migrateMemory(db, memory);
  migrateSession(db, session, {
    allowUpdate: memoryMigrated,
  });
}

export function openMurrayDb({
  filePath,
  dbPath,
  jobsPath,
  memoryPath,
  sessionPath,
} = {}) {
  const resolved = resolveMurrayDbPath({ filePath, dbPath });
  if (!isMemoryDb(resolved)) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const db = new DatabaseSync(resolved);
  db.exec(SCHEMA_SQL);
  try {
    db.exec("ALTER TABLE session_context ADD COLUMN garfio_model TEXT NOT NULL DEFAULT '';");
  } catch {}
  try {
    db.exec("ALTER TABLE session_context ADD COLUMN micromanage_interval INTEGER NOT NULL DEFAULT 0;");
  } catch {}
  migrateJsonIfNeeded(db, {
    dbFile: resolved,
    jobsPath,
    memoryPath,
    sessionPath,
  });
  return db;
}
