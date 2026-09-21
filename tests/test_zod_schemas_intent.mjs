import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AgentActionSchema,
  AgentResponseSchema,
  assertValidAgentAction,
  assertValidAgentResponse,
  HitlPayloadSchema,
  isGhostKeyboard,
  validateAgentAction,
  validateAgentResponse,
} from "../config/murray-agent/schemas.mjs";
import {
  classifyUserText,
  DELETE_INTENT,
  extractDeletePath,
  isCodeContext,
  MUTATE_INTENT,
} from "../config/murray-agent/intent.mjs";

test("HitlPayloadSchema valida campos minimos requeridos de HITL", () => {
  const validPayload = {
    kind: "code",
    approval_id: "appr-1234567890abcdef",
    approve_data: "APPROVE_CODE:appr-1234567890abcdef",
    reject_data: "REJECT_CODE:appr-1234567890abcdef",
    slug: "acme/repo",
  };
  const parsed = HitlPayloadSchema.parse(validPayload);
  assert.equal(parsed.kind, "code");
  assert.equal(parsed.approval_id, "appr-1234567890abcdef");

  assert.throws(() => {
    HitlPayloadSchema.parse({ kind: "code" }); // Faltan approval_id, approve_data, reject_data
  });
});

test("AgentResponseSchema: union discriminada hace sintacticamente imposibles los Ghost Keyboards", () => {
  // Caso 1: needs_hitl: true CON payload valido -> Valido
  const validHitlResponse = {
    needs_hitl: true,
    reply: "Pido aprobar misión de código. Tocá Aprobar.",
    hitl: {
      kind: "code",
      approval_id: "appr-abcdef0123456789",
      approve_data: "APPROVE_CODE:appr-abcdef0123456789",
      reject_data: "REJECT_CODE:appr-abcdef0123456789",
    },
    parse_mode: "HTML",
  };
  const validated = validateAgentResponse(validHitlResponse);
  assert.equal(validated.success, true);

  // Caso 2: needs_hitl: true SIN hitl (Ghost Keyboard clasico) -> Falla validacion Zod
  const ghostResponse = {
    needs_hitl: true,
    reply: "Pido aprobar misión de código. Tocá Aprobar.",
    parse_mode: "HTML",
  };
  const ghostValidation = validateAgentResponse(ghostResponse);
  assert.equal(ghostValidation.success, false);
  assert.ok(
    ghostValidation.error.issues.some((i) => i.path.includes("hitl")),
    "Debe requerir campo hitl cuando needs_hitl es true"
  );

  // Caso 3: needs_hitl: false -> Valido sin hitl
  const plainResponse = {
    needs_hitl: false,
    reply: "Hola, ¿en qué te puedo ayudar?",
    parse_mode: "HTML",
  };
  const plainValidation = validateAgentResponse(plainResponse);
  assert.equal(plainValidation.success, true);

  // Caso 4: needs_hitl: false con hitl adjunto -> Invalido
  const conflictingResponse = {
    needs_hitl: false,
    reply: "Respuesta plana pero con teclado fantasma",
    hitl: {
      kind: "code",
      approval_id: "appr-1",
      approve_data: "A",
      reject_data: "R",
    },
  };
  const conflictingValidation = validateAgentResponse(conflictingResponse);
  assert.equal(conflictingValidation.success, false);
});

test("AgentActionSchema: union discriminada con needsHitl", () => {
  const validAction = {
    needsHitl: true,
    reply: "Requiere aprobacion",
    hitlPayload: {
      kind: "push",
      approval_id: "appr-push-1",
      approve_data: "APPROVE_PUSH:appr-push-1",
      reject_data: "REJECT_PUSH:appr-push-1",
    },
  };
  assert.equal(validateAgentAction(validAction).success, true);
  assert.doesNotThrow(() => assertValidAgentAction(validAction));

  const invalidAction = {
    needsHitl: true,
    reply: "Requiere aprobacion",
  };
  assert.equal(validateAgentAction(invalidAction).success, false);
  assert.throws(() => assertValidAgentAction(invalidAction));
});

test("isGhostKeyboard detecta respuestas que simulan HITL sin soporte estructurado", () => {
  assert.equal(
    isGhostKeyboard({
      reply: "Pido Aprobar clone de https://github.com/foo/bar. Tocá Aprobar. Sin eso no clono.",
      needs_hitl: false,
    }),
    true
  );

  assert.equal(
    isGhostKeyboard({
      reply: "Pido Aprobar clone de https://github.com/foo/bar. Tocá Aprobar.",
      needs_hitl: true,
      hitl: null,
    }),
    true
  );

  assert.equal(
    isGhostKeyboard({
      reply: "Pido Aprobar clone de https://github.com/foo/bar. Tocá Aprobar.",
      needs_hitl: true,
      hitl: { approval_id: "123" },
    }),
    false
  );

  assert.equal(
    isGhostKeyboard({
      reply: "El estado de los jobs está limpio.",
      needs_hitl: false,
    }),
    false
  );
});

test("intent.mjs: regexes ancladas impiden el secuestro de intencion por code reviews", () => {
  const codeReviewSnippet = `Devolvé el clip al coseno: comentaste que el clamping borraba micro-gaps.
Eliminá _rag_context_similarity e import inline en chat.py.
Asegurate de que pytest tests/test_math.py dé verde posta.`;

  // 1. Debe detectar que es contexto de codigo
  assert.equal(isCodeContext(codeReviewSnippet), true);

  // 2. NO debe disparar DELETE_INTENT
  assert.equal(DELETE_INTENT.test(codeReviewSnippet), false);

  // 3. NO debe extraer un path de borrado de disco
  assert.equal(extractDeletePath(codeReviewSnippet), "");

  // 4. Si hay sesion activa, clasifica como mision de codigo
  const withSession = classifyUserText(codeReviewSnippet, { hasSession: true });
  assert.equal(withSession.action, "maybe_code_mission");

  // 5. Si no hay sesion activa, aclara repo para trabajar y NO borrado
  const withoutSession = classifyUserText(codeReviewSnippet, { hasSession: false });
  assert.equal(withoutSession.action, "clarify_repo");
  assert.notEqual(withoutSession.action, "clarify_delete_path");
  assert.notEqual(withoutSession.action, "propose_delete");
});

test("intent.mjs: borrado explicito de workspace sigue funcionando perfectamente", () => {
  assert.equal(DELETE_INTENT.test("borrá octocat-Hello-World"), true);
  assert.equal(extractDeletePath("borrá octocat-Hello-World"), "octocat-Hello-World");
  assert.equal(classifyUserText("borrá octocat-Hello-World").action, "propose_delete");

  assert.equal(DELETE_INTENT.test("borrá todo el workspace"), true);
  assert.equal(extractDeletePath("borrá todo el workspace"), ".");
  assert.equal(classifyUserText("borrá todo el workspace").action, "propose_delete");

  assert.equal(DELETE_INTENT.test("vaciar workspace"), true);
  assert.equal(extractDeletePath("vaciar workspace"), ".");

  assert.equal(DELETE_INTENT.test("borrá"), true);
  assert.equal(extractDeletePath("borrá"), "");
  assert.equal(classifyUserText("borrá").action, "clarify_delete_path");
});
