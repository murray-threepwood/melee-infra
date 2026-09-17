import { chunkTelegram, escapeHtml, redact } from "./redact.mjs";

export function looksLikeHitlCopy(text) {
  return /pido aprobar|toc[aá] aprobar|teclado (?:de )?hitl|botones (?:de )?hitl/i.test(
    String(text || "")
  );
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
