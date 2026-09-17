import { extractHttpsGitUrl } from "./workspace.mjs";

export const CLONE_INTENT = /cloná|clonar|\bclona\b|\bclone\b/i;
export const MUTATE_INTENT =
  /modific|cambi|edita|agregá|agrega|refactor|implement|mejorá|mejora|arregla|teste|corré |corre los test|npm test|pytest|hacer que|pegale|\bfix\b/i;

export const STACK_TALK =
  /\b(n8n|postgres|cloudflared|openhands|compose|webhook|gmail|stack|contenedor|murray-agent)\b/i;

export const DELETE_INTENT =
  /borr[áa]|elimin[áa]|vaciar (el )?workspace|limpi[áa] (el )?workspace|\brm\b|delete (el )?(repo|workspace)/i;

export const PUSH_INTENT = /\b(git )?push\b|pushe[áa]|sub[íi] (el commit|los cambios|la rama)/i;

export const PULL_INTENT =
  /\b(git )?pull\b|actualiz[áa] (el )?repo|tra[ée]te los cambios|hacé pull|hace pull/i;

export const COMMIT_INTENT = /\b(git )?commit\b|commite[áa]/i;

export const CHECKOUT_INTENT = /\bcheckout\b|cambi[áa] de rama|cre[áa] (una )?rama/i;

export const JOBS_INTENT =
  /estado de los jobs|cola de (?:los )?jobs|c[oó]mo van los jobs|qu[eé] jobs hay|list[áa](?:me)? los jobs|^\s*jobs(?:\s+\S+)?\s*$/i;

export function extractJobId(text) {
  const labeled = String(text || "").match(/(?:job|jobs)\s+([a-f0-9]{16})\b/i);
  return labeled ? labeled[1].toLowerCase() : "";
}

export function extractDeletePath(text) {
  const t = String(text || "").trim();
  if (
    /todo (el )?workspace|vaciar (el )?workspace|limpi[áa] (el )?workspace|\.\/workspace/i.test(t)
  ) {
    return ".";
  }
  const match = t.match(
    /(?:borr[áa]e?|elimin[áa]e?|delete|rm(?:\s+-rf)?)\s+(?:el |la |los |las )?(?:repo |directorio |carpeta |archivo )?(.*)$/i
  );
  if (!match) {
    return "";
  }
  return String(match[1] || "")
    .replace(/[?.!]+$/, "")
    .trim();
}

export function extractCommitMessage(text) {
  const quoted = String(text || "").match(/["“](.+?)["”]/);
  if (quoted) {
    return quoted[1].trim();
  }
  const match = String(text || "").match(/(?:commit(?:e[áa])?|mensaje)\s*[:\-]\s*(.+)$/i);
  return match ? match[1].trim() : "";
}

const TEST_RUNNER =
  /(?:uv run pytest|npm test|pnpm test|yarn test|bun test|cargo test|go test|make test|pytest(?:\s+(?:-|\/|\.\/)))/i;

export function extractTestCommand(text) {
  const t = String(text || "");
  const labeled = t.match(
    /(?:^|\n)\s*(?:comando(?:\s+de\s+test)?|test[_ ]command)\s*[:\-]\s*(.+)/i
  );
  if (labeled) {
    return labeled[1].trim().split(/\n/)[0].trim();
  }
  const runPhrase = t.match(
    /\b(?:corré|corre|ejecut[áa]|run)\s+((?:cd\s+\S+\s*&&\s*)?.+)/i
  );
  if (runPhrase && TEST_RUNNER.test(runPhrase[1])) {
    const cmd = runPhrase[1].trim().split(/\n/)[0].trim();
    const runner = cmd.match(
      /((?:cd\s+\S+\s*&&\s*)?(?:uv run pytest|npm test|pnpm test|yarn test|bun test|cargo test|go test|make test|pytest)[^\n]*)/i
    );
    return (runner ? runner[1] : cmd).trim();
  }
  return "";
}

export function extractBranchName(text) {
  const t = String(text || "").trim();
  const dashed = t.match(/checkout\s+-b\s+([A-Za-z0-9._/-]+)/i);
  if (dashed) {
    return { branch: dashed[1], create: true };
  }
  const named = t.match(
    /(?:rama|branch|checkout|cambi[áa](?:te)? (?:a|de rama(?: a)?))\s+([A-Za-z0-9._/-]+)/i
  );
  if (named) {
    return { branch: named[1], create: /cre[áa]|nueva|-b\b/i.test(t) };
  }
  return { branch: "", create: false };
}

export function classifyUserText(text, { hasSession = false } = {}) {
  const trimmed = String(text || "").trim();
  const url = extractHttpsGitUrl(trimmed);
  if (CLONE_INTENT.test(trimmed) && !url) {
    return { action: "clarify_clone_url" };
  }
  if (url && (CLONE_INTENT.test(trimmed) || (!hasSession && MUTATE_INTENT.test(trimmed)))) {
    return { action: "propose_clone", url };
  }
  if (DELETE_INTENT.test(trimmed)) {
    const relPath = extractDeletePath(trimmed);
    return relPath
      ? { action: "propose_delete", relPath }
      : { action: "clarify_delete_path" };
  }
  if (PUSH_INTENT.test(trimmed)) {
    return { action: "propose_push" };
  }
  if (PULL_INTENT.test(trimmed)) {
    return { action: "pull" };
  }
  if (COMMIT_INTENT.test(trimmed)) {
    return { action: "commit", message: extractCommitMessage(trimmed) };
  }
  if (CHECKOUT_INTENT.test(trimmed)) {
    const named = extractBranchName(trimmed);
    return named.branch
      ? { action: "checkout", branch: named.branch, create: named.create }
      : { action: "clarify_branch" };
  }
  if (JOBS_INTENT.test(trimmed)) {
    return { action: "list_jobs", jobId: extractJobId(trimmed) };
  }
  if (MUTATE_INTENT.test(trimmed) && !hasSession && !url && !STACK_TALK.test(trimmed)) {
    return { action: "clarify_repo" };
  }
  if (MUTATE_INTENT.test(trimmed) && hasSession && !STACK_TALK.test(trimmed)) {
    return { action: "maybe_code_mission" };
  }
  return { action: "chat", url };
}
