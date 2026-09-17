import { classifyUserText } from "./intent.mjs";
import { detectStuck, isAgentDone, summarizeEvents } from "./openhands.mjs";
import { packHitl, packReply } from "./reply.mjs";
import { stuckKeyboard } from "./telegram.mjs";
import { extractHttpsGitUrl, parseHttpsGitUrl } from "./workspace.mjs";

export function parseWorkspaceCallback(data) {
  const raw = String(data || "").trim();
  const stuck = raw.match(/^STUCK_(RETRY|STOP|LOGS|CHG):([a-f0-9]{16})$/i);
  if (stuck) {
    return { family: "stuck", verb: stuck[1].toUpperCase(), id: stuck[2].toLowerCase() };
  }
  const hitl = raw.match(/^(APPROVE|REJECT)_(CLONE|CODE):([a-f0-9]{16})$/i);
  if (hitl) {
    return {
      family: hitl[2].toLowerCase(),
      verb: hitl[1].toUpperCase(),
      id: hitl[3].toLowerCase(),
    };
  }
  return null;
}

function denied(message = "approval_id inválido, usado o vencido") {
  const err = new Error(message);
  err.code = "ops_approval_denied";
  err.status = 403;
  return err;
}

function missionText({ slug, instruction, testCommand }) {
  return [
    "Misión Murray (HITL CEO).",
    `Repo ya clonado en el mount OpenHands /opt/workspace_base/${slug} (host ./workspace/${slug}).`,
    "No clones de nuevo. No hagas git push. No toques murray-infra ni archivos fuera de ese directorio.",
    `Instrucción: ${instruction}`,
    `Tests a correr: ${testCommand}`,
    "Al terminar: listá archivos tocados y el resultado de los tests. Si el mismo comando falla 3 veces, parate.",
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
  now = () => Date.now(),
  pollDelayMs = 4000,
  missionMaxMs = 12 * 60 * 1000,
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
    const hitl = issueHitl("clone", {
      chatId: String(chatId || ""),
      url: parsed.href,
      slug: parsed.slug,
      host: parsed.host,
    });
    return packHitl(
      `Pido Aprobar clone de ${parsed.href} → ./workspace/${parsed.slug} (shallow, un uso).\nPrivados: el token vive en .env, no en el chat.\nTocá Aprobar. Sin eso no clono.`,
      hitl
    );
  }

  function proposeCode({ chatId, instruction, testCommand, filesPlan }) {
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
    const hitl = issueHitl("code", {
      chatId: String(chatId || ""),
      slug: sess.slug,
      url: sess.url,
      instruction: instructionText.slice(0, 2000),
      testCommand: tests.slice(0, 400),
      filesPlan: String(filesPlan || "").slice(0, 800),
    });
    return packHitl(
      [
        `Plan (no toqué nada todavía):`,
        `- repo: ${sess.slug}`,
        `- archivos: ${filesPlan || "(los decide el obrero bajo el plan)"}`,
        `- test: ${tests}`,
        `- riesgo: mutación en ./workspace, cero git push.`,
        `Tocá Aprobar código. Rechazar no llama a OpenHands.`,
      ].join("\n"),
      hitl
    );
  }

  function interceptChat({ chatId, text }) {
    const sess = session.get(chatId) || {};
    if (sess.awaiting_instruction) {
      session.patch(chatId, { awaiting_instruction: false });
      return proposeCode({
        chatId,
        instruction: text,
        testCommand: sess.lastTestCommand || "",
        filesPlan: "pendiente del obrero",
      });
    }
    const verdict = classifyUserText(text, { hasSession: Boolean(sess.slug) });
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
    return null;
  }

  async function notify(chatId, text, buttons) {
    if (!telegram || typeof telegram.send !== "function") {
      return;
    }
    try {
      await telegram.send({ chat_id: chatId, text, buttons });
    } catch {
      // El ACK de n8n ya salió; un fallo de progreso no tumba el job.
    }
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
      `Clonando ${item.url} en ./workspace/${item.slug}. Job ${job.id}. Te aviso cuando termine; el webhook no se queda colgado.`,
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
      `Misión encolada (${job.id}) para ${item.slug}. OpenHands labura en su sandbox. Te mando progreso; si se tranca, opciones.`,
      { needs_job: true, job_id: job.id }
    );
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
      await notify(
        job.chatId,
        [
          result.reused ? `Repo ya estaba en ./workspace/${result.slug}.` : `Clon listo: ./workspace/${result.slug}`,
          `archivos (cap ${listing.files.length}${listing.truncated ? "+" : ""}). Preguntame por el código.`,
          "No soy Cursor de murray-infra. Cero git push.",
        ].join("\n")
      );
    } catch (err) {
      jobs.update(job.id, { status: "failed", error: err.code || err.message });
      await notify(
        job.chatId,
        `Clone falló (${err.code || "git_clone_failed"}): ${String(err.message || "").slice(0, 400)}`
      );
    }
  }

  function enqueuePoll(chatId, payload) {
    const job = jobs.enqueue({
      type: "oh_poll",
      chatId,
      payload: {
        startedAt: now(),
        failLog: "",
        ...payload,
      },
    });
    if (worker && typeof worker.kick === "function") {
      void worker.kick(job.id);
    }
    return job;
  }

  async function handleCodeJob(job) {
    const payload = job.payload || {};
    const text = missionText(payload);
    try {
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
          await notify(job.chatId, `Follow-up mandado a OpenHands (${payload.conversationId}).`);
          return;
        } catch {
          // start a new conversation
        }
      }
      const task = await openhands.startConversation({
        title: `murray-${payload.slug}`.slice(0, 80),
        text,
      });
      const startTaskId = task.id || task.start_task_id || "";
      jobs.update(job.id, { status: "done" });
      enqueuePoll(job.chatId, {
        startTaskId,
        conversationId: task.app_conversation_id || "",
        slug: payload.slug,
        instruction: payload.instruction,
        testCommand: payload.testCommand,
      });
      await notify(
        job.chatId,
        `OpenHands arrancó (task ${startTaskId || "n/a"}). Te aviso al terminar o si se tranca.`
      );
    } catch (err) {
      jobs.update(job.id, { status: "failed", error: err.code || err.message });
      await notify(
        job.chatId,
        `No pude disparar OpenHands (${err.code || err.message}). Revisá que el servicio esté healthy.`
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
    await notify(
      job.chatId,
      `Me trancé (${reason}) en ${payload.slug}. No sigo solo. Elegí: Reintentar / Cambiar instrucción / Parar / Ver log.`,
      stuckKeyboard(hitl.approval_id)
    );
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
          });
          return;
        }
        conversationId = task.app_conversation_id;
        session.patch(job.chatId, { conversationId });
        jobs.update(job.id, {
          payload: { ...payload, conversationId },
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
      if (isAgentDone({
        executionStatus: conversation?.execution_status,
        sandboxStatus: conversation?.sandbox_status,
      })) {
        const changes = await openhands.gitChanges(conversationId);
        const changeText = JSON.stringify(changes).slice(0, 800);
        const summary = summarizeEvents(events);
        jobs.update(job.id, { status: "done", error: "" });
        await notify(
          job.chatId,
          [
            `Misión lista en ${payload.slug} (status ${conversation?.execution_status}).`,
            summary,
            changeText && changeText !== "{}" ? `git changes: ${changeText}` : "",
            "Cero push. Si querés otro cambio, pedímelo.",
          ]
            .filter(Boolean)
            .join("\n")
        );
        return;
      }
      jobs.update(job.id, {
        status: "queued",
        runAfter: now() + pollDelayMs,
        payload: { ...payload, conversationId },
      });
    } catch (err) {
      jobs.update(job.id, {
        status: "queued",
        runAfter: now() + pollDelayMs,
        error: err.code || err.message,
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
      return packReply("Paré. El obrero no sigue. El repo queda como esté en ./workspace.");
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
      return startCodeJob(
        {
          chatId: chatId || item.chatId,
          slug: item.slug,
          instruction: item.instruction,
          testCommand: item.testCommand,
          filesPlan: item.filesPlan,
          conversationId: item.conversationId,
        },
        { followUp: Boolean(item.conversationId) }
      );
    }
    throw denied("stuck_verb_denied");
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
      return packReply(
        item.kind === "clone"
          ? "Clone RECHAZADO. No toqué ./workspace."
          : "Misión código RECHAZADA. OpenHands no se llamó."
      );
    }
    if (item.kind === "clone") {
      return startCloneJob(item);
    }
    if (item.kind === "code") {
      return startCodeJob(item);
    }
    throw denied();
  }

  const handlers = {
    clone: handleCloneJob,
    code: handleCodeJob,
    oh_poll: handlePollJob,
  };

  return {
    interceptChat,
    proposeClone,
    proposeCode,
    handleHitl,
    handlers,
    parseWorkspaceCallback,
  };
}
