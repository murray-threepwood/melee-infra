import fs from "node:fs";
import { redact } from "./redact.mjs";

export const DOC_FILES = {
  runbook: process.env.MURRAY_RUNBOOK_PATH || "/opt/docs/RUNBOOK.md",
  lessons:
    process.env.MURRAY_LESSONS_PATH || "/opt/docs/lessons-learned.md",
  architecture:
    process.env.MURRAY_SPEC_PATH || "/opt/docs/architecture_spec.md",
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
