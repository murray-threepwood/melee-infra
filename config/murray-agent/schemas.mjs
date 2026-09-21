import { z } from "zod";
import { looksLikeHitlCopy } from "./reply.mjs";

export const HitlPayloadSchema = z
  .object({
    kind: z.string().min(1, "El campo kind es requerido"),
    approval_id: z.string().min(1, "El campo approval_id es requerido"),
    approve_data: z.string().min(1, "El campo approve_data es requerido"),
    reject_data: z.string().min(1, "El campo reject_data es requerido"),
    summary: z.string().optional(),
    diff: z.string().optional(),
    command: z.string().optional(),
    slug: z.string().optional(),
    relPath: z.string().optional(),
    branch: z.string().optional(),
    runAfter: z.number().optional(),
  })
  .passthrough();

export const HitlRequiredResponseSchema = z
  .object({
    needs_hitl: z.literal(true),
    reply: z.string().min(1, "El mensaje de respuesta no puede estar vacío"),
    replies: z.array(z.string()).optional(),
    parse_mode: z.literal("HTML").default("HTML"),
    hitl: HitlPayloadSchema,
    rawHtml: z.boolean().optional(),
  })
  .passthrough();

export const NonHitlResponseSchema = z
  .object({
    needs_hitl: z.literal(false),
    reply: z.string(),
    replies: z.array(z.string()).optional(),
    parse_mode: z.literal("HTML").default("HTML"),
    hitl: z.undefined().optional(),
    rawHtml: z.boolean().optional(),
  })
  .passthrough();

export const AgentResponseSchema = z.discriminatedUnion("needs_hitl", [
  HitlRequiredResponseSchema,
  NonHitlResponseSchema,
]);

export const HitlRequiredActionSchema = z
  .object({
    needsHitl: z.literal(true),
    reply: z.string().min(1, "El mensaje de respuesta no puede estar vacío"),
    hitlPayload: HitlPayloadSchema,
  })
  .passthrough();

export const NonHitlActionSchema = z
  .object({
    needsHitl: z.literal(false),
    reply: z.string(),
    hitlPayload: z.undefined().optional(),
  })
  .passthrough();

export const AgentActionSchema = z.discriminatedUnion("needsHitl", [
  HitlRequiredActionSchema,
  NonHitlActionSchema,
]);

export function validateAgentResponse(data) {
  return AgentResponseSchema.safeParse(data);
}

export function assertValidAgentResponse(data) {
  return AgentResponseSchema.parse(data);
}

export function validateAgentAction(data) {
  return AgentActionSchema.safeParse(data);
}

export function assertValidAgentAction(data) {
  return AgentActionSchema.parse(data);
}

export function isGhostKeyboard({ reply = "", needs_hitl = false, hitl = null } = {}) {
  const looksLikeHitl = looksLikeHitlCopy(reply);
  if (!looksLikeHitl) {
    return false;
  }
  if (!needs_hitl) {
    return true;
  }
  if (!hitl || typeof hitl !== "object" || !hitl.approval_id) {
    return true;
  }
  return false;
}
