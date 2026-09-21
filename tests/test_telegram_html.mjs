import test from "node:test";
import assert from "node:assert/strict";
import {
  createTelegramNotifier,
  escapeTelegramHtml,
} from "../config/murray-agent/telegram.mjs";

test("escapeTelegramHtml sanitiza entidades básicas de forma determinista", () => {
  assert.equal(escapeTelegramHtml(""), "");
  assert.equal(escapeTelegramHtml(null), "");
  assert.equal(escapeTelegramHtml(undefined), "");
  assert.equal(escapeTelegramHtml(123), "123");

  const raw = "feat/tk01_purity <script>alert('xss')</script> && a < b > c";
  const expected = "feat/tk01_purity &lt;script&gt;alert('xss')&lt;/script&gt; &amp;&amp; a &lt; b &gt; c";
  assert.equal(escapeTelegramHtml(raw), expected);
});

test("createTelegramNotifier envía con parse_mode HTML y une arrays con saltos de línea", async () => {
  const sentBodies = [];
  const fakeFetch = async (url, options) => {
    sentBodies.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    };
  };

  const notifier = createTelegramNotifier({
    token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    chatId: "987654321",
    quiet: false,
    fetchImpl: fakeFetch,
  });

  const lines = [
    "<b>Estado de Garfio:</b>",
    "• Rama: <code>feat/tk01_purity</code>",
    "• Tests: verdes al 100%",
  ];

  const buttons = [
    [{ text: "🚀 Aprobar", callback_data: "APPROVE_PUSH:1234" }],
  ];

  await notifier.send({
    text: lines,
    buttons,
    terminal: true,
  });

  assert.equal(sentBodies.length, 1);
  const body = sentBodies[0];
  assert.equal(body.chat_id, "987654321");
  assert.equal(body.parse_mode, "HTML");
  assert.equal(body.disable_web_page_preview, true);
  assert.equal(
    body.text,
    "<b>Estado de Garfio:</b>\n• Rama: <code>feat/tk01_purity</code>\n• Tests: verdes al 100%"
  );
  assert.deepEqual(body.reply_markup, { inline_keyboard: buttons });
});

test("createTelegramNotifier se recupera de un HTTP 400 Bad Request mediante fallback sanitizado", async () => {
  let callCount = 0;
  const requests = [];

  const fakeFetch = async (url, options) => {
    callCount++;
    const payload = JSON.parse(options.body);
    requests.push(payload);

    // En la primera llamada simula que Telegram rechaza por parse error
    if (callCount === 1) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          ok: false,
          error_code: 400,
          description: "Bad Request: can't parse entities: Unsupported start tag",
        }),
      };
    }

    // En la segunda llamada (fallback) acepta el mensaje
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 43 } }),
    };
  };

  const notifier = createTelegramNotifier({
    token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    chatId: "987654321",
    quiet: false,
    fetchImpl: fakeFetch,
  });

  const malformedHtml = "Texto con tag inválido <unclosed_tag y ampersand & sin escapar";

  const result = await notifier.send({
    text: malformedHtml,
    terminal: true,
  });

  assert.equal(callCount, 2);
  assert.equal(result.ok, true);

  // Primera llamada: texto crudo
  assert.equal(requests[0].text, malformedHtml);

  // Segunda llamada (fallback): sanitizado con escapeTelegramHtml
  assert.equal(
    requests[1].text,
    "Texto con tag inválido &lt;unclosed_tag y ampersand &amp; sin escapar"
  );
  assert.equal(requests[1].parse_mode, "HTML");
});
