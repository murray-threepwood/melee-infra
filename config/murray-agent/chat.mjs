import {
  ALLOWED_SERVICES,
  assertAllowedService,
  webhookGapWarning,
} from "./ops.mjs";
import { TOOL_DEFS } from "./llm.mjs";
import { packHitl, packReply } from "./reply.mjs";
import { redact } from "./redact.mjs";

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
  readDoc,
  fetchImpl = fetch,
  personaText,
  coding = null,
  workspace = null,
  session = null,
} = {}) {
  if (!ops || !llm || !memory || !approvals) {
    throw new Error("createChatEngine requiere ops, llm, memory, approvals");
  }

  function activeSlug(chatId) {
    return session && typeof session.get === "function"
      ? session.get(chatId).slug
      : "";
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
      const packed = coding.proposeClone({ chatId: ctx.chatId, url: args.url });
      if (packed.needs_hitl) {
        return { needs_hitl: true, hitl: packed.hitl, packed };
      }
      return { payload: { error: "clone_not_proposed", reply: packed.reply } };
    }
    if (name === "propose_code_mission") {
      const packed = coding.proposeCode({
        chatId: ctx.chatId,
        instruction: args.instruction,
        testCommand: args.test_command,
        filesPlan: args.files_plan,
      });
      if (packed.needs_hitl) {
        return { needs_hitl: true, hitl: packed.hitl, packed };
      }
      return { payload: { error: "code_not_proposed", reply: packed.reply } };
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
      const out = await llm.complete({ messages, tools: TOOL_DEFS });
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
          if (result.payload?.reply && result.payload?.error === "code_not_proposed") {
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
        "Mandame texto. Fotos mudas no diagnostico. /status /health /logs n8n /repo"
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
            "No hay repo activo. cloná https://github.com/owner/repo (HITL). Cero push. No edito murray-infra."
          );
        }
        return packReply(
          `Repo activo: ${row.slug}\n${row.url || ""}\nPreguntame o pedime un cambio con comando de test.`
        );
      }
      return packReply(
        `Comando /${slash.cmd} no existe. /status /health /logs <servicio> /repo`
      );
    }
    if (coding && typeof coding.interceptChat === "function") {
      const intercepted = coding.interceptChat({ chatId, text: trimmed });
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
