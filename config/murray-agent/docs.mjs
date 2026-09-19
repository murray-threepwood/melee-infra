import fs from "node:fs";
import { redact } from "./redact.mjs";

export const DOC_FILES = {
  runbook: process.env.MURRAY_RUNBOOK_PATH || "/opt/docs/RUNBOOK.md",
  lessons:
    process.env.MURRAY_LESSONS_PATH || "/opt/docs/lessons-learned.md",
  architecture:
    process.env.MURRAY_SPEC_PATH || "/opt/docs/architecture_spec.md",
  changelog: process.env.MURRAY_CHANGELOG_PATH || "/opt/docs/CHANGELOG.md",
  context: process.env.MURRAY_CONTEXT_PATH || "/opt/docs/CONTEXT.md",
  permissive: process.env.MURRAY_PERMISSIVE_PATH || "/opt/docs/permissive.md",
};

export function readDoc(name, { maxChars = 8000 } = {}) {
  const key = String(name || "").toLowerCase();
  const filePath = DOC_FILES[key];
  if (!filePath) {
    const err = new Error(`doc no permitido: ${name}`);
    err.code = "doc_denied";
    throw err;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return redact(raw.slice(0, maxChars));
}
