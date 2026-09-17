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
        "Pide HITL para git clone https GitHub/GitLab shallow en ./workspace. NO clona hasta Aprobar. Nunca push.",
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
        "Pide HITL para que OpenHands edite/testee el repo activo. NO ejecuta. Requiere instrucción y comando de test. Cero git push.",
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
];

export function createLlm({
  fetchImpl = fetch,
  apiKey = process.env.DEEPSEEK_API_KEY || "",
  baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
  model = process.env.DEEPSEEK_MODEL || "deepseek-chat",
  timeoutMs = 45000,
} = {}) {
  async function complete({ messages, tools = TOOL_DEFS }) {
    if (!apiKey || /CAMBIAR_POR|REEMPLAZAR|sk-deepseek-api-key-aqui/i.test(apiKey)) {
      const err = new Error("DEEPSEEK_API_KEY ausente o placeholder");
      err.code = "llm_unconfigured";
      err.status = 503;
      throw err;
    }
    const res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
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
