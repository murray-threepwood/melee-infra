import crypto from "node:crypto";
import { openMurrayDb } from "./db.mjs";
import { formatClock } from "./jobs.mjs";

export const GARFIO_TZ = process.env.MURRAY_TZ || "America/Montevideo";

export function formatGarfioLog(rows, { now = Date.now(), timeZone = GARFIO_TZ } = {}) {
  if (!rows || !rows.length) {
    return "La bitácora de Garfio está vacía. Todavía no completó ninguna misión con auditoría.";
  }
  const chunks = rows.map((r, idx) => {
    const clock = formatClock(r.created_at, { now, timeZone });
    return [
      `🪝 <b>Garfio Log #${idx + 1} — [${r.slug}]</b> (${clock})`,
      r.instruction ? `• <i>Misión:</i> ${r.instruction.slice(0, 100)}` : "",
      r.summary ? `• <i>Resumen:</i> ${r.summary}` : "",
      r.decisions ? `• <i>Decisiones clave:</i>\n${r.decisions}` : "",
      r.anti_patterns_avoided ? `• <i>Humo descartado:</i>\n${r.anti_patterns_avoided}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    `<b>Bitácora de Arquitectura de Garfio (últimos ${rows.length} registros):</b>`,
    "",
    chunks.join("\n\n---\n\n"),
  ].join("\n");
}

export function createGarfioStore({ filePath, dbPath, db } = {}) {
  const database = db || openMurrayDb({ filePath, dbPath });

  const insertStmt = database.prepare(
    `INSERT INTO garfio_rationales (
      id, job_id, slug, conversation_id, instruction, test_command, summary, decisions, anti_patterns_avoided, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const listBySlugStmt = database.prepare(
    `SELECT * FROM garfio_rationales WHERE slug = ? ORDER BY created_at DESC LIMIT ?`
  );

  const listAllStmt = database.prepare(
    `SELECT * FROM garfio_rationales ORDER BY created_at DESC LIMIT ?`
  );

  const getStmt = database.prepare(
    `SELECT * FROM garfio_rationales WHERE id = ? LIMIT 1`
  );

  return {
    save({
      jobId = "",
      slug = "",
      conversationId = "",
      instruction = "",
      testCommand = "",
      summary = "",
      decisions = "",
      antiPatternsAvoided = "",
      createdAt = Date.now(),
    }) {
      const id = crypto.randomBytes(8).toString("hex");
      insertStmt.run(
        id,
        String(jobId || ""),
        String(slug || ""),
        String(conversationId || ""),
        String(instruction || ""),
        String(testCommand || ""),
        String(summary || ""),
        String(decisions || ""),
        String(antiPatternsAvoided || ""),
        Number(createdAt) || Date.now()
      );
      return id;
    },

    list({ slug = "", limit = 5 } = {}) {
      const cap = Math.max(1, Math.min(Number(limit) || 5, 20));
      if (slug) {
        return listBySlugStmt.all(String(slug), cap);
      }
      return listAllStmt.all(cap);
    },

    get(id) {
      return getStmt.get(String(id || "")) || null;
    },
  };
}
