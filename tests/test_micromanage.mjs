import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMicromanageInterval,
  isMicromanageIntent,
  isGarfioPeekIntent,
  classifyUserText,
} from "../config/murray-agent/intent.mjs";
import {
  extractGarfioLiveActivity,
  formatMalManagerReport,
} from "../config/murray-agent/openhands.mjs";
import { createCodingSession } from "../config/murray-agent/coding.mjs";

test("parseMicromanageInterval: valida opciones y defaults", () => {
  assert.equal(parseMicromanageInterval(""), 60);
  assert.equal(parseMicromanageInterval("on"), 60);
  assert.equal(parseMicromanageInterval("30s"), 30);
  assert.equal(parseMicromanageInterval("30 segundos"), 30);
  assert.equal(parseMicromanageInterval("1m"), 60);
  assert.equal(parseMicromanageInterval("1"), 60);
  assert.equal(parseMicromanageInterval("1 min"), 60);
  assert.equal(parseMicromanageInterval("1 minuto"), 60);
  assert.equal(parseMicromanageInterval("2m"), 120);
  assert.equal(parseMicromanageInterval("2"), 120);
  assert.equal(parseMicromanageInterval("5m"), 300);
  assert.equal(parseMicromanageInterval("5"), 300);
  assert.equal(parseMicromanageInterval("10m"), 600);
  assert.equal(parseMicromanageInterval("10"), 600);
  assert.equal(parseMicromanageInterval("30m"), 1800);
  assert.equal(parseMicromanageInterval("off"), 0);
  assert.equal(parseMicromanageInterval("desactivar"), 0);
  assert.equal(parseMicromanageInterval("42s"), null);
  assert.equal(parseMicromanageInterval("random"), null);
});

test("isMicromanageIntent: slash y lenguaje natural", () => {
  assert.deepEqual(isMicromanageIntent("/malmanager 30s"), { intervalRaw: "30s" });
  assert.deepEqual(isMicromanageIntent("/mirar 2m"), { intervalRaw: "2m" });
  assert.deepEqual(isMicromanageIntent("/verbose off"), { intervalRaw: "off" });
  assert.deepEqual(isMicromanageIntent("/malmanager"), { intervalRaw: "" });
  assert.deepEqual(
    isMicromanageIntent("mirar por el hombro lo que hace garfio como mal manager"),
    { intervalRaw: "" }
  );
  assert.deepEqual(
    isMicromanageIntent("mirar por el hombro a garfio cada 5 min"),
    { intervalRaw: "5 min" }
  );
  assert.deepEqual(
    isMicromanageIntent("modo mal manager 1m"),
    { intervalRaw: "1m" }
  );
  assert.deepEqual(
    isMicromanageIntent("desactivar modo mal manager"),
    { intervalRaw: "off" }
  );
  assert.equal(isMicromanageIntent("hola que tal"), null);
});

test("isGarfioPeekIntent: detección de preguntas en vivo", () => {
  assert.equal(isGarfioPeekIntent("¿en qué anda garfio?"), true);
  assert.equal(isGarfioPeekIntent("en que anda garfio"), true);
  assert.equal(isGarfioPeekIntent("qué hace garfio"), true);
  assert.equal(isGarfioPeekIntent("cómo viene garfio"), true);
  assert.equal(isGarfioPeekIntent("espiar garfio"), true);
  assert.equal(isGarfioPeekIntent("qué pasó con el stack"), false);
});

test("classifyUserText: clasifica micromanage y garfio_peek", () => {
  assert.equal(
    classifyUserText("mirar por el hombro lo que hace garfio como mal manager").action,
    "micromanage"
  );
  assert.equal(classifyUserText("/malmanager 1m").action, "micromanage");
  assert.equal(classifyUserText("¿en qué anda garfio?").action, "garfio_peek");
});

test("extractGarfioLiveActivity y formatMalManagerReport", () => {
  const events = [
    {
      kind: "Action",
      args: { command: "uv run pytest -q tests/test_numerical_purity.py" },
      action: "run",
    },
    {
      kind: "Observation",
      payload: { exit_code: 1, content: "FAILED (failures=1)" },
    },
    {
      kind: "Action",
      args: { path: "backend/app/core/firewall.py" },
      action: "edit",
    },
    {
      source: "agent",
      payload: { thought: "Reemplazando llamadas a round() por formato %.17g" },
    },
  ];

  const act = extractGarfioLiveActivity(events);
  assert.equal(act.lastCommand, "uv run pytest -q tests/test_numerical_purity.py");
  assert.equal(act.lastExitCode, 1);
  assert.equal(act.lastFile, "backend/app/core/firewall.py");
  assert.match(act.lastThought, /Reemplazando llamadas/);

  const report = formatMalManagerReport({
    elapsedMs: 95000,
    sandboxStatus: "RUNNING",
    activity: act,
    slug: "hbauzan-semantic-firewall",
  });

  assert.match(report, /\[Murray: Mal Manager Report\]/);
  assert.match(report, /1m 35s/);
  assert.match(report, /backend\/app\/core\/firewall\.py/);
  assert.match(report, /Exit: 1/);
  assert.match(report, /El ojo de Murray/);
});

test("codingSession: setMicromanage y watcher periódico en handlePollJob", async () => {
  const sessionData = {
    slug: "test-repo",
    micromanage_interval: 0,
  };
  const session = {
    get: () => ({ ...sessionData }),
    patch: (_id, patch) => Object.assign(sessionData, patch),
  };

  const jobList = [];
  const jobs = {
    enqueue: (j) => {
      const row = { id: "job123", ...j };
      jobList.push(row);
      return row;
    },
    update: (id, patch) => {
      const row = jobList.find((j) => j.id === id);
      if (row) Object.assign(row, patch, { payload: { ...row.payload, ...patch.payload } });
    },
    list: () => jobList,
    appendLog: () => {},
  };

  const sentMessages = [];
  const telegram = {
    send: async (msg) => {
      sentMessages.push(msg);
      return { ok: true };
    },
  };

  let currentTime = 1000000;
  const coding = createCodingSession({
    session,
    jobs,
    telegram,
    now: () => currentTime,
    openhands: {
      getConversation: async () => ({ sandbox_status: "RUNNING", execution_status: "running" }),
      searchEvents: async () => [
        { args: { command: "npm test" }, action: "run" },
        { payload: { exit_code: 0 } },
      ],
    },
  });

  // 1. Activar malmanager con intervalo 60s
  const activated = await coding.setMicromanage({ chatId: "42", intervalRaw: "1m" });
  assert.equal(sessionData.micromanage_interval, 60);
  assert.match(activated.reply, /ACTIVADO|configurado/);

  // 2. Simular un job oh_poll activo
  const pollJob = {
    id: "poll999",
    type: "oh_poll",
    chatId: "42",
    createdAt: currentTime,
    payload: {
      startedAt: currentTime,
      conversationId: "conv1",
      slug: "test-repo",
      micromanage_interval: 60,
      lastProgressNotifyAt: currentTime,
    },
  };
  jobList.push(pollJob);

  // 3. Ejecutar handlePollJob antes de que pasen los 60s (a los 30s)
  currentTime += 30000;
  await coding.handlers.oh_poll(pollJob);
  assert.equal(sentMessages.length, 0); // No debe haber disparado todavía

  // 4. Avanzar a los 65s -> Debe disparar el reporte con terminal: true
  currentTime += 35000;
  await coding.handlers.oh_poll(pollJob);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].terminal, true);
  assert.match(sentMessages[0].text, /Mal Manager Report/);
  assert.match(sentMessages[0].text, /npm test/);

  // 5. Apagar malmanager
  const deactivated = await coding.setMicromanage({ chatId: "42", intervalRaw: "off" });
  assert.equal(sessionData.micromanage_interval, 0);
  assert.match(deactivated.reply, /DESACTIVADO/);
});
