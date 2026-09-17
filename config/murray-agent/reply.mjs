import { chunkTelegram, escapeHtml, redact } from "./redact.mjs";

export function looksLikeHitlCopy(text) {
  return /pido aprobar|toc[aá] aprobar|teclado (?:de )?hitl|botones (?:de )?hitl|necesito que apruebes|bot[oó]n aprobar|propose_code_mission|tarjeta (?:de )?(?:hitl|propose)|re-?disparo la tarjeta|re-?dispar[áa] la tarjeta/i.test(
    String(text || "")
  );
}

export function hitlHelpText({ slug = "", reason = "" } = {}) {
  const repo = slug
    ? `Repo activo: ${slug}.`
    : "Si no hay repo activo, primero: cloná https://github.com/owner/repo";
  const what = reason ? `Qué pasó: ${reason}` : "";
  return [
    "Peleás contra el teclado como un granjero de vacas. n8n no inventa botones: hace falta needs_hitl=true, no un «si» suelto ni prosa de aprobación.",
    what,
    `${repo} Para misión de código, UN mensaje con instrucción + comando. Ejemplo:`,
    "Creá backend/tests/test_foo.py. Inestabilidad = informe, no fail.",
    "Comando: cd backend && uv run pytest -q tests/test_foo.py",
    "Evitá la etiqueta Test: (escribí Comando:). Evitá la palabra push en esa burbuja. No me pidas «re-dispará la tarjeta»: eso se va a DeepSeek y llegás sin teclado.",
    "Clone, borrá, pusheá y checkout interceptan solos. Código, no. El job de OpenHands arranca al aprobar el teclado, no antes. Si te pica la impaciencia: /jobs.",
    "¿Podés sentir el aliento del mal puro? Mandame ese mensaje y te armo el teclado de verdad.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function packHitlHelp(extra = {}) {
  return packReply(hitlHelpText(extra));
}

export function packReply(text, extra = {}) {
  const reply = redact(escapeHtml(text)).slice(0, 3900);
  return {
    reply,
    replies: chunkTelegram(reply, 3900),
    parse_mode: "HTML",
    needs_hitl: false,
    ...extra,
  };
}

export function packHitl(text, hitl) {
  const kind = String(hitl.kind || "ops").toLowerCase();
  const token = kind.toUpperCase();
  const approvalId = String(hitl.approval_id || "");
  const packed = packReply(text, {
    needs_hitl: true,
    hitl: {
      ...hitl,
      kind,
      approval_id: approvalId,
      approve_data: hitl.approve_data || `APPROVE_${token}:${approvalId}`,
      reject_data: hitl.reject_data || `REJECT_${token}:${approvalId}`,
    },
  });
  packed.needs_hitl = true;
  packed.hitl = packed.hitl || hitl;
  return packed;
}
