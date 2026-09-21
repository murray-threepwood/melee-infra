import {
  ALLOWED_SERVICES,
  assertAllowedService,
  webhookGapWarning,
} from "./ops.mjs";
import { ALLOWED_MODELS, DEFAULT_CHAT_MODEL, resolveChatModel, TOOL_DEFS } from "./llm.mjs";
import { looksLikeHitlCopy, packHitl, packHitlHelp, packReply } from "./reply.mjs";
import { redact } from "./redact.mjs";
import { formatSeenToday, isSeenEmailsIntent } from "./seen-emails.mjs";
import { formatGarfioLog } from "./garfio-store.mjs";

const HEALTH_URLS = {
  n8n: process.env.N8N_HEALTH_URL || "http://n8n:5678/healthz",
  "workspace-mcp":
    process.env.GMAIL_MCP_URL || "http://workspace-mcp:8000/healthz",
  openhands: process.env.OPENHANDS_HEALTH_URL || "http://openhands:3000/health",
  "murray-agent":
    process.env.MURRAY_SELF_HEALTH_URL || "http://127.0.0.1:8080/healthz",
};

export function parseSlash(text) {
  const t = String(text || "").trim();
  if (!t.startsWith("/")) {
    return null;
  }
  const [cmd, ...rest] = t.slice(1).split(/\s+/);
  const name = (cmd || "").toLowerCase();
  if (name === "status") {
    return { cmd: "status" };
  }
  if (name === "health") {
    return { cmd: "health" };
  }
  if (name === "logs") {
    return { cmd: "logs", service: rest[0] || "" };
  }
  if (name === "repo") {
    return { cmd: "repo" };
  }
  if (name === "workspace") {
    return { cmd: "workspace" };
  }
  if (name === "jobs") {
    return { cmd: "jobs", jobId: rest[0] || "" };
  }
  if (name === "triage") {
    return { cmd: "triage" };
  }
  if (name === "model") {
    return { cmd: "model", model: rest.join(" ").trim() };
  }
  if (name === "garfio") {
    const sub = (rest[0] || "").toLowerCase();
    if (sub === "model" || sub === "cerebro") {
      return { cmd: "garfio_brain", model: rest.slice(1).join(" ").trim() };
    }
    return { cmd: "garfio", slug: rest[0] || "" };
  }
  if (name === "cerebro") {
    return { cmd: "garfio_brain", model: rest.join(" ").trim() };
  }
  if (name === "manual" || name === "help") {
    return { cmd: "manual" };
  }
  if (name === "malmanager" || name === "mirar" || name === "verbose") {
    return { cmd: "micromanage", interval: rest.join(" ").trim() };
  }
  if (name === "push") {
    return { cmd: "push" };
  }
  if (name === "pull") {
    return { cmd: "pull" };
  }
  if (name === "commit") {
    return { cmd: "commit", message: rest.join(" ").trim() };
  }
  if (name === "estado" || name === "resumen") {
    return { cmd: "estado" };
  }
  if (name === "roadmap" || name === "tickets" || name === "tareas") {
    return { cmd: "roadmap" };
  }
  if (name === "diff") {
    return { cmd: "diff" };
  }
  return { cmd: name, service: rest[0] || "" };
}

async function formatPs(ops) {
  const result = await ops.ps();
  const body = result.stdout.trim() || result.stderr.trim() || `exit ${result.code}`;
  return packReply(
    `Murray acá. Compose ps (exit ${result.code}):\n${body}\nEl cluster sigue bajo mi yugo.`
  );
}

async function formatLogs(ops, service) {
  if (!service) {
    return packReply(
      `¿Logs de cuál? Servicios: ${ALLOWED_SERVICES.join(", ")}\nUso: /logs n8n`
    );
  }
  const result = await ops.logs(service, 50);
  const body = result.stdout.trim() || result.stderr.trim() || `exit ${result.code}`;
  return packReply(
    `Logs ${service} (exit ${result.code}):\n${body.slice(0, 3500)}`
  );
}

async function formatHealth(fetchImpl) {
  const lines = [];
  for (const [name, url] of Object.entries(HEALTH_URLS)) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
      lines.push(`${name}: http ${res.status}`);
    } catch (err) {
      lines.push(`${name}: FAIL ${err.cause?.code || err.message}`);
    }
  }
  return packReply(`Health interno:\n${lines.join("\n")}\n¿Podés sentir el aliento del mal puro?`);
}

export const ALLOWED_GARFIO_MODELS = [
  "garfio-worker",
  "deepseek-chat",
  "deepseek-reasoner",
  "gemini-3.8-flash",
  "gemini-2.5-flash-lite",
];

export function formatManual() {
  return [
    "📖 MANUAL OPERATIVO DE MURRAY & GARFIO",
    "",
    "1. Diagnóstico & Control del Stack",
    "• /status: Estado de los contenedores Docker.",
    "• /health: Healthchecks HTTP de los servicios internos.",
    "• /logs <servicio>: Logs de n8n, openhands, litellm, etc.",
    "• /triage (o «qué pasó» / «en qué andas murray»): inspect async (dump + modelo + auto-fix allowlist).",
    "",
    "2. Control de Cerebros (LLMs)",
    "• /model [modelo]: Ver o cambiar el motor de Murray (chat). Óptimo: deepseek-chat (más barato y exacto).",
    "• /garfio model [modelo] (o /cerebro [modelo]): Trasplante clandestino de cerebro a Garfio. Óptimo: deepseek-chat (mejor para codear).",
    `• Modelos válidos: ${ALLOWED_GARFIO_MODELS.join(", ")}.`,
    "",
    "3. Espacio de Trabajo & Git (./workspace)",
    "• /estado (o /resumen): Resumen ejecutivo, último commit de Garfio, roadmap y botón para PUSH.",
    "• /roadmap (o /tickets): Lista de tickets pendientes y completados del repo activo.",
    "• /push: Pedir aprobación HITL para subir la rama a origin y abrir PR.",
    "• /pull: Traer cambios remotos a la rama actual (ff-only).",
    "• /diff: Ver cambios pendientes en el árbol de trabajo.",
    "• /repo: Ver repositorio activo en sesión.",
    "• /workspace: Listar archivos y directorios.",
    "• /jobs [id]: Ver cola de tareas async en vuelo.",
    "• /garfio [slug]: Bitácora de auditoría y decisiones técnicas de Garfio.",
    "• Git autónomo: pull, commit, log, status, checkout.",
    "• Git con HITL: push (a rama feat, nunca main), clone, delete.",
    "",
    "4. Misiones de Código para Garfio",
    "• Formato: <instrucción> Comando: <test> (ej: npm test / pytest).",
    "• Murray emite teclado HITL. Al tocar Aprobar, Garfio pica código y audita.",
    "",
    "5. Modo Mal Manager (Micro-management de Garfio)",
    "• /malmanager [30s|1m|2m|5m|10m|30m|off]: Reporte esquemático y periódico de lo que hace Garfio.",
    "• «mirar por el hombro lo que hace garfio como mal manager» o «¿en qué anda garfio?» para espiar en vivo.",
  ].join("\n");
}

export function handleGarfioBrain({ session, chatId, model }) {
  if (!session || typeof session.get !== "function") {
    return packReply("Sesión no está configurada.");
  }
  const cleanModel = String(model || "").trim().toLowerCase();
  const current = session.get(chatId).garfio_model || "garfio-worker (default con fallback)";
  if (!cleanModel) {
    return packReply(
      [
        "Shhh... ¡bajá la voz, botija! No queremos que el monstruo escuche los relámpagos ni los generadores...",
        `Cerebro actual de Garfio: ${current}.`,
        `Lóbulos disponibles para el trasplante: ${ALLOWED_GARFIO_MODELS.join(", ")}.`,
        "Para trasplantarle otro: /garfio model <modelo> o «cambiale el cerebro a garfio por <modelo>».",
      ].join("\n\n")
    );
  }
  if (!ALLOWED_GARFIO_MODELS.includes(cleanModel)) {
    return packReply(
      `Ese lóbulo no entra en el cráneo de Garfio: ${cleanModel}.\nUsá uno compatible: ${ALLOWED_GARFIO_MODELS.join(", ")}.`
    );
  }
  session.patch(chatId, { garfio_model: cleanModel });
  return packReply(
    [
      "¡MWAHAHAHAHA... digo, shhh! ⚡🔩 ¡IT'S ALIVE!",
      `Le desconecté los electrodos oxidados y le injerté el cerebro de ${cleanModel}.`,
      "Garfio cree que se tomó un café fuerte y sigue picando código de espaldas al monitor... ¡Ni sospecha de los cables vudú que le salen de la nuca!",
    ].join("\n\n")
  );
}

function parseToolArgs(raw) {
  if (!raw) {
    return {};
  }
  if (typeof raw === "object") {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function createChatEngine({
  ops,
  llm,
  memory,
  approvals,
  gmailMeta,
  seen,
  readDoc,
  fetchImpl = fetch,
  personaText,
  coding = null,
  workspace = null,
  session = null,
  garfioStore = null,
} = {}) {
  if (!ops || !llm || !memory || !approvals) {
    throw new Error("createChatEngine requiere ops, llm, memory, approvals");
  }

  function activeSlug(chatId) {
    return session && typeof session.get === "function"
      ? session.get(chatId).slug
      : "";
  }

  function lastAssistantFor(chatId) {
    const history = memory.get(chatId) || [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].role === "assistant") {
        return String(history[i].content || "");
      }
    }
    return "";
  }

  async function recoverCodeHitl(chatId, text, lastAssistant = "") {
    if (!coding || typeof coding.recoverCodeHitl !== "function") {
      return null;
    }
    return coding.recoverCodeHitl({ chatId, text, lastAssistant });
  }

  async function dispatchTool(name, args, ctx = {}) {
    if (name === "stack_ps") {
      const result = await ops.ps();
      return {
        payload: {
          code: result.code,
          stdout: result.stdout.slice(0, 4000),
          stderr: result.stderr.slice(0, 1000),
        },
      };
    }
    if (name === "stack_logs") {
      const result = await ops.logs(args.service, args.tail);
      return {
        payload: {
          code: result.code,
          stdout: result.stdout.slice(0, 4000),
          stderr: result.stderr.slice(0, 1000),
        },
      };
    }
    if (name === "health_probe") {
      const service = String(args.service || "");
      const url = HEALTH_URLS[service];
      if (!url) {
        return {
          payload: {
            error: "health_service_denied",
            allowed: Object.keys(HEALTH_URLS),
          },
        };
      }
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
        const text = redact((await res.text()).slice(0, 500));
        return { payload: { service, http: res.status, body: text } };
      } catch (err) {
        return { payload: { service, error: err.message } };
      }
    }
    if (name === "gmail_unread_meta") {
      const meta = await gmailMeta();
      return { payload: meta };
    }
    if (name === "list_seen_emails") {
      if (!seen || typeof seen.listToday !== "function") {
        return { payload: { error: "seen_store_unconfigured" } };
      }
      const rows = seen.listToday();
      return {
        payload: {
          count: rows.length,
          emails: rows.map((row) => ({
            message_id: row.message_id,
            processed_at: row.processed_at,
          })),
        },
      };
    }
    if (name === "read_docs") {
      try {
        return { payload: { name: args.name, text: readDoc(args.name) } };
      } catch (err) {
        return { payload: { error: err.code || err.message } };
      }
    }
    if (name === "propose_ops") {
      const action = String(args.action || "");
      const service = String(args.service || "");
      if (!["restart", "recreate"].includes(action)) {
        return { payload: { error: "action_denied", action } };
      }
      try {
        assertAllowedService(service);
        const approvalId = approvals.issue({ kind: "ops", action, service });
        const warning = webhookGapWarning(service);
        const hitl = {
          kind: "ops",
          approval_id: approvalId,
          action,
          service,
          warning,
          approve_data: `APPROVE_OPS:${approvalId}`,
          reject_data: `REJECT_OPS:${approvalId}`,
        };
        return {
          needs_hitl: true,
          hitl,
          payload: hitl,
        };
      } catch (err) {
        return { payload: { error: err.code || err.message } };
      }
    }
    if (!workspace || !session || !coding) {
      return { payload: { error: "unknown_tool", name } };
    }
    const slug = activeSlug(ctx.chatId);
    if (name === "workspace_session") {
      const row = session.get(ctx.chatId);
      return {
        payload: {
          slug: row.slug || "",
          url: row.url || "",
          has_repo: Boolean(row.slug),
        },
      };
    }
    if (name === "workspace_tree") {
      if (!slug) {
        return { payload: { error: "workspace_inactive" } };
      }
      try {
        return { payload: workspace.tree(slug) };
      } catch (err) {
        return { payload: { error: err.code || err.message } };
      }
    }
    if (name === "workspace_read") {
      if (!slug) {
        return { payload: { error: "workspace_inactive" } };
      }
      try {
        return { payload: workspace.read(slug, args.path) };
      } catch (err) {
        return { payload: { error: err.code || err.message } };
      }
    }
    if (name === "workspace_grep") {
      if (!slug) {
        return { payload: { error: "workspace_inactive" } };
      }
      try {
        return { payload: workspace.grep(slug, args.pattern) };
      } catch (err) {
        return { payload: { error: err.code || err.message } };
      }
    }
    if (name === "propose_clone") {
      const packed = await coding.proposeClone({ chatId: ctx.chatId, url: args.url });
      if (packed.needs_hitl) {
        return { needs_hitl: true, hitl: packed.hitl, packed };
      }
      if (packed.needs_job) {
        return { needs_job: true, packed };
      }
      return { payload: { error: "clone_not_proposed", reply: packed.reply } };
    }
    if (name === "propose_code_mission") {
      const packed = await coding.proposeCode({
        chatId: ctx.chatId,
        instruction: args.instruction,
        testCommand: args.test_command,
        filesPlan: args.files_plan,
      });
      if (packed.needs_hitl) {
        return { needs_hitl: true, hitl: packed.hitl, packed };
      }
      if (packed.needs_job) {
        return { needs_job: true, packed };
      }
      return { payload: { error: "code_not_proposed", reply: packed.reply } };
    }
    if (name === "workspace_list") {
      try {
        return { payload: workspace.list() };
      } catch (err) {
        return { payload: { error: err.code || err.message } };
      }
    }
    if (name === "propose_delete") {
      const packed = coding.proposeDelete({
        chatId: ctx.chatId,
        relPath: args.path || args.rel || ".",
      });
      if (packed.needs_hitl) {
        return { needs_hitl: true, hitl: packed.hitl, packed };
      }
      return { payload: { error: "delete_not_proposed", reply: packed.reply } };
    }
    if (name === "propose_push") {
      const packed = await coding.proposePush({ chatId: ctx.chatId });
      if (packed.needs_hitl) {
        return { needs_hitl: true, hitl: packed.hitl, packed };
      }
      return { payload: { error: "push_not_proposed", reply: packed.reply } };
    }
    if (name === "workspace_git_status") {
      if (!slug) {
        return { payload: { error: "workspace_inactive" } };
      }
      try {
        return { payload: await workspace.status(slug) };
      } catch (err) {
        return { payload: { error: err.code || err.message } };
      }
    }
    if (name === "workspace_git_diff") {
      if (!slug) {
        return { payload: { error: "workspace_inactive" } };
      }
      try {
        return { payload: await workspace.diff(slug) };
      } catch (err) {
        return { payload: { error: err.code || err.message } };
      }
    }
    if (name === "workspace_git_log") {
      if (!slug) {
        return { payload: { error: "workspace_inactive" } };
      }
      try {
        return { payload: await workspace.log(slug) };
      } catch (err) {
        return { payload: { error: err.code || err.message } };
      }
    }
    if (name === "workspace_git_pull") {
      const packed = coding.startPull({ chatId: ctx.chatId });
      if (packed.needs_job) {
        return { needs_job: true, packed };
      }
      return { payload: { error: "pull_not_started", reply: packed.reply } };
    }
    if (name === "workspace_git_checkout") {
      const packed = coding.startCheckout({
        chatId: ctx.chatId,
        branch: args.branch,
        create: Boolean(args.create),
      });
      if (packed.needs_job) {
        return { needs_job: true, packed };
      }
      return { payload: { error: "checkout_not_started", reply: packed.reply } };
    }
    if (name === "workspace_git_commit") {
      if (!slug) {
        return { payload: { error: "workspace_inactive" } };
      }
      try {
        return {
          payload: await workspace.commit(slug, {
            message: args.message,
            paths: args.paths || [],
          }),
        };
      } catch (err) {
        return { payload: { error: err.code || err.message, message: err.message } };
      }
    }
    if (name === "list_jobs") {
      if (!coding || typeof coding.describeJobs !== "function") {
        return { payload: { error: "jobs_unconfigured" } };
      }
      const packed = await coding.describeJobs({
        chatId: ctx.chatId,
        jobId: args.job_id || args.id || "",
      });
      return { packed, direct: true, payload: { reply: packed.reply } };
    }
    return { payload: { error: "unknown_tool", name } };
  }

  async function runLlm(chatId, text) {
    const history = memory.get(chatId);
    const messages = [
      { role: "system", content: personaText },
      ...history,
      { role: "user", content: text },
    ];
    for (let round = 0; round < 4; round += 1) {
      const activeModel =
        session && typeof session.get === "function"
          ? session.get(chatId).active_model
          : "";
      const out = await llm.complete({
        messages,
        tools: TOOL_DEFS,
        model: resolveChatModel(activeModel) || DEFAULT_CHAT_MODEL,
      });
      if (out.tool_calls && out.tool_calls.length) {
        messages.push({
          role: "assistant",
          content: out.content || "",
          tool_calls: out.tool_calls,
        });
        for (const call of out.tool_calls) {
          const args = parseToolArgs(call.function?.arguments);
          const result = await dispatchTool(call.function?.name, args, { chatId });
          if (result.needs_hitl) {
            const packed =
              result.packed ||
              packHitl(
                (out.content ||
                  `Pido Aprobar: ${result.hitl.action} de ${result.hitl.service}.`) +
                  (result.hitl.warning ? `\n${result.hitl.warning}` : "") +
                  "\nTocá Aprobar. Sin eso no toco el contenedor.",
                result.hitl
              );
            memory.append(chatId, "user", text);
            memory.append(chatId, "assistant", packed.reply);
            return packed;
          }
          if (result.needs_job && result.packed) {
            memory.append(chatId, "user", text);
            memory.append(chatId, "assistant", result.packed.reply);
            return result.packed;
          }
          if (result.direct && result.packed) {
            memory.append(chatId, "user", text);
            memory.append(chatId, "assistant", result.packed.reply);
            return result.packed;
          }
          if (
            result.payload?.reply &&
            /_not_proposed$|_not_started$/.test(String(result.payload.error || ""))
          ) {
            const packed = packReply(result.payload.reply);
            memory.append(chatId, "user", text);
            memory.append(chatId, "assistant", packed.reply);
            return packed;
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result.payload),
          });
        }
        continue;
      }
      if (looksLikeHitlCopy(out.content)) {
        const recovered = await recoverCodeHitl(chatId, text, out.content);
        if (recovered) {
          memory.append(chatId, "user", text);
          memory.append(chatId, "assistant", recovered.reply);
          return recovered;
        }
        const refused = packHitlHelp({
          slug: activeSlug(chatId),
          reason:
            "DeepSeek escribió prosa de aprobación sin tool. n8n no pinta teclado con texto plano.",
        });
        memory.append(chatId, "user", text);
        memory.append(chatId, "assistant", refused.reply);
        return refused;
      }
      const packed = packReply(
        out.content || "No tengo nada útil. Peleás como un granjero de vacas."
      );
      memory.append(chatId, "user", text);
      memory.append(chatId, "assistant", packed.reply);
      return packed;
    }
    return packReply(
      "Se me acabó el loop de herramientas. Pedime algo más acotado."
    );
  }

  async function handleChat({ chat_id, text }) {
    const chatId = String(chat_id || "anon");
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      return packReply(
        "Mandame texto. Fotos mudas no diagnostico. /status /health /logs n8n /repo /workspace /jobs /triage"
      );
    }
    const slash = parseSlash(trimmed);
    if (slash) {
      if (slash.cmd === "status") {
        return formatPs(ops);
      }
      if (slash.cmd === "health") {
        return formatHealth(fetchImpl);
      }
      if (slash.cmd === "logs") {
        return formatLogs(ops, slash.service);
      }
      if (slash.cmd === "repo") {
        const row =
          session && typeof session.get === "function"
            ? session.get(chatId)
            : { slug: "" };
        if (!row.slug) {
          return packReply(
            "No hay repo activo. cloná https://github.com/owner/repo (HITL). Push a main vedado. No edito murray-infra."
          );
        }
        return packReply(
          `Repo activo: ${row.slug}\n${row.url || ""}\n/workspace lista el disco. /jobs espiá la cola. Pull/commit sin HITL; push y borrar piden Aprobar.`
        );
      }
      if (slash.cmd === "workspace") {
        if (!coding || typeof coding.describeWorkspace !== "function") {
          return packReply("./workspace no está configurado.");
        }
        return coding.describeWorkspace();
      }
      if (slash.cmd === "jobs") {
        if (!coding || typeof coding.describeJobs !== "function") {
          return packReply("Jobs no están configurados.");
        }
        return coding.describeJobs({ chatId, jobId: slash.jobId });
      }
      if (slash.cmd === "triage") {
        if (!coding || typeof coding.triage !== "function") {
          return packReply("Triage no está configurado.");
        }
        return coding.triage({ chatId });
      }
      if (slash.cmd === "model") {
        if (!session || typeof session.get !== "function") {
          return packReply("Sesión no está configurada.");
        }
        if (!slash.model) {
          const current = session.get(chatId).active_model || DEFAULT_CHAT_MODEL;
          return packReply(
            `Modelo activo: ${current}\nPermitidos: ${ALLOWED_MODELS.join(", ")}`
          );
        }
        if (!ALLOWED_MODELS.includes(slash.model)) {
          return packReply(
            `Modelo inválido: ${slash.model}. Usá: ${ALLOWED_MODELS.join(", ")}`
          );
        }
        session.patch(chatId, { active_model: slash.model });
        return packReply(`Modelo de este chat: ${slash.model}`);
      }
      if (slash.cmd === "garfio") {
        if (!garfioStore || typeof garfioStore.list !== "function") {
          return packReply("La bitácora de Garfio no está configurada.");
        }
        const rows = garfioStore.list({ slug: slash.slug, limit: 5 });
        return packReply(formatGarfioLog(rows));
      }
      if (slash.cmd === "manual") {
        return packReply(formatManual());
      }
      if (slash.cmd === "garfio_brain") {
        return handleGarfioBrain({ session, chatId, model: slash.model });
      }
      if (slash.cmd === "micromanage") {
        if (!coding || typeof coding.setMicromanage !== "function") {
          return packReply("Modo mal manager no disponible.");
        }
        return coding.setMicromanage({ chatId, intervalRaw: slash.interval });
      }
      if (slash.cmd === "push") {
        if (!coding || typeof coding.proposePush !== "function") {
          return packReply("Push no está disponible.");
        }
        return coding.proposePush({ chatId });
      }
      if (slash.cmd === "pull") {
        if (!coding || typeof coding.startPull !== "function") {
          return packReply("Pull no está disponible.");
        }
        return coding.startPull({ chatId });
      }
      if (slash.cmd === "estado") {
        if (!coding || typeof coding.describeRepoStatus !== "function") {
          return packReply("Estado no disponible.");
        }
        return coding.describeRepoStatus({ chatId });
      }
      if (slash.cmd === "roadmap") {
        if (!coding || typeof coding.describeRoadmap !== "function") {
          return packReply("Roadmap no disponible.");
        }
        return coding.describeRoadmap({ chatId });
      }
      if (slash.cmd === "commit") {
        const sess = session ? session.get(chatId) : { slug: "" };
        if (!sess.slug) {
          return packReply("No hay repo activo. Cloná uno primero.");
        }
        if (!slash.message) {
          return packReply('¿Mensaje de commit? Ej: /commit "feat: nueva feature"');
        }
        try {
          const result = await workspace.commit(sess.slug, { message: slash.message });
          const skipped = result.skipped_secrets?.length
            ? `\nNo toqué secretos: ${result.skipped_secrets.join(", ")}`
            : "";
          return packReply(`Commit en ${sess.slug}: ${result.files.join(", ")}\n${result.stdout}${skipped}`);
        } catch (err) {
          return packReply(`Commit falló (${err.code || "git_commit_failed"}): ${err.message}`);
        }
      }
      if (slash.cmd === "diff") {
        const sess = session ? session.get(chatId) : { slug: "" };
        if (!sess.slug) {
          return packReply("No hay repo activo.");
        }
        try {
          const d = await workspace.diff(sess.slug);
          return packReply(d.text ? `Diff en ${sess.slug}:\n<pre>${d.text.slice(0, 3500)}</pre>` : "Árbol limpio, sin diff.");
        } catch (err) {
          return packReply(`No pude leer diff: ${err.message}`);
        }
      }
      return packReply(
        `Comando /${slash.cmd} no existe. /manual /estado /roadmap /push /status /health /logs /repo /workspace /jobs /triage /garfio /model /malmanager`
      );
    }
    if (isSeenEmailsIntent(trimmed)) {
      if (!seen || typeof seen.listToday !== "function") {
        return packReply("Memoria de mails no está configurada.");
      }
      return packReply(formatSeenToday(seen.listToday()));
    }
    if (coding && typeof coding.interceptChat === "function") {
      const intercepted = await coding.interceptChat({
        chatId,
        text: trimmed,
        lastAssistant: lastAssistantFor(chatId),
      });
      if (intercepted) {
        memory.append(chatId, "user", trimmed);
        memory.append(chatId, "assistant", intercepted.reply);
        return intercepted;
      }
    }
    return runLlm(chatId, trimmed);
  }

  async function executeOps({ approval_id }) {
    const preview = approvals.peek(approval_id);
    if (preview && preview.kind && preview.kind !== "ops") {
      const err = new Error("approval_id no es ops");
      err.code = "ops_approval_denied";
      err.status = 403;
      throw err;
    }
    const item = approvals.take(approval_id);
    if (!item || (item.kind && item.kind !== "ops")) {
      const err = new Error("approval_id inválido, usado o vencido");
      err.code = "ops_approval_denied";
      err.status = 403;
      throw err;
    }
    if (item.action === "heal_openhands") {
      if (!ops || typeof ops.healOpenHands !== "function") {
        const err = new Error("heal_openhands_unconfigured");
        err.code = "heal_openhands_unconfigured";
        err.status = 503;
        throw err;
      }
      const result = await ops.healOpenHands();
      const names = (result.removed || []).join(", ") || "(ninguno)";
      const excerpt = (result.restart?.stdout || result.restart?.stderr || "").trim().slice(0, 800);
      return packReply(
        `Ops heal_openhands exit=${result.restart?.code ?? "?"}\nPurgados: ${names}\nrestart openhands: ${excerpt || "ok"}`
      );
    }
    const fn = item.action === "recreate" ? ops.recreate : ops.restart;
    const result = await fn(item.service);
    const excerpt = (result.stdout || result.stderr || "").trim().slice(0, 1200);
    return packReply(
      `Ops ${item.action} ${item.service} exit=${result.code}\n${excerpt || "(sin stdout)"}`
    );
  }

  async function rejectOps({ approval_id }) {
    const preview = approvals.peek(approval_id);
    if (preview && preview.kind && preview.kind !== "ops") {
      const err = new Error("approval_id no es ops");
      err.code = "ops_approval_denied";
      err.status = 403;
      throw err;
    }
    const item = approvals.take(approval_id);
    if (!item) {
      const err = new Error("approval_id inválido, usado o vencido");
      err.code = "ops_approval_denied";
      err.status = 403;
      throw err;
    }
    return packReply(
      `Ops ${item.action} ${item.service} RECHAZADA. El contenedor no se tocó.`
    );
  }

  async function handleWorkspaceHitl({ callback_data, chat_id }) {
    if (!coding || typeof coding.handleHitl !== "function") {
      const err = new Error("coding_session_unconfigured");
      err.code = "coding_session_unconfigured";
      err.status = 503;
      throw err;
    }
    return coding.handleHitl({ callback_data, chat_id });
  }

  return { handleChat, executeOps, rejectOps, handleWorkspaceHitl, dispatchTool };
}
