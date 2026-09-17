import { extractHttpsGitUrl } from "./workspace.mjs";

export const CLONE_INTENT = /cloná|clonar|\bclona\b|\bclone\b/i;
export const MUTATE_INTENT =
  /modific|cambi|edita|agregá|agrega|refactor|implement|mejorá|mejora|arregla|teste|corré |corre los test|npm test|pytest|hacer que|pegale|\bfix\b/i;

export const STACK_TALK =
  /\b(n8n|postgres|cloudflared|openhands|compose|webhook|gmail|stack|contenedor|murray-agent)\b/i;

export function classifyUserText(text, { hasSession = false } = {}) {
  const trimmed = String(text || "").trim();
  const url = extractHttpsGitUrl(trimmed);
  if (CLONE_INTENT.test(trimmed) && !url) {
    return { action: "clarify_clone_url" };
  }
  if (url && (CLONE_INTENT.test(trimmed) || (!hasSession && MUTATE_INTENT.test(trimmed)))) {
    return { action: "propose_clone", url };
  }
  if (MUTATE_INTENT.test(trimmed) && !hasSession && !url && !STACK_TALK.test(trimmed)) {
    return { action: "clarify_repo" };
  }
  if (MUTATE_INTENT.test(trimmed) && hasSession && !STACK_TALK.test(trimmed)) {
    return { action: "maybe_code_mission" };
  }
  return { action: "chat", url };
}
