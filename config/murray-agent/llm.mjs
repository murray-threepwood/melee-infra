export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "stack_ps",
      description: "docker compose ps del stack murray-infra (solo lectura).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "stack_logs",
      description: "Últimas líneas de logs de UN servicio allowlist. No imprime secretos.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string" },
          tail: { type: "integer" },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "health_probe",
      description: "HTTP healthz de n8n, workspace-mcp, openhands o murray-agent.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string" },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gmail_unread_meta",
      description:
        "Metadatos Gmail: status, error, unread_count. NUNCA asuntos ni remitentes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_seen_emails",
      description:
        "Mails ya procesados hoy (America/Montevideo). Devuelve count + message_id + processed_at. NUNCA asuntos ni remitentes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_docs",
      description: "Lee RUNBOOK, lessons-learned o architecture_spec (recortado).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", enum: ["runbook", "lessons", "architecture"] },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_ops",
      description:
        "Pide HITL para restart o force-recreate de UN servicio. NO lo ejecuta. El CEO toca Aprobar.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["restart", "recreate"] },
          service: { type: "string" },
        },
        required: ["action", "service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_session",
      description: "Repo activo en ./workspace para este chat (slug, url). No es murray-infra.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_tree",
      description: "Lista archivos del repo activo (cap). Solo ./workspace/<slug>.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_read",
      description: "Lee un archivo de texto del repo activo. Path relativo. No binarios.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_grep",
      description: "Busca un texto en el repo activo. No shell.",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" } },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_clone",
      description:
        "Pide HITL para git clone https GitHub/GitLab shallow en ./workspace. NO clona hasta Aprobar.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_code_mission",
      description:
        "Pide HITL para que OpenHands edite/testee el repo activo. NO ejecuta. Requiere instrucción y comando de test. OpenHands no pushea; el push lo hace Murray con HITL.",
      parameters: {
        type: "object",
        properties: {
          instruction: { type: "string" },
          test_command: { type: "string" },
          files_plan: { type: "string" },
        },
        required: ["instruction", "test_command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_list",
      description: "Lista entradas de ./workspace con tamaño. Para ver qué llena el disco.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_delete",
      description:
        "Pide HITL para borrar un path relativo a ./workspace (archivo, node_modules, un slug o todo). NO borra hasta Aprobar.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_push",
      description:
        "Pide HITL para git push origin HEAD del repo activo. Prohibido main/master y force. NO pushea hasta Aprobar.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_git_status",
      description: "git status --porcelain del repo activo. Sin HITL.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_git_diff",
      description: "git diff del repo activo (cap). Sin HITL.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_git_log",
      description: "git log --oneline del repo activo. Sin HITL.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_git_pull",
      description:
        "git pull --ff-only del repo activo (unshallow si el clone era shallow). Sin HITL. Job async.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_git_checkout",
      description:
        "checkout de una rama en el repo activo. create=true hace checkout -b. Sin HITL. No crea main/master.",
      parameters: {
        type: "object",
        properties: {
          branch: { type: "string" },
          create: { type: "boolean" },
        },
        required: ["branch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_jobs",
      description:
        "Lista o diagnostica jobs async (clone/code/pull/push/delete/checkout/oh_poll). job_id acepta el id Murray (16 hex) o el UUID de OpenHands (32 hex). Solo lectura.",
      parameters: {
        type: "object",
        properties: { job_id: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "workspace_git_commit",
      description:
        "git add + commit en el repo activo. Sin HITL. Exige message. No commitea .env ni secretos. Author default Murray (noreply de murray-threepwood).",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
        },
        required: ["message"],
      },
    },
  },
];

export const DEFAULT_CHAT_MODEL = "murray-chat";
export const ALLOWED_MODELS = Object.freeze([
  "deepseek-chat",
  "deepseek-reasoner",
  "gemini-3.8-flash",
  "gemini-2.5-flash-lite",
]);

export function resolveChatModel(activeModel = "") {
  const name = String(activeModel || "").trim();
  if (!name) {
    return DEFAULT_CHAT_MODEL;
  }
  if (ALLOWED_MODELS.includes(name) || name === DEFAULT_CHAT_MODEL) {
    return name;
  }
  return null;
}

export function createLlm({
  fetchImpl = fetch,
  apiKey = process.env.LITELLM_MASTER_KEY || process.env.DEEPSEEK_API_KEY || "",
  baseUrl = process.env.LITELLM_BASE_URL || "http://litellm:4000",
  model = process.env.DEEPSEEK_MODEL || DEFAULT_CHAT_MODEL,
  timeoutMs = 45000,
} = {}) {
  async function complete({ messages, tools = TOOL_DEFS, model: requestModel } = {}) {
    if (!apiKey || /CAMBIAR_POR|REEMPLAZAR|sk-deepseek-api-key-aqui|clave_aleatoria_litellm/i.test(apiKey)) {
      const err = new Error("LITELLM_MASTER_KEY ausente o placeholder");
      err.code = "llm_unconfigured";
      err.status = 503;
      throw err;
    }
    const chosen = requestModel || model || DEFAULT_CHAT_MODEL;
    const res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: chosen,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error?.message || `llm_http_${res.status}`);
      err.code = "llm_failed";
      err.status = 502;
      throw err;
    }
    const choice = body.choices?.[0]?.message || {};
    return {
      content: choice.content || "",
      tool_calls: choice.tool_calls || [],
    };
  }

  return { complete, model };
}
