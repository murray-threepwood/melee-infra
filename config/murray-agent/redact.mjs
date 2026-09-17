const SECRET_RE =
  /(GOCSPX-|1\/\/|sk-|eyJ|ghp_|github_pat_|glpat-|gho_|ghu_)[A-Za-z0-9._\-\/=+]*/g;

export function redact(value) {
  return String(value ?? "").replace(SECRET_RE, "$1REDACTED");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function chunkTelegram(text, max = 3900) {
  const raw = String(text ?? "");
  if (raw.length <= max) {
    return [raw];
  }
  const chunks = [];
  let rest = raw;
  while (rest.length) {
    chunks.push(rest.slice(0, max));
    rest = rest.slice(max);
  }
  return chunks;
}
