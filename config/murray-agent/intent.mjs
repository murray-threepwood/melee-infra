import { extractHttpsGitUrl } from "./workspace.mjs";

export const CLONE_INTENT = /cloná|clonar|\bclona\b|\bclone\b/i;
export const MUTATE_INTENT =
  /modific|cambi|edita|agregá|agrega|cre[áa]r?|escrib[íi]|añad|sumá |refactor|implement|mejorá|mejora|arregla|teste|corré |corre los test|npm test|pytest|hacer que|pegale|\bfix\b/i;

export const STACK_TALK =
  /\b(n8n|postgres|cloudflared|openhands|compose|webhook|gmail|stack|contenedor|murray-agent)\b/i;

export const DELETE_INTENT =
  /borr[áa]|elimin[áa]|vaciar (el )?workspace|limpi[áa] (el )?workspace|\brm\b|delete (el )?(repo|workspace)/i;

export const PUSH_INTENT =
  /(?:^|\n)\s*(?:git )?push\b|pushe[áa]|\bhac[ée](?:r)? push\b|\bsub[íi] (?:el commit|los cambios|la rama)/i;

export const PULL_INTENT =
  /\b(git )?pull\b|actualiz[áa] (el )?repo|tra[ée]te los cambios|hacé pull|hace pull/i;

export const COMMIT_INTENT = /\b(git )?commit\b|commite[áa]/i;

export const CHECKOUT_INTENT =
  /\bcheckout\b|cambi[áa] de rama|cre[áa]r? (una )?rama/i;

export const JOBS_INTENT =
  /estado de los jobs|cola de (?:los )?jobs|c[oó]mo van los jobs|qu[eé] jobs hay|list[áa](?:me)? los jobs|^\s*jobs(?:\s+\S+)?\s*$/i;

export const DIAGNOSE_INTENT =
  /en qu[eé] qued[oó]|qu[eé] pas[oó]|c[oó]mo (?:va|est[áa]|qued[oó]|viene) (?:el )?(?:job|task|poll|obrero|misi[oó]n|garfio|manco)|revis[áa](?:me)? (?:el )?(?:job|obrero|openhands|poll|garfio)|fijate .{0,160}(?:job|oh_poll|\/jobs|garfio|[a-f0-9]{16})|error:\s*\S+|task [a-f0-9]{16,32}|qu[eé] (?:hizo|est[áa] haciendo|carajo hace|anda haciendo) (?:el )?(?:obrero|openhands|garfio|manco)/i;

export function isAffirmative(text) {
  const t = String(text || "")
    .trim()
    .replace(/[,.!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 96) {
    return false;
  }
  return /^(?:sí|si|dale mand[áa].*teclado|dale(?: dale)?|ok(?:ay)?|va|de una|hecho|confirmado|aprob[áa]|dale sí|mand[áa](?:me|lo|le)?(?: el teclado)?|tir[áa](?:me)?(?: la tarjeta)?|re-?dispar[áa](?:la|lo)?(?: la tarjeta)?|el teclado|botones)$/i.test(
    t
  );
}

export function isHitlStuck(text) {
  return /no (?:me )?(?:da|aparecen|salen|mand[oó]|pint[aó]|llega(?:n)?) (?:los )?(?:botones|teclado)|sin (?:botones|teclado)|no hay (?:bot[oó]n|teclado|hitl)|me tranc|c[oó]mo (?:apruebo|hago para aprobar|disparo (?:el )?hitl)|no dispara(?:n)? (?:los )?jobs|d[oó]nde est[áa] (?:el )?(?:aprobar|teclado)|ayud[áa]me con (?:el )?(?:teclado|hitl|aprobar)|qu[eé] (?:hago|pas[oó]) (?:con )?(?:el )?(?:teclado|aprobar|hitl)/i.test(
    String(text || "")
  );
}

export function extractJobRefs(text) {
  const raw = String(text || "");
  const labeled16 = raw.match(/(?:job|jobs|\/jobs)\s+([a-f0-9]{16})\b/i);
  const labeled32 = raw.match(
    /(?:job|jobs|task|oh_poll|conv(?:ersation)?)\s+([a-f0-9]{32})\b/i
  );
  const hex = [...raw.matchAll(/\b([a-f0-9]{16,32})\b/gi)].map((m) => m[1].toLowerCase());
  const jobId = String(labeled16?.[1] || hex.find((id) => id.length === 16) || "").toLowerCase();
  const ohId = String(labeled32?.[1] || hex.find((id) => id.length === 32) || "").toLowerCase();
  return { jobId, ohId, ref: jobId || ohId };
}

export function isTriageIntent(text) {
  let t = String(text || "").trim();
  t = t.replace(/^\/+/, "");
  t = t.replace(/^murray[,:\s]+/i, "").trim();
  t = t.replace(/[?.!¿¡]+$/g, "").trim();
  t = t.replace(/^[¿¡]+/g, "").trim();
  if (!t || t.length > 140) {
    return false;
  }
  return /^(?:triage(?: garfio)?|en qu[eé] and[aá]s(?: murray)?|qu[eé] (?:pasa|pas[oó]|hace|anda haciendo|est[áa] haciendo)(?: con)?(?: (?:el )?(?:obrero|openhands|sandbox|la misi[oó]n|garfio|el manco|meathook|murray))?|c[oó]mo (?:est[áa]|anda|va|viene)(?: (?:el )?(?:obrero|garfio|el manco|meathook|murray))?|diagnostic[áa](?:me|lo)?(?: (?:el )?(?:obrero|garfio))?|fijate (?:en )?(?:garfio|el manco)|qu[eé] carajo hace (?:garfio|el manco)|revis[áa](?:me)? (?:a )?(?:garfio|el manco)|status garfio|garfio status)$/i.test(
    t
  );
}

export function isGarfioLogIntent(text) {
  let t = String(text || "").trim();
  t = t.replace(/^\/+/, "");
  t = t.replace(/[?.!¿¡]+$/g, "").trim();
  t = t.replace(/^[¿¡]+/g, "").trim();
  return /^(?:bit[aá]cora|historial|decisiones|racional|lecciones)(?: de)? garfio(?:\s+(\S+))?$/i.test(t) ||
         /^(?:qu[eé] decidi[oó]|qu[eé] descart[oó]|qu[eé] lecciones dej[oó]) garfio(?:\s+(\S+))?$/i.test(t);
}

export function isManualIntent(text) {
  let t = String(text || "").trim();
  t = t.replace(/^\/+/, "");
  t = t.replace(/^murray[,:\s]+/i, "").trim();
  t = t.replace(/[?.!¿¡]+$/g, "").trim();
  t = t.replace(/^[¿¡]+/g, "").trim();
  if (!t || t.length > 140) {
    return false;
  }
  return /^(?:manual|help|ayuda(?: (?:con los |de )?comandos)?|(?:mostra(?:me)?|pasame|ver|cu[aá]les son) (?:los )?comandos|qu[eé] comandos ten[eé]s|qu[eé] sab[eé]s hacer|gu[ií]a(?: de comandos)?|lista(?: de)? comandos)$/i.test(
    t
  );
}

export function isGarfioBrainIntent(text) {
  let t = String(text || "").trim();
  t = t.replace(/^\/+/, "");
  t = t.replace(/^murray[,:\s]+/i, "").trim();
  t = t.replace(/[?.!¿¡]+$/g, "").trim();
  t = t.replace(/^[¿¡]+/g, "").trim();
  if (!t || t.length > 140) {
    return null;
  }
  const m = t.match(
    /^(?:cambi[aá](?:le)? (?:el )?cerebro (?:a|de) garfio|qu[eé] cerebro tiene garfio|cerebro (?:de )?garfio|pon[eé] a garfio con|trasplante (?:de )?garfio)(?:\s+(?:a |con |por )?(\S+))?$/i
  );
  if (m) {
    return { model: m[1] || "" };
  }
  return null;
}

export function extractJobId(text) {
  return extractJobRefs(text).jobId;
}

export function isResumeMission(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 140) {
    return false;
  }
  return /^(?:segu[íi](?: con(?: la misi[oó]n)?(?: L\d+)?)?|retom[áa](?:la|lo)?(?: la misi[oó]n)?|continu[áa](?:la|lo)?(?: (?:con )?la misi[oó]n)?|otra vez(?: la misi[oó]n)?|dale de nuevo|rearm[áa](?:la|lo)?(?: la misi[oó]n| el hitl| L\d+)?)[.!?]*$/i.test(
    t
  );
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

const RUNNER_LINE =
  /((?:cd\s+\S+\s*&&\s*)?(?:uv run pytest|npm test|pnpm test|yarn test|bun test|cargo test|go test|make test|pytest)[^\n]*)/i;

function lastRunnerOnLine(line) {
  const t = String(line || "").trim();
  if (!t) {
    return "";
  }
  const match = t.match(RUNNER_LINE);
  return match ? match[1].trim() : t;
}

export function extractTestCommand(text) {
  const t = String(text || "");
  const labeled = t.match(
    /(?:^|\n)\s*(?:[-*]\s*)?(?:comando(?:\s+de\s+test)?|test[_ ]command|tests?)\s*[:\-]\s*(.+)/i
  );
  if (labeled) {
    return lastRunnerOnLine(labeled[1].split(/\n/)[0]);
  }
  const runPhrase = t.match(
    /\b(?:corré|corre|ejecut[áa])\s+((?:cd\s+\S+\s*&&\s*)?.+)/i
  );
  if (runPhrase && TEST_RUNNER.test(runPhrase[1])) {
    return lastRunnerOnLine(runPhrase[1].split(/\n/)[0]);
  }
  const embedded = t.match(
    /((?:cd\s+\S+\s*&&\s*)?(?:uv run pytest|npm test|pnpm test|yarn test|bun test|cargo test|go test|make test)[^\n]*)/i
  );
  return embedded ? embedded[1].trim() : "";
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
  const refs = extractJobRefs(trimmed);
  if (JOBS_INTENT.test(trimmed)) {
    return refs.ref
      ? { action: "diagnose_job", jobId: refs.ref }
      : { action: "list_jobs", jobId: "" };
  }
  if (isHitlStuck(trimmed)) {
    return { action: "hitl_help" };
  }
  if (isManualIntent(trimmed)) {
    return { action: "manual" };
  }
  const brainMatch = isGarfioBrainIntent(trimmed);
  if (brainMatch) {
    return { action: "garfio_brain", model: brainMatch.model || "" };
  }
  if (isGarfioLogIntent(trimmed)) {
    const match =
      trimmed.match(/^(?:bit[aá]cora|historial|decisiones|racional|lecciones)(?: de)? garfio(?:\s+(\S+))?$/i) ||
      trimmed.match(/^(?:qu[eé] decidi[oó]|qu[eé] descart[oó]|qu[eé] lecciones dej[oó]) garfio(?:\s+(\S+))?$/i);
    return { action: "garfio_log", slug: match?.[1] || "" };
  }
  if (isTriageIntent(trimmed) && !refs.ref) {
    return { action: "inspect", jobId: "" };
  }
  if (
    DIAGNOSE_INTENT.test(trimmed) ||
    (refs.ref && trimmed.length <= 80 && !MUTATE_INTENT.test(trimmed))
  ) {
    return { action: "inspect", jobId: refs.ref };
  }
  if (isAffirmative(trimmed)) {
    return { action: hasSession ? "confirm_code" : "chat" };
  }
  if (isResumeMission(trimmed)) {
    return { action: hasSession ? "confirm_code" : "clarify_repo" };
  }
  if (MUTATE_INTENT.test(trimmed) && !hasSession && !url && !STACK_TALK.test(trimmed)) {
    return { action: "clarify_repo" };
  }
  if (MUTATE_INTENT.test(trimmed) && hasSession && !STACK_TALK.test(trimmed)) {
    return { action: "maybe_code_mission" };
  }
  return { action: "chat", url };
}
