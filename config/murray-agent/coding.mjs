import { parseHitlBypass, shouldBypassHitl } from "./hitl-policy.mjs";
import {
  classifyUserText,
  extractTestCommand,
  isAffirmative,
  isHitlStuck,
  isResumeMission,
  parseMicromanageInterval,
} from "./intent.mjs";
import { formatJobDetail, formatJobsSummary, jobsHint } from "./jobs.mjs";
import {
  detectStuck,
  extractGarfioLiveActivity,
  extractGarfioRationale,
  formatMalManagerReport,
  isAgentDone,
  isSandboxPaused,
  missionHasDeliverable,
  summarizeEvents,
} from "./openhands.mjs";
import { packHitl, packHitlHelp, packReply } from "./reply.mjs";
import { runInspectJob } from "./inspect.mjs";
import { stuckKeyboard } from "./telegram.mjs";
import { parseHttpsGitUrl } from "./workspace.mjs";
import { formatGarfioLog } from "./garfio-store.mjs";
import { formatManual, handleGarfioBrain } from "./chat.mjs";

export function parseWorkspaceCallback(data) {
  const raw = String(data || "").trim();
  const stuck = raw.match(/^STUCK_(RETRY|STOP|LOGS|CHG):([a-f0-9]{16})$/i);
  if (stuck) {
    return { family: "stuck", verb: stuck[1].toUpperCase(), id: stuck[2].toLowerCase() };
  }
  const hitl = raw.match(/^(APPROVE|REJECT)_(CLONE|CODE|DELETE|PUSH):([a-f0-9]{16})$/i);
  if (hitl) {
    return {
      family: hitl[2].toLowerCase(),
      verb: hitl[1].toUpperCase(),
      id: hitl[3].toLowerCase(),
    };
  }
  return null;
}

export function formatBytes(n) {
  const value = Number(n) || 0;
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function denied(message = "approval_id inválido, usado o vencido") {
  const err = new Error(message);
  err.code = "ops_approval_denied";
  err.status = 403;
  return err;
}

function missionText({ slug, instruction, testCommand }) {
  return [
    "Misión Garfio (Obrero Mecánico Senior - OpenHands HITL CEO).",
    `Repo ya clonado. En el sandbox está en /workspace/project/${slug} (a veces /workspace/project si el mount YA es el slug). El host es ./workspace/${slug}.`,
    "Listá, cd al directorio que tenga roadmap/ y .git, y laburá SOLO ahí.",
    "No clones de nuevo. No hagas git push. No toques murray-infra ni archivos fuera de ese directorio.",
    `Instrucción: ${instruction}`,
    `Tests a correr: ${testCommand}`,
    "Al terminar: estructurá tu respuesta obligatoriamente con ### Resumen de Cambios, ### Racional Técnico y Decisiones, ### Humo y Antipatrones Descartados, y ### Estado de Tests. Si el mismo comando falla 3 veces, parate.",
  ].join("\n");
}

export function createCodingSession({
  workspace,
  session,
  jobs,
  worker,
  approvals,
  openhands,
  telegram,
  ops,
  garfioStore,
  llm,
  readDoc,
  operatorInbox,
  hitlBypass = parseHitlBypass(process.env.MURRAY_HITL_BYPASS),
  now = () => Date.now(),
  pollDelayMs = 4000,
  missionMaxMs = 12 * 60 * 1000,
  pollFailsMax = 3,
} = {}) {
  function issueHitl(kind, payload) {
    const approvalId = approvals.issue({ kind, ...payload });
    const token = String(kind).toUpperCase();
    return {
      kind,
      approval_id: approvalId,
      approve_data: `APPROVE_${token}:${approvalId}`,
      reject_data: `REJECT_${token}:${approvalId}`,
      ...payload,
    };
  }

  function proposeClone({ chatId, url }) {
    let parsed;
    try {
      parsed = parseHttpsGitUrl(url);
    } catch (err) {
      return packReply(
        `Esa URL no pasa el cerrojo: ${err.message}. Solo https://github.com o https://gitlab.com, sin token en la URL.`
      );
    }
    const item = {
      chatId: String(chatId || ""),
      url: parsed.href,
      slug: parsed.slug,
      host: parsed.host,
    };
    if (shouldBypassHitl("clone", hitlBypass)) {
      return startCloneJob(item);
    }
    const hitl = issueHitl("clone", item);
    return packHitl(
      `Pido Aprobar clone de ${parsed.href} → ./workspace/${parsed.slug} (shallow, un uso).\nPrivados: el token vive en .env, no en el chat.\nTocá Aprobar. Sin eso no clono.`,
      hitl
    );
  }

  async function proposeCode({ chatId, instruction, testCommand, filesPlan }) {
    const sess = session.get(chatId);
    if (!sess.slug) {
      return packReply(
        "No hay repo activo. Mandame primero: cloná https://github.com/owner/repo"
      );
    }
    const instructionText = String(instruction || "").trim();
    const tests = String(testCommand || "").trim();
    if (!instructionText || instructionText.length < 8) {
      return packReply(
        "Antes de mandar al obrero, decime QUÉ cambiar y con qué comando de test (npm test, pytest, go test, etc.)."
      );
    }
    if (!tests) {
      return packReply(
        `Repo activo: ${sess.slug}. ¿Con qué comando verifico el cambio? (npm test / pytest / cargo test). Sin eso no disparo OpenHands.`
      );
    }
    const item = {
      chatId: String(chatId || ""),
      slug: sess.slug,
      url: sess.url,
      instruction: instructionText.slice(0, 2000),
      testCommand: tests.slice(0, 400),
      filesPlan: String(filesPlan || "").slice(0, 800),
    };
    session.patch(chatId, {
      lastMission: instructionText.slice(0, 2000),
      lastTestCommand: tests.slice(0, 400),
    });
    if (shouldBypassHitl("code", hitlBypass)) {
      return startCodeJob(item);
    }
    const hitl = issueHitl("code", item);
    return packHitl(
      [
        `Plan (no toqué nada todavía):`,
        `- repo: ${sess.slug}`,
        `- archivos: ${filesPlan || "(los decide el obrero bajo el plan)"}`,
        `- test: ${tests}`,
        `- riesgo: mutación en ./workspace. Push lo hago yo después, con HITL, nunca a main.`,
        `Tocá Aprobar código. Rechazar no llama a OpenHands.`,
      ].join("\n"),
      hitl
    );
  }

  function describeWorkspace() {
    const listed = workspace.list();
    if (!listed.entries.length) {
      return packReply("./workspace está vacío. El disco respira. /workspace para listar.");
    }
    const lines = listed.entries.map((row) => {
      const kind = row.is_dir ? "dir" : "file";
      return `- ${row.name} (${kind}, ${formatBytes(row.bytes)})`;
    });
    return packReply(`./workspace ${formatBytes(listed.bytes)}:\n${lines.join("\n")}`);
  }

  function proposeDelete({ chatId, relPath }) {
    let target;
    try {
      target = workspace.parseTarget(relPath, session.get(chatId).slug);
    } catch (err) {
      return packReply(`Ese path no pasa el cerrojo: ${err.message}`);
    }
    const listed = workspace.list();
    const label = target.wipe
      ? `TODO ./workspace (${listed.entries.length} entradas, ${formatBytes(listed.bytes)})`
      : `./workspace/${target.rel || "."}`;
    const hitl = issueHitl("delete", {
      chatId: String(chatId || ""),
      rel: target.rel,
      wipe: Boolean(target.wipe),
    });
    return packHitl(
      `Pido Aprobar BORRAR ${label}. Irreversible. El jail es ./workspace, jamás murray-infra.\nTocá Aprobar. Sin eso no toco disco.`,
      hitl
    );
  }

  async function proposePush({ chatId }) {
    const sess = session.get(chatId);
    if (!sess.slug) {
      return packReply(
        "No hay repo activo. Cloná uno primero (cloná https://github.com/owner/repo)."
      );
    }
    try {
      const st = await workspace.status(sess.slug);
      if (st.protected) {
        return packReply(
          `Estás en ${st.branch}. Push a main/master está vedado. Decime el nombre de la rama (feat/...) y hago checkout -b.`
        );
      }
      const hitl = issueHitl("push", {
        chatId: String(chatId || ""),
        slug: sess.slug,
        branch: st.branch,
        url: sess.url,
      });
      return packHitl(
        `Pido Aprobar PUSH de ${sess.slug} rama ${st.branch} → origin HEAD (sin force, unshallow si hace falta).\nTocá Aprobar. Rechazar no pushea.`,
        hitl
      );
    } catch (err) {
      return packReply(`No pude leer git status (${err.code || "git_failed"}): ${err.message}`);
    }
  }

  function enqueueJob(type, chatId, payload, message) {
    const job = jobs.enqueue({ type, chatId, payload });
    session.patch(chatId, { lastJobId: job.id });
    if (worker && typeof worker.kick === "function") {
      void worker.kick(job.id);
    }
    return packReply(`${message.replaceAll("{id}", job.id)}\n${jobsHint(job.id)}`, {
      needs_job: true,
      job_id: job.id,
    });
  }

  function startPull({ chatId, slug }) {
    const sess = session.get(chatId);
    const repo = slug || sess.slug;
    if (!repo) {
      return packReply("No hay repo activo. Cloná uno primero.");
    }
    return enqueueJob(
      "pull",
      chatId,
      { slug: repo },
      `Haciendo pull de ${repo} (unshallow si el clone era shallow). Job {id}. Te aviso.`
    );
  }

  function startCheckout({ chatId, branch, create = false }) {
    const sess = session.get(chatId);
    if (!sess.slug) {
      return packReply("No hay repo activo. Cloná uno primero.");
    }
    const name = String(branch || "").trim();
    if (!name) {
      return packReply("¿A qué rama? Ej: checkout -b feat/limpieza");
    }
    return enqueueJob(
      "checkout",
      chatId,
      { slug: sess.slug, branch: name, create: Boolean(create) },
      `Checkout ${create ? "-b " : ""}${name} en ${sess.slug}. Job {id}. Te aviso.`
    );
  }

  async function recoverCodeHitl({ chatId, text, lastAssistant = "" }) {
    const sess = session.get(chatId) || {};
    if (!sess.slug) {
      return null;
    }
    const tests =
      extractTestCommand(text) ||
      extractTestCommand(lastAssistant) ||
      sess.lastTestCommand ||
      "";
    if (!tests) {
      return null;
    }
    const userIsShort = isAffirmative(text) || isHitlStuck(text) || isResumeMission(text);
    const instruction = (
      userIsShort
        ? sess.lastMission || lastAssistant || text
        : extractTestCommand(text)
          ? text
          : sess.lastMission || lastAssistant || text
    ).trim();
    if (!instruction || instruction.length < 8) {
      return null;
    }
    const packed = await proposeCode({
      chatId,
      instruction,
      testCommand: tests,
      filesPlan: "pendiente del obrero",
    });
    return packed.needs_hitl || packed.needs_job ? packed : null;
  }

  async function interceptChat({ chatId, text, lastAssistant = "" }) {
    const sess = session.get(chatId) || {};
    if (sess.awaiting_instruction) {
      session.patch(chatId, { awaiting_instruction: false });
      return await proposeCode({
        chatId,
        instruction: text,
        testCommand: sess.lastTestCommand || "",
        filesPlan: "pendiente del obrero",
      });
    }
    const verdict = classifyUserText(text, { hasSession: Boolean(sess.slug) });
    if (verdict.action === "manual") {
      return packReply(formatManual());
    }
    if (verdict.action === "garfio_brain") {
      return handleGarfioBrain({ session, chatId, model: verdict.model });
    }
    if (verdict.action === "clarify_clone_url") {
      return packReply(
        "¿Clonar qué? Pasame la URL https de GitHub o GitLab (sin token). Ejemplo: cloná https://github.com/owner/repo"
      );
    }
    if (verdict.action === "clarify_repo") {
      return packReply(
        "No hay repo activo en ./workspace. Cloná uno primero (cloná https://github.com/owner/repo) y después pedime el cambio."
      );
    }
    if (verdict.action === "propose_clone") {
      return proposeClone({ chatId, url: verdict.url });
    }
    if (verdict.action === "clarify_delete_path") {
      return packReply(
        "¿Qué borro bajo ./workspace? Un slug, un path (node_modules), o «todo el workspace»."
      );
    }
    if (verdict.action === "propose_delete") {
      return proposeDelete({ chatId, relPath: verdict.relPath });
    }
    if (verdict.action === "propose_push") {
      return proposePush({ chatId });
    }
    if (verdict.action === "pull") {
      return startPull({ chatId });
    }
    if (verdict.action === "commit") {
      if (!sess.slug) {
        return packReply("No hay repo activo. Cloná uno primero.");
      }
      if (!verdict.message) {
        return packReply('¿Mensaje de commit? Ej: commiteá "feat: healthcheck".');
      }
      try {
        const result = await workspace.commit(sess.slug, { message: verdict.message });
        const skipped = result.skipped_secrets?.length
          ? `\nNo toqué secretos: ${result.skipped_secrets.join(", ")}`
          : "";
        return packReply(
          `Commit en ${sess.slug}: ${result.files.join(", ")}\n${result.stdout}${skipped}`
        );
      } catch (err) {
        return packReply(`Commit falló (${err.code || "git_commit_failed"}): ${err.message}`);
      }
    }
    if (verdict.action === "clarify_branch") {
      return packReply("¿A qué rama? Ej: checkout -b feat/limpieza");
    }
    if (verdict.action === "checkout") {
      return startCheckout({
        chatId,
        branch: verdict.branch,
        create: Boolean(verdict.create),
      });
    }
    if (verdict.action === "inspect" || verdict.action === "triage") {
      return startInspectJob({ chatId, jobRef: verdict.jobId || "" });
    }
    if (verdict.action === "garfio_log") {
      if (!garfioStore || typeof garfioStore.list !== "function") {
        return packReply("La bitácora de Garfio no está configurada.");
      }
      const targetSlug = verdict.slug || sess.slug || "";
      const rows = garfioStore.list({ slug: targetSlug, limit: 5 });
      return packReply(formatGarfioLog(rows));
    }
    if (verdict.action === "micromanage") {
      return setMicromanage({ chatId, intervalRaw: verdict.intervalRaw });
    }
    if (verdict.action === "garfio_peek") {
      return garfioPeek({ chatId });
    }
    if (verdict.action === "list_jobs" || verdict.action === "diagnose_job") {
      return describeJobs({
        chatId,
        jobId: verdict.jobId,
        diagnose: verdict.action === "diagnose_job",
      });
    }
    if (verdict.action === "maybe_code_mission") {
      const recovered = await recoverCodeHitl({ chatId, text, lastAssistant });
      if (recovered) {
        return recovered;
      }
      return packHitlHelp({
        slug: sess.slug,
        reason: "Pediste un cambio y no vino comando de test en el mismo mensaje.",
      });
    }
    if (verdict.action === "confirm_code") {
      const recovered = await recoverCodeHitl({ chatId, text, lastAssistant });
      if (recovered) {
        return recovered;
      }
      return packHitlHelp({
        slug: sess.slug,
        reason: "Un «si» suelto no pinta teclado. No hay plan previo con comando de test.",
      });
    }
    if (verdict.action === "hitl_help") {
      const recovered = await recoverCodeHitl({ chatId, text, lastAssistant });
      if (recovered) {
        return recovered;
      }
      return packHitlHelp({
        slug: sess.slug,
        reason:
          "El teclado solo sale con needs_hitl=true. El job de código no arranca hasta que apruebes.",
      });
    }
    return null;
  }

  async function setMicromanage({ chatId, intervalRaw }) {
    const raw = String(intervalRaw || "").trim();
    const intervalSec = parseMicromanageInterval(raw);
    if (intervalSec === null) {
      return packReply(
        [
          `💀 Intervalo de mal manager no reconocido: «${raw}».`,
          `Opciones permitidas: 30s, 1m (default), 2m, 5m, 10m, 30m, o off.`,
          `Ejemplo: /malmanager 1m o /malmanager off`,
        ].join("\n")
      );
    }

    session.patch(chatId, { micromanage_interval: intervalSec });

    let runningJob = null;
    if (jobs && typeof jobs.list === "function") {
      const active = jobs.list({ chatId, limit: 10 });
      runningJob = active.find(
        (j) => j.type === "oh_poll" && (j.status === "queued" || j.status === "running")
      );
    }

    if (intervalSec === 0) {
      if (runningJob) {
        const payload = runningJob.payload || {};
        jobs.update(runningJob.id, {
          payload: { ...payload, micromanage_interval: 0 },
        });
      }
      return packReply(
        "💀 Modo Mal Manager DESACTIVADO. Dejo de respirarle en la nuca a Garfio; te aviso únicamente cuando termine o se tranque."
      );
    }

    const labelMap = {
      30: "30 segundos",
      60: "1 minuto",
      120: "2 minutos",
      300: "5 minutos",
      600: "10 minutos",
      1800: "30 minutos",
    };
    const label = labelMap[intervalSec] || `${intervalSec}s`;

    if (runningJob) {
      const payload = runningJob.payload || {};
      jobs.update(runningJob.id, {
        payload: {
          ...payload,
          micromanage_interval: intervalSec,
          lastProgressNotifyAt: now(),
        },
      });

      let peekText = "";
      try {
        const conversationId = payload.conversationId;
        if (conversationId && openhands) {
          const conversation = await openhands.getConversation(conversationId);
          const events = await openhands.searchEvents(conversationId);
          const activity = extractGarfioLiveActivity(events);
          peekText =
            "\n\n" +
            formatMalManagerReport({
              elapsedMs: now() - (payload.startedAt || runningJob.createdAt),
              sandboxStatus: conversation?.sandbox_status || "RUNNING",
              activity,
              slug: payload.slug,
            });
        }
      } catch {}

      return packReply(
        `💀 ¡Modo Mal Manager ACTIVADO (cada ${label})! Me paro atrás de Garfio con el látigo a contarte cada movimiento.${peekText}\n\n/malmanager off para apagarlo.`
      );
    }

    return packReply(
      `💀 Modo Mal Manager configurado (cada ${label}). En cuanto Garfio arranque una misión, te iré cantando su avance con este intervalo.\n/malmanager off para apagarlo.`
    );
  }

  async function garfioPeek({ chatId }) {
    let runningJob = null;
    if (jobs && typeof jobs.list === "function") {
      const active = jobs.list({ chatId, limit: 10 });
      runningJob = active.find(
        (j) => j.type === "oh_poll" && (j.status === "queued" || j.status === "running")
      );
    }

    if (!runningJob) {
      return packReply(
        "Garfio está en el rincón tomando mate con los garfios hacia abajo. No hay ninguna misión de código en vuelo."
      );
    }

    const payload = runningJob.payload || {};
    const conversationId = payload.conversationId;
    if (!conversationId || !openhands) {
      return packReply(
        `Garfio está inicializando el sandbox para ${payload.slug || "el repo"}. Todavía no hay eventos de código registrados.`
      );
    }

    try {
      const conversation = await openhands.getConversation(conversationId);
      const events = await openhands.searchEvents(conversationId);
      const activity = extractGarfioLiveActivity(events);
      const report = formatMalManagerReport({
        elapsedMs: now() - (payload.startedAt || runningJob.createdAt),
        sandboxStatus: conversation?.sandbox_status || "RUNNING",
        activity,
        slug: payload.slug,
      });
      return packReply(report);
    } catch (err) {
      return packReply(`No pude espiar a Garfio (${err.code || err.message}).`);
    }
  }

  async function notify(chatId, text, buttons, { terminal = false } = {}) {
    if (!telegram || typeof telegram.send !== "function") {
      return;
    }
    try {
      await telegram.send({ chat_id: chatId, text, buttons, terminal });
    } catch {
      // El ACK de n8n ya salió; un fallo de progreso no tumba el job.
    }
  }

  async function notifyJob(job, text, buttons, { terminal = false } = {}) {
    if (job?.id && typeof jobs.appendLog === "function") {
      jobs.appendLog(job.id, text);
    }
    return notify(job.chatId, text, buttons, { terminal });
  }

  function lookupJob(chatId, jobId, { fallbackLast = false } = {}) {
    let id = String(jobId || "").trim().toLowerCase();
    if (id === "last" || id === "ultimo" || id === "último") {
      id = String(session.get(chatId).lastJobId || "");
    }
    if (id && typeof jobs.find === "function") {
      const found = jobs.find({ chatId, ref: id });
      if (found) {
        return found;
      }
    }
    if (id && typeof jobs.get === "function") {
      const job = jobs.get(id);
      if (job && (!chatId || !job.chatId || job.chatId === String(chatId))) {
        return job;
      }
    }
    if (fallbackLast && typeof jobs.list === "function") {
      return jobs.list({ chatId, limit: 1 })[0] || null;
    }
    return null;
  }

  async function liveOpenHandsLine(job) {
    const payload = job?.payload || {};
    const conversationId = payload.conversationId || "";
    const startTaskId = payload.startTaskId || "";
    if (conversationId && openhands && typeof openhands.getConversation === "function") {
      try {
        const conv = await openhands.getConversation(conversationId);
        return `openhands: sandbox=${conv?.sandbox_status || "?"} exec=${conv?.execution_status ?? "null"}`;
      } catch (err) {
        return `openhands: no pude leer (${err.code || err.message})`;
      }
    }
    if (startTaskId && openhands && typeof openhands.getStartTask === "function") {
      try {
        const task = await openhands.getStartTask(startTaskId);
        return `start-task: ${task?.status || "?"} conv=${task?.app_conversation_id || "n/a"}`;
      } catch (err) {
        return `start-task: no pude leer (${err.code || err.message})`;
      }
    }
    return "";
  }

  async function describeJobs({ chatId, jobId, diagnose = false } = {}) {
    if (typeof jobs.list !== "function") {
      return packReply("Jobs no están configurados.");
    }
    const id = String(jobId || "").trim();
    if (id || diagnose) {
      const job = lookupJob(chatId, id, { fallbackLast: diagnose });
      if (!job) {
        return packReply(
          id ? `No hay job ${id}. /jobs lista los últimos 20.` : "No hay jobs en la cola. /jobs."
        );
      }
      const live = await liveOpenHandsLine(job);
      const hint =
        job.status === "stuck" || job.status === "paused" || job.error === "sandbox_paused"
          ? "Si querés seguir: Reintentar en el teclado, o escribí seguí / retomá."
          : "";
      return packReply([formatJobDetail(job), live, hint].filter(Boolean).join("\n"));
    }
    return packReply(formatJobsSummary(jobs.list({ chatId, limit: 20 })));
  }

  async function startCloneJob(item) {
    const job = jobs.enqueue({
      type: "clone",
      chatId: item.chatId,
      payload: { url: item.url, slug: item.slug },
    });
    session.patch(item.chatId, { lastJobId: job.id });
    if (worker && typeof worker.kick === "function") {
      void worker.kick(job.id);
    }
    return packReply(
      `Clonando ${item.url} en ./workspace/${item.slug}. Job ${job.id}. Te aviso cuando termine; el webhook no se queda colgado.\n${jobsHint(job.id)}`,
      { needs_job: true, job_id: job.id }
    );
  }

  async function startCodeJob(item, { followUp = false } = {}) {
    const job = jobs.enqueue({
      type: "code",
      chatId: item.chatId,
      payload: {
        slug: item.slug,
        instruction: item.instruction,
        testCommand: item.testCommand,
        filesPlan: item.filesPlan || "",
        conversationId: followUp ? item.conversationId || "" : "",
        followUp,
      },
    });
    session.patch(item.chatId, {
      lastJobId: job.id,
      lastMission: item.instruction,
      lastTestCommand: item.testCommand,
    });
    if (worker && typeof worker.kick === "function") {
      void worker.kick(job.id);
    }
    return packReply(
      `Misión encolada (${job.id}) para ${item.slug}. OpenHands labura en su sandbox. Te mando progreso; si se tranca, opciones.\n${jobsHint(job.id)}`,
      { needs_job: true, job_id: job.id }
    );
  }

  function startInspectJob({ chatId, jobRef = "" } = {}) {
    return enqueueJob(
      "inspect",
      chatId,
      { jobRef: String(jobRef || "") },
      "Junto dump y le pego al modelo. Job inspect {id}."
    );
  }

  async function retryStuckFromSnapshot(chatId, snapshot) {
    const candidates = [
      snapshot?.resolvedJob,
      ...(Array.isArray(snapshot?.jobs) ? snapshot.jobs : []),
    ].filter(
      (row) =>
        row &&
        (row.type === "code" || row.type === "oh_poll") &&
        (row.status === "stuck" || row.status === "paused" || row.status === "failed")
    );
    const target = candidates[0];
    if (!target) {
      return { error: "no_stuck" };
    }
    const full = (jobs.get && jobs.get(target.id)) || {};
    const payload = full.payload || {};
    const sess = session.get(chatId);
    const isError = /error|sandbox_error|sandbox_busy|start_error/.test(String(full.error || ""));
    const conversationId = payload.conversationId || "";
    const followUp = Boolean(conversationId) && !isError;
    return startCodeJob(
      {
        chatId,
        slug: payload.slug || sess.slug,
        instruction: payload.instruction || sess.lastMission,
        testCommand: payload.testCommand || sess.lastTestCommand,
        filesPlan: payload.filesPlan || "",
        conversationId: followUp ? conversationId : "",
      },
      { followUp }
    );
  }

  async function handleInspectJob(job) {
    try {
      await runInspectJob(job, {
        jobs,
        session,
        openhands,
        workspace,
        ops,
        readDoc,
        llm,
        operatorInbox,
        now,
        notifyJob,
        retryStuck: (snapshot) => retryStuckFromSnapshot(job.chatId, snapshot),
      });
    } catch (err) {
      jobs.update(job.id, { status: "failed", error: err.code || err.message });
      await notifyJob(
        job,
        `Inspect falló (${err.code || "inspect_failed"}): ${String(err.message || "").slice(0, 400)}`,
        undefined,
        { terminal: true }
      );
    }
  }

  async function handleCloneJob(job) {
    const { url, slug } = job.payload || {};
    try {
      const result = await workspace.clone({ url });
      session.patch(job.chatId, {
        slug: result.slug,
        url: result.url,
        conversationId: "",
      });
      jobs.update(job.id, { status: "done", error: "" });
      const listing = workspace.tree(result.slug);
      await notifyJob(
        job,
        [
          result.reused ? `Repo ya estaba en ./workspace/${result.slug}.` : `Clon listo: ./workspace/${result.slug}`,
          `archivos (cap ${listing.files.length}${listing.truncated ? "+" : ""}). Preguntame por el código.`,
          "No soy Cursor de murray-infra. Pull/commit los hago yo; push pide Aprobar y nunca va a main.",
        ].join("\n"),
        undefined,
        { terminal: true }
      );
    } catch (err) {
      jobs.update(job.id, { status: "failed", error: err.code || err.message });
      await notifyJob(
        job,
        `Clone falló (${err.code || "git_clone_failed"}): ${String(err.message || "").slice(0, 400)}`,
        undefined,
        { terminal: true }
      );
    }
  }

  function enqueuePoll(chatId, payload) {
    const mi =
      payload.micromanage_interval !== undefined
        ? payload.micromanage_interval
        : session.get(chatId)?.micromanage_interval || 0;
    const job = jobs.enqueue({
      type: "oh_poll",
      chatId,
      payload: {
        startedAt: now(),
        failLog: "",
        micromanage_interval: mi,
        ...payload,
      },
    });
    if (worker && typeof worker.kick === "function") {
      void worker.kick(job.id);
    }
    session.patch(chatId, { lastJobId: job.id });
    return job;
  }

  async function listOhSandboxes() {
    if (!ops || typeof ops.listOpenHandsSandboxes !== "function") {
      return [];
    }
    try {
      return await ops.listOpenHandsSandboxes();
    } catch {
      return [];
    }
  }

  async function handleCodeJob(job) {
    const fresh = jobs.get(job.id) || job;
    const payload = fresh.payload || {};
    const text = missionText(payload);
    try {
      const sandboxes = await listOhSandboxes();
      const running = sandboxes.filter((row) => row.running);
      if (running.length >= 2) {
        await markStuck(job, "sandbox_busy", []);
        return;
      }
      if (payload.startTaskId && !payload.followUp) {
        jobs.update(job.id, { status: "done" });
        return;
      }
      if (payload.followUp && payload.conversationId) {
        try {
          await openhands.sendMessage(payload.conversationId, text);
          jobs.update(job.id, { status: "done" });
          enqueuePoll(job.chatId, {
            conversationId: payload.conversationId,
            startTaskId: "",
            slug: payload.slug,
            instruction: payload.instruction,
            testCommand: payload.testCommand,
          });
          await notifyJob(job, `Follow-up mandado a OpenHands (${payload.conversationId}).`);
          return;
        } catch {
          // start a new conversation
        }
      }
      const sess = session && typeof session.get === "function" ? session.get(job.chatId) : {};
      const garfioModel = sess.garfioModel || sess.garfio_model || "";
      const task = await openhands.startConversation({
        title: `garfio-${payload.slug}`.slice(0, 80),
        text,
        llmModel: garfioModel || "garfio-worker",
      });
      const startTaskId = task.id || task.start_task_id || "";
      jobs.update(job.id, {
        status: "done",
        payload: {
          ...payload,
          startTaskId,
          conversationId: task.app_conversation_id || payload.conversationId || "",
          garfioModel,
        },
      });
      enqueuePoll(job.chatId, {
        startTaskId,
        conversationId: task.app_conversation_id || "",
        slug: payload.slug,
        instruction: payload.instruction,
        testCommand: payload.testCommand,
        garfioModel,
        micromanage_interval:
          payload.micromanage_interval !== undefined
            ? payload.micromanage_interval
            : session.get(job.chatId)?.micromanage_interval || 0,
      });
      const brainLabel = garfioModel ? ` [cerebro: ${garfioModel}]` : "";
      await notifyJob(
        job,
        `🪝 Garfio arrancó la misión (task ${startTaskId || "n/a"})${brainLabel}. OpenHands arrancó. Te aviso si pausa, se tranca o termina.`
      );
    } catch (err) {
      jobs.update(job.id, { status: "failed", error: err.code || err.message });
      await notifyJob(
        job,
        `No pude disparar a Garfio (${err.code || err.message}). Revisá que OpenHands esté healthy.`,
        undefined,
        { terminal: true }
      );
    }
  }

  async function markStuck(job, reason, events) {
    const payload = job.payload || {};
    const log = summarizeEvents(events);
    const hitl = issueHitl("stuck", {
      chatId: job.chatId,
      slug: payload.slug,
      instruction: payload.instruction,
      testCommand: payload.testCommand,
      conversationId: payload.conversationId,
      reason,
      log,
    });
    jobs.update(job.id, {
      status: "stuck",
      error: reason,
      payload: { ...payload, stuckApprovalId: hitl.approval_id, log },
    });
    await notifyJob(
      job,
      reason === "sandbox_busy"
        ? `Me trancé (sandbox_busy) en ${payload.slug}. Hay sandboxes oh-agent-server vivos; no arranco otro. /triage para sanar con HITL.`
        : reason === "empty_finish"
          ? `Me trancé (empty_finish) en ${payload.slug}. OpenHands dijo finished y el árbol quedó limpio. No es misión lista. /triage.`
        : `Me trancé (${reason}) en ${payload.slug}. No sigo solo. Elegí: Reintentar / Cambiar instrucción / Parar / Ver log.`,
      stuckKeyboard(hitl.approval_id),
      { terminal: true }
    );
  }

  async function markPaused(job, events) {
    const payload = job.payload || {};
    const slug = payload.slug || "";
    let files = [];
    try {
      if (slug && workspace && typeof workspace.status === "function") {
        const st = await workspace.status(slug);
        files = Array.isArray(st.files) ? st.files : [];
      }
    } catch {
      files = [];
    }
    if (files.length) {
      const names = files.slice(0, 8).join(", ");
      jobs.update(job.id, {
        status: "paused",
        error: "sandbox_paused",
        payload: { ...payload, dirtyFiles: files },
      });
      await notifyJob(
        job,
        [
          `🪝 Garfio pausó en ${slug}. Sandbox PAUSED, no es misión lista.`,
          `Hay cambios sin commit: ${names}${files.length > 8 ? "…" : ""}.`,
          "Si el diff es el trabajo: commiteá. Si querés que siga: escribí seguí / retomá y re-armo HITL.",
        ].join("\n"),
        undefined,
        { terminal: true }
      );
      return;
    }
    await markStuck(job, "sandbox_paused", events);
  }

  async function handlePollJob(job) {
    const payload = job.payload || {};
    let conversationId = payload.conversationId || "";
    try {
      if (!conversationId && payload.startTaskId) {
        const task = await openhands.getStartTask(payload.startTaskId);
        const status = String(task?.status || "").toUpperCase();
        if (status === "ERROR") {
          await markStuck(job, "start_error", []);
          return;
        }
        if (status !== "READY" || !task.app_conversation_id) {
          jobs.update(job.id, {
            status: "queued",
            runAfter: now() + pollDelayMs,
            payload: { ...payload, pollFails: 0 },
          });
          return;
        }
        conversationId = task.app_conversation_id;
        session.patch(job.chatId, { conversationId });
        jobs.update(job.id, {
          payload: { ...payload, conversationId, pollFails: 0 },
        });
      }
      if (!conversationId) {
        jobs.update(job.id, {
          status: "queued",
          runAfter: now() + pollDelayMs,
        });
        return;
      }
      const conversation = await openhands.getConversation(conversationId);
      const events = await openhands.searchEvents(conversationId);
      const stuck = detectStuck({
        executionStatus: conversation?.execution_status,
        sandboxStatus: conversation?.sandbox_status,
        events,
        startedAt: payload.startedAt || job.createdAt,
        now: now(),
        maxMs: missionMaxMs,
      });
      if (stuck.stuck) {
        await markStuck(job, stuck.reason, events);
        return;
      }
      if (
        isSandboxPaused({
          executionStatus: conversation?.execution_status,
          sandboxStatus: conversation?.sandbox_status,
        })
      ) {
        await markPaused(job, events);
        return;
      }
      if (isAgentDone({
        executionStatus: conversation?.execution_status,
        sandboxStatus: conversation?.sandbox_status,
      })) {
        const changes = await openhands.gitChanges(conversationId);
        let files = [];
        try {
          if (payload.slug && workspace && typeof workspace.status === "function") {
            const st = await workspace.status(payload.slug);
            files = Array.isArray(st.files) ? st.files : [];
          }
        } catch {
          files = [];
        }
        let commitsAhead = 0;
        try {
          if (payload.slug && workspace && typeof workspace.commitsAhead === "function") {
            commitsAhead = await workspace.commitsAhead(payload.slug);
          }
        } catch {
          commitsAhead = 0;
        }
        if (!missionHasDeliverable({ changes, files, commitsAhead })) {
          await markStuck(job, "empty_finish", events);
          return;
        }
        const rationale = extractGarfioRationale(events);
        if (garfioStore && typeof garfioStore.save === "function") {
          try {
            garfioStore.save({
              jobId: job.id,
              slug: payload.slug,
              conversationId,
              instruction: payload.instruction,
              testCommand: payload.testCommand,
              summary: rationale.summary,
              decisions: rationale.decisions,
              antiPatternsAvoided: rationale.antiPatternsAvoided,
            });
          } catch {
            // persistence non-blocking
          }
        }
        const changeText = JSON.stringify(changes).slice(0, 800);
        const summary = summarizeEvents(events);
        jobs.update(job.id, { status: "done", error: "" });
        await notifyJob(
          job,
          [
            `🪝 <b>Garfio completó la misión en ${payload.slug}</b> (Misión lista, status ${conversation?.execution_status}).`,
            rationale.summary ? `<b>Resumen:</b> ${rationale.summary}` : summary,
            rationale.decisions ? `<b>Racional Técnico y Decisiones:</b>\n${rationale.decisions}` : "",
            rationale.antiPatternsAvoided ? `<b>Humo y Antipatrones Descartados:</b>\n${rationale.antiPatternsAvoided}` : "",
            changeText && changeText !== "{}" ? `git changes: ${changeText}` : "",
            Number(commitsAhead) > 0
              ? `<b>GitHub:</b> ${commitsAhead} commit(s) en la rama local. NO están pusheados. Pedime push (HITL, nunca main) para abrir PR.`
              : "Si está bien, pedime commit y después push (HITL, nunca main).",
          ]
            .filter(Boolean)
            .join("\n\n"),
          undefined,
          { terminal: true }
        );
        return;
      }
      const micromanageIntervalSec = Number(
        payload.micromanage_interval !== undefined
          ? payload.micromanage_interval
          : session.get(job.chatId)?.micromanage_interval || 0
      );
      let nextLastNotify = payload.lastProgressNotifyAt;
      if (micromanageIntervalSec > 0) {
        const intervalMs = micromanageIntervalSec * 1000;
        const lastNotify = Number(payload.lastProgressNotifyAt || payload.startedAt || job.createdAt || 0);
        if (now() - lastNotify >= intervalMs) {
          const activity = extractGarfioLiveActivity(events);
          const report = formatMalManagerReport({
            elapsedMs: now() - (payload.startedAt || job.createdAt),
            sandboxStatus: conversation?.sandbox_status || "RUNNING",
            activity,
            slug: payload.slug,
          });
          await notifyJob(job, report, undefined, { terminal: true });
          nextLastNotify = now();
        }
      }
      jobs.update(job.id, {
        status: "queued",
        runAfter: now() + pollDelayMs,
        payload: {
          ...payload,
          conversationId,
          pollFails: 0,
          ...(nextLastNotify !== undefined ? { lastProgressNotifyAt: nextLastNotify } : {}),
        },
      });
    } catch (err) {
      const fails = Number(payload.pollFails || 0) + 1;
      const label = String(
        err.code || err.errno || err.cause?.code || err.message || "poll_failed"
      ).slice(0, 120);
      if (fails >= pollFailsMax) {
        await markStuck(job, `poll_error:${label}`, []);
        return;
      }
      jobs.update(job.id, {
        status: "queued",
        runAfter: now() + pollDelayMs,
        error: "",
        payload: {
          ...payload,
          conversationId: conversationId || payload.conversationId,
          pollFails: fails,
          lastPollError: label,
        },
      });
    }
  }

  async function handleStuck(parsed, chatId) {
    if (parsed.verb === "LOGS") {
      const item = approvals.peek(parsed.id);
      if (!item || item.kind !== "stuck") {
        throw denied();
      }
      return packReply(item.log || "(sin log)");
    }
    const item = approvals.take(parsed.id);
    if (!item || item.kind !== "stuck") {
      throw denied();
    }
    if (parsed.verb === "STOP") {
      return packReply("Paré. Garfio no sigue. El repo queda como esté en ./workspace.");
    }
    if (parsed.verb === "CHG") {
      session.patch(chatId || item.chatId, {
        awaiting_instruction: true,
        lastTestCommand: item.testCommand,
        slug: item.slug,
        url: item.url,
        conversationId: item.conversationId,
      });
      return packReply("Mandame la instrucción nueva. Armo un plan y pido Aprobar código otra vez.");
    }
    if (parsed.verb === "RETRY") {
      const isError =
        item.reason === "error" ||
        item.reason === "sandbox_error" ||
        item.reason === "sandbox_busy";
      const followUp = Boolean(item.conversationId) && !isError;
      return startCodeJob(
        {
          chatId: chatId || item.chatId,
          slug: item.slug,
          instruction: item.instruction,
          testCommand: item.testCommand,
          filesPlan: item.filesPlan,
          conversationId: followUp ? item.conversationId : "",
        },
        { followUp }
      );
    }
    throw denied("stuck_verb_denied");
  }

  function clearSessionIfRemoved(chatId, result) {
    const sess = session.get(chatId);
    if (!sess.slug) {
      return;
    }
    if (result.wiped || result.removed.includes(sess.slug)) {
      session.patch(chatId, { slug: "", url: "", conversationId: "" });
    }
  }

  async function handleDeleteJob(job) {
    const payload = job.payload || {};
    try {
      const result = workspace.remove(payload.wipe ? "." : payload.rel || ".", {
        activeSlug: session.get(job.chatId).slug,
      });
      clearSessionIfRemoved(job.chatId, result);
      jobs.update(job.id, { status: "done", error: "" });
      const listing = workspace.list();
      await notifyJob(
        job,
        [
          result.wiped
            ? `Vacié ./workspace (${result.removed.length} entradas).`
            : `Borré ./workspace/${result.rel}.`,
          `Queda ${listing.entries.length} entradas, ${formatBytes(listing.bytes)}.`,
        ].join("\n"),
        undefined,
        { terminal: true }
      );
    } catch (err) {
      jobs.update(job.id, { status: "failed", error: err.code || err.message });
      await notifyJob(
        job,
        `Delete falló (${err.code || "workspace_delete_failed"}): ${String(err.message || "").slice(0, 400)}`,
        undefined,
        { terminal: true }
      );
    }
  }

  async function handlePullJob(job) {
    const slug = job.payload?.slug;
    try {
      const result = await workspace.pull(slug);
      jobs.update(job.id, { status: "done", error: "" });
      await notifyJob(
        job,
        [
          `Pull listo en ${slug}${result.unshallowed ? " (unshallow)" : ""}.`,
          result.stdout || "(sin stdout)",
        ].join("\n"),
        undefined,
        { terminal: true }
      );
    } catch (err) {
      jobs.update(job.id, { status: "failed", error: err.code || err.message });
      await notifyJob(
        job,
        `Pull falló (${err.code || "git_pull_failed"}): ${String(err.message || "").slice(0, 400)}`,
        undefined,
        { terminal: true }
      );
    }
  }

  async function handlePushJob(job) {
    const slug = job.payload?.slug;
    try {
      const result = await workspace.push(slug);
      jobs.update(job.id, { status: "done", error: "" });
      await notifyJob(
        job,
        [`Push listo: ${slug} ${result.branch} → origin HEAD.`, result.stdout || "(sin stdout)"].join(
          "\n"
        ),
        undefined,
        { terminal: true }
      );
    } catch (err) {
      jobs.update(job.id, { status: "failed", error: err.code || err.message });
      await notifyJob(
        job,
        `Push falló (${err.code || "git_push_failed"}): ${String(err.message || "").slice(0, 400)}`,
        undefined,
        { terminal: true }
      );
    }
  }

  async function handleCheckoutJob(job) {
    const payload = job.payload || {};
    try {
      const result = await workspace.checkout(payload.slug, {
        branch: payload.branch,
        create: Boolean(payload.create),
      });
      jobs.update(job.id, { status: "done", error: "" });
      await notifyJob(
        job,
        `Checkout ${result.created ? "creó" : "cambió a"} ${result.branch} en ${payload.slug}.`,
        undefined,
        { terminal: true }
      );
    } catch (err) {
      jobs.update(job.id, { status: "failed", error: err.code || err.message });
      await notifyJob(
        job,
        `Checkout falló (${err.code || "git_checkout_failed"}): ${String(err.message || "").slice(0, 400)}`,
        undefined,
        { terminal: true }
      );
    }
  }

  async function handleHitl({ callback_data, chat_id }) {
    const parsed = parseWorkspaceCallback(callback_data);
    if (!parsed) {
      throw denied("callback_workspace_unknown");
    }
    if (parsed.family === "stuck") {
      return handleStuck(parsed, chat_id);
    }
    const item = approvals.take(parsed.id);
    if (!item || item.kind !== parsed.family) {
      throw denied();
    }
    if (parsed.verb === "REJECT") {
      const rejected = {
        clone: "Clone RECHAZADO. No toqué ./workspace.",
        code: "Misión código RECHAZADA. OpenHands no se llamó.",
        delete: "Delete RECHAZADO. No borré nada.",
        push: "Push RECHAZADO. No toqué el remoto.",
      };
      return packReply(rejected[item.kind] || "RECHAZADO.");
    }
    if (item.kind === "clone") {
      return startCloneJob(item);
    }
    if (item.kind === "code") {
      return startCodeJob(item);
    }
    if (item.kind === "delete") {
      return enqueueJob(
        "delete",
        item.chatId || chat_id,
        { rel: item.rel, wipe: Boolean(item.wipe) },
        `Borrando ${item.wipe ? "./workspace" : `./workspace/${item.rel}`}. Job {id}. Te aviso.`
      );
    }
    if (item.kind === "push") {
      return enqueueJob(
        "push",
        item.chatId || chat_id,
        { slug: item.slug, branch: item.branch },
        `Pusheando ${item.slug} ${item.branch} → origin HEAD. Job {id}. Te aviso.`
      );
    }
    throw denied();
  }

  const handlers = {
    clone: handleCloneJob,
    code: handleCodeJob,
    oh_poll: handlePollJob,
    delete: handleDeleteJob,
    pull: handlePullJob,
    push: handlePushJob,
    checkout: handleCheckoutJob,
    inspect: handleInspectJob,
  };

  return {
    interceptChat,
    recoverCodeHitl,
    proposeClone,
    proposeCode,
    proposeDelete,
    proposePush,
    startPull,
    startCheckout,
    startInspectJob,
    describeWorkspace,
    describeJobs,
    triage: startInspectJob,
    handleHitl,
    handlers,
    parseWorkspaceCallback,
    setMicromanage,
    garfioPeek,
  };
}
