import { redact } from "./redact.mjs";
import { ALLOWED_SERVICES, webhookGapWarning } from "./ops.mjs";
import { resolveChatModel } from "./llm.mjs";

export const SNAPSHOT_JOB_LIMIT = 12;
export const SNAPSHOT_LOG_TAIL = 40;
export const SNAPSHOT_LLM_CHARS = 12000;

export const INSPECT_ACTION_TYPES = Object.freeze([
  "retry_stuck",
  "heal_openhands",
  "restart",
  "recreate",
  "operator_task",
]);

export const INSPECT_BLOCKED_SERVICES = new Set(["postgres_db"]);

export const INSPECT_SYSTEM = [
  "Sos Murray diagnosticando un incidente. Contestá SOLO un JSON, sin markdown.",
  "Schema:",
  '{"summary":"string","what_happened":"string","what_did_not":"string","actions":[{"type":"retry_stuck|heal_openhands|restart|recreate|operator_task","service":"opcional","reason":"string"}],"operator_tasks":[{"title":"string","why":"permiso|arquitectura","path":"string"}]}',
  "type restart/recreate exige service del compose. Nunca postgres_db, nunca docker exec, nunca down, nunca editar .mjs, nunca push a main.",
  "Si no podés mutar el stack, usá operator_task.",
].join(" ");

function sliceRedact(value, max = 400) {
  return redact(String(value || "")).slice(0, max);
}

function summarizeJob(job) {
  const payload = job?.payload && typeof job.payload === "object" ? job.payload : {};
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    error: sliceRedact(job.error, 200),
    slug: payload.slug || "",
    conversationId: payload.conversationId || "",
    startTaskId: payload.startTaskId || "",
    createdAt: job.createdAt,
  };
}

export function stripConversationSecrets(conv) {
  if (!conv || typeof conv !== "object") {
    return conv || null;
  }
  const copy = { ...conv };
  delete copy.session_api_key;
  delete copy.sessionApiKey;
  return {
    id: copy.id || copy.conversation_id || "",
    execution_status: copy.execution_status ?? null,
    sandbox_status: copy.sandbox_status || "",
    sandbox_id: copy.sandbox_id || "",
    llm_model: copy.llm_model || "",
    title: sliceRedact(copy.title, 120),
    updated_at: copy.updated_at || "",
  };
}

function hasStuckJob(snapshot) {
  if (snapshot.resolvedJob && snapshot.resolvedJob.status === "done") {
    return false;
  }
  const rows = [
    snapshot.resolvedJob,
    ...(Array.isArray(snapshot.jobs) ? snapshot.jobs : []),
  ].filter(Boolean);
  const relevant = rows.filter((j) => j.type === "code" || j.type === "oh_poll");
  if (relevant.length && relevant[0].status === "done") {
    return false;
  }
  return relevant.some(
    (job) =>
      job.status === "stuck" || job.status === "paused" || job.status === "failed"
  );
}

function healBacked(snapshot) {
  const boxes = Array.isArray(snapshot.sandboxes) ? snapshot.sandboxes : [];
  if (boxes.length) {
    return true;
  }
  const execStatus = String(snapshot.openhands?.conversation?.execution_status || "").toLowerCase();
  const isFinished = execStatus === "finished" || execStatus === "done";
  const sand = String(snapshot.openhands?.conversation?.sandbox_status || "").toUpperCase();
  if (!isFinished && (sand === "ERROR" || sand === "MISSING")) {
    return true;
  }
  if (snapshot.resolvedJob && snapshot.resolvedJob.status === "done") {
    return false;
  }
  const rows = [
    snapshot.resolvedJob,
    ...(Array.isArray(snapshot.jobs) ? snapshot.jobs : []),
  ].filter(Boolean);
  const relevant = rows.filter((j) => j.type === "code" || j.type === "oh_poll");
  if (relevant.length && relevant[0].status === "done") {
    return false;
  }
  return rows.some((job) =>
    job.status !== "done" && /sandbox_|start_error|timeout|oom|137/i.test(String(job.error || ""))
  );
}

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    return typeof fallback === "function" ? fallback(err) : fallback;
  }
}

const SECRET_KEY_RE = /session_api_key|litellm_master_key|api[_-]?key|password|secret|token/i;

export function scrubSnapshot(value) {
  if (Array.isArray(value)) {
    return value.map(scrubSnapshot);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key)) {
        continue;
      }
      out[key] = scrubSnapshot(child);
    }
    return out;
  }
  if (typeof value === "string") {
    return redact(value).replace(/LITELLM_MASTER_KEY=\S+/gi, "LITELLM_MASTER_KEY=REDACTED");
  }
  return value;
}

export async function collectSnapshot({
  chatId,
  jobRef = "",
  jobId = "",
  jobs,
  session,
  openhands,
  workspace,
  ops,
  readDoc,
  now = Date.now(),
} = {}) {
  const chat = String(chatId || "");
  const skipId = String(jobId || "");
  const listed = (
    jobs && typeof jobs.list === "function" ? jobs.list({ chatId: chat, limit: SNAPSHOT_JOB_LIMIT }) : []
  ).filter((row) => !skipId || row.id !== skipId);
  const resolved =
    jobRef && jobs && typeof jobs.find === "function"
      ? jobs.find({ chatId: chat, ref: jobRef })
      : listed[0] || null;
  const sess =
    session && typeof session.get === "function" ? session.get(chat) : {};
  const slug = sess.slug || resolved?.payload?.slug || "";

  let conversation = null;
  let startTask = null;
  const conversationId = resolved?.payload?.conversationId || sess.conversationId || "";
  const startTaskId = resolved?.payload?.startTaskId || "";
  if (openhands && conversationId && typeof openhands.getConversation === "function") {
    conversation = stripConversationSecrets(
      await safe(() => openhands.getConversation(conversationId), null)
    );
  }
  if (openhands && startTaskId && typeof openhands.getStartTask === "function") {
    startTask = await safe(async () => {
      const task = await openhands.getStartTask(startTaskId);
      return {
        id: task?.id || startTaskId,
        status: task?.status || "",
        detail: sliceRedact(task?.detail, 200),
        app_conversation_id: task?.app_conversation_id || "",
      };
    }, null);
  }

  const sandboxes = await safe(async () => {
    if (!ops || typeof ops.listOpenHandsSandboxes !== "function") {
      return [];
    }
    const rows = await ops.listOpenHandsSandboxes();
    return (rows || []).map((row) => ({
      id: String(row.id || "").slice(0, 12),
      name: row.name || "",
      status: row.status || "",
      running: Boolean(row.running),
    }));
  }, []);

  let git = null;
  if (slug && workspace) {
    git = await safe(async () => {
      const st =
        typeof workspace.status === "function" ? await workspace.status(slug) : { files: [] };
      const ahead =
        typeof workspace.commitsAhead === "function" ? await workspace.commitsAhead(slug) : 0;
      return {
        slug,
        branch: st.branch || "",
        files: Array.isArray(st.files) ? st.files.slice(0, 12) : [],
        commitsAhead: Number(ahead) || 0,
      };
    }, { slug, branch: "", files: [], commitsAhead: 0, error: "git_unavailable" });
  }

  const composePs = await safe(async () => {
    if (!ops || typeof ops.ps !== "function") {
      return "";
    }
    const result = await ops.ps();
    return sliceRedact(result.stdout || result.stderr || "", 1500);
  }, "");

  const mem = await safe(async () => {
    if (!ops || typeof ops.memorySnapshot !== "function") {
      return null;
    }
    return ops.memorySnapshot();
  }, null);

  async function serviceLogs(service) {
    if (!ops || typeof ops.logs !== "function") {
      return "";
    }
    const result = await ops.logs(service, SNAPSHOT_LOG_TAIL);
    return sliceRedact(`${result.stdout || ""}\n${result.stderr || ""}`.trim(), 1800);
  }

  const logs = {
    openhands: await safe(() => serviceLogs("openhands"), ""),
    "murray-agent": await safe(() => serviceLogs("murray-agent"), ""),
  };

  const docs = {};
  if (typeof readDoc === "function") {
    for (const name of ["lessons", "architecture", "changelog", "context", "permissive"]) {
      docs[name] = await safe(() => sliceRedact(readDoc(name, { maxChars: 1200 }), 1200), "");
    }
  }

  return {
    collectedAt: now,
    chatId: chat,
    session: {
      slug: sess.slug || "",
      conversationId: sess.conversationId || "",
      lastMission: sliceRedact(sess.lastMission, 240),
      lastTestCommand: sliceRedact(sess.lastTestCommand, 120),
      lastJobId: sess.lastJobId || "",
      garfio_model: sess.garfio_model || sess.garfioModel || "",
      active_model: sess.active_model || "",
    },
    jobs: listed.map(summarizeJob),
    resolvedJob: resolved ? summarizeJob(resolved) : null,
    openhands: { conversation, startTask },
    sandboxes,
    git,
    composePs,
    mem,
    logs,
    docs,
  };
}

export function compactSnapshot(snapshot, { maxChars = SNAPSHOT_LLM_CHARS } = {}) {
  const text = redact(JSON.stringify(scrubSnapshot(snapshot || {})));
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

function normalizeTask(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    title: sliceRedact(src.title || src.reason || "tarea humana", 180),
    why: sliceRedact(src.why || src.reason || "permiso", 240),
    path: sliceRedact(src.path || "", 180),
  };
}

function extractJsonObject(raw) {
  const text = String(raw || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function fallbackInspectAnalysis(snapshot, { code = "llm_inspect_unparseable" } = {}) {
  const err = snapshot?.resolvedJob?.error || snapshot?.jobs?.[0]?.error || "sin error de job";
  return {
    summary: "No pude cerrar el JSON del modelo. Te dejo un corte determinista.",
    what_happened: sliceRedact(err, 300),
    what_did_not: "Análisis LLM inválido o ausente.",
    actions: [],
    operator_tasks: [
      {
        title: "Revisar dump de inspect",
        why: code,
        path: "operator-inbox/",
      },
    ],
    unparseable: true,
  };
}

export function parseInspectAnalysis(raw, snapshot) {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return fallbackInspectAnalysis(snapshot);
  }
  const actionsIn = Array.isArray(parsed.actions) ? parsed.actions : [];
  const actions = actionsIn.map((row) => {
    const type = String(row?.type || "").trim();
    if (!INSPECT_ACTION_TYPES.includes(type)) {
      return {
        type: "operator_task",
        reason: `accion_rechazada:${type || "vacia"}`,
        service: "",
      };
    }
    return {
      type,
      reason: sliceRedact(row.reason, 240),
      service: String(row.service || "").trim(),
    };
  });
  const operator_tasks = Array.isArray(parsed.operator_tasks)
    ? parsed.operator_tasks.map(normalizeTask)
    : [];
  return {
    summary: sliceRedact(parsed.summary || "Inspect listo.", 500),
    what_happened: sliceRedact(parsed.what_happened, 800),
    what_did_not: sliceRedact(parsed.what_did_not, 800),
    actions,
    operator_tasks,
    unparseable: false,
  };
}

export function planInspectActions(analysis, snapshot) {
  const run = [];
  const tasks = [];
  const skipped = [];
  const seen = new Set();
  const incoming = [
    ...(Array.isArray(analysis?.actions) ? analysis.actions : []),
  ];
  for (const action of incoming) {
    const type = String(action.type || "");
    if (type === "operator_task") {
      tasks.push(normalizeTask(action));
      continue;
    }
    if (type === "retry_stuck") {
      if (seen.has("retry_stuck")) {
        skipped.push({ type, reason: "one_retry" });
        continue;
      }
      if (!hasStuckJob(snapshot)) {
        tasks.push({
          title: "Retry pedido sin job stuck/failed/paused",
          why: "sin_finding",
          path: "",
        });
        continue;
      }
      seen.add("retry_stuck");
      run.push({ type, reason: action.reason || "" });
      continue;
    }
    if (type === "heal_openhands") {
      if (seen.has("heal_openhands")) {
        skipped.push({ type, reason: "one_heal" });
        continue;
      }
      if (!healBacked(snapshot)) {
        tasks.push({
          title: "Heal pedido sin sandbox ni error de sandbox",
          why: "sin_finding",
          path: "",
        });
        continue;
      }
      seen.add("heal_openhands");
      run.push({ type, reason: action.reason || "" });
      continue;
    }
    if (type === "restart" || type === "recreate") {
      const service = String(action.service || "").trim();
      if (INSPECT_BLOCKED_SERVICES.has(service) || service === "postgres_db") {
        tasks.push({
          title: `No auto-${type} ${service || "postgres"}`,
          why: "permiso: dato de n8n en postgres",
          path: "docker-compose.yml",
        });
        continue;
      }
      if (!ALLOWED_SERVICES.includes(service)) {
        tasks.push({
          title: `Servicio fuera de allowlist: ${service || "(vacío)"}`,
          why: "ops_service_denied",
          path: "config/murray-agent/ops.mjs",
        });
        continue;
      }
      if (seen.has("service_ops")) {
        skipped.push({ type, service, reason: "one_service" });
        continue;
      }
      seen.add("service_ops");
      run.push({ type, service, reason: action.reason || "" });
      continue;
    }
    tasks.push({
      title: `Accion desconocida: ${type}`,
      why: "schema",
      path: "",
    });
  }
  for (const task of analysis?.operator_tasks || []) {
    tasks.push(normalizeTask(task));
  }
  const order = { heal_openhands: 0, restart: 1, recreate: 1, retry_stuck: 2 };
  run.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
  return { run, tasks, skipped };
}

export async function analyzeInspectSnapshot(snapshot, { llm, model } = {}) {
  if (!llm || typeof llm.complete !== "function") {
    return fallbackInspectAnalysis(snapshot, { code: "llm_unconfigured" });
  }
  const chosen = resolveChatModel(model) || model || undefined;
  let content = "";
  try {
    const result = await llm.complete({
      messages: [
        { role: "system", content: INSPECT_SYSTEM },
        { role: "user", content: compactSnapshot(snapshot) },
      ],
      tools: [],
      temperature: 0.1,
      model: chosen,
    });
    content = result?.content || "";
  } catch {
    return fallbackInspectAnalysis(snapshot, { code: "llm_inspect_failed" });
  }
  return parseInspectAnalysis(content, snapshot);
}

export async function executeInspectPlan(plan, { ops, retryStuck } = {}) {
  const results = [];
  for (const action of plan.run || []) {
    if (action.type === "heal_openhands") {
      if (!ops || typeof ops.healOpenHands !== "function") {
        results.push({ type: action.type, ok: false, error: "heal_unconfigured" });
        continue;
      }
      const out = await ops.healOpenHands();
      results.push({ type: action.type, ok: true, removed: out.removed || [] });
      continue;
    }
    if (action.type === "restart" || action.type === "recreate") {
      const fn = action.type === "recreate" ? ops?.recreate : ops?.restart;
      if (typeof fn !== "function") {
        results.push({ type: action.type, ok: false, error: "ops_unconfigured", service: action.service });
        continue;
      }
      const out = await fn(action.service);
      results.push({
        type: action.type,
        service: action.service,
        ok: (out?.code ?? 0) === 0,
        code: out?.code,
      });
      continue;
    }
    if (action.type === "retry_stuck") {
      if (typeof retryStuck !== "function") {
        results.push({ type: action.type, ok: false, error: "retry_unconfigured" });
        continue;
      }
      const out = await retryStuck();
      results.push({ type: action.type, ok: true, job_id: out?.job_id || out?.id || "" });
    }
  }
  return results;
}

export function formatInspectReply({ analysis, plan, results, inboxPath }) {
  const ran = (results || []).map((row) => {
    if (row.type === "retry_stuck") {
      return `retry job ${row.job_id || "ok"}`;
    }
    if (row.service) {
      return `${row.type} ${row.service} ${row.ok ? "ok" : "fail"}`;
    }
    return `${row.type} ${row.ok ? "ok" : row.error || "fail"}`;
  });
  const tasks = (plan.tasks || []).map((task) => `• ${task.title} (${task.why})`);
  const gaps = [...new Set((results || []).map((row) => webhookGapWarning(row.service || "")).filter(Boolean))];
  return [
    `🔍 ${analysis.summary}`,
    analysis.what_happened ? `<b>Qué pasó:</b> ${analysis.what_happened}` : "",
    analysis.what_did_not ? `<b>Qué no:</b> ${analysis.what_did_not}` : "",
    ran.length ? `<b>Auto-fix:</b> ${ran.join("; ")}` : "<b>Auto-fix:</b> nada en allowlist.",
    tasks.length ? `<b>Tareas humanas:</b>\n${tasks.join("\n")}` : "",
    gaps.join("\n"),
    inboxPath ? `Notas en <code>${inboxPath}</code> (Cursor, no las commiteo yo).` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function runInspectJob(job, {
  jobs,
  session,
  openhands,
  workspace,
  ops,
  readDoc,
  llm,
  operatorInbox,
  now = () => Date.now(),
  notifyJob,
  retryStuck,
} = {}) {
  const snapshot = await collectSnapshot({
    chatId: job.chatId,
    jobRef: job.payload?.jobRef || "",
    jobId: job.id,
    jobs,
    session,
    openhands,
    workspace,
    ops,
    readDoc,
    now: now(),
  });
  const sess = session && typeof session.get === "function" ? session.get(job.chatId) : {};
  const analysis = await analyzeInspectSnapshot(snapshot, {
    llm,
    model: sess.active_model,
  });
  const plan = planInspectActions(analysis, snapshot);
  const results = await executeInspectPlan(plan, {
    ops,
    retryStuck: typeof retryStuck === "function" ? () => retryStuck(snapshot) : undefined,
  });
  let inboxPath = "";
  if (operatorInbox && typeof operatorInbox.append === "function" && (plan.tasks.length || analysis.unparseable)) {
    const note = operatorInbox.append({
      chatId: job.chatId,
      jobId: job.id,
      title: analysis.summary || "Inspect",
      why: analysis.unparseable ? "llm_inspect_unparseable" : "operator_task",
      path: plan.tasks[0]?.path || "",
      body: [
        analysis.what_happened,
        analysis.what_did_not,
        JSON.stringify({ tasks: plan.tasks, run: plan.run, results }, null, 2),
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    inboxPath = `operator-inbox/${note.rel}`;
  }
  const reply = formatInspectReply({ analysis, plan, results, inboxPath });
  if (jobs && typeof jobs.update === "function") {
    jobs.update(job.id, { status: "done", error: "" });
  }
  if (typeof notifyJob === "function") {
    await notifyJob(job, reply, undefined, { terminal: true });
  }
  return { snapshot, analysis, plan, results, reply, inboxPath };
}
