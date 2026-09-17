import { chunkTelegram, redact } from "./redact.mjs";

export function createTelegramNotifier({
  token = process.env.TELEGRAM_BOT_TOKEN || "",
  chatId = process.env.TELEGRAM_CHAT_ID || "",
  fetchImpl = fetch,
  apiBase = "https://api.telegram.org",
} = {}) {
  const allowed = String(chatId || "");

  async function send({ text, buttons, chat_id } = {}) {
    const dest = String(chat_id || allowed);
    if (!token || /CAMBIAR_POR|REEMPLAZAR|ABCdefGHI/i.test(token)) {
      return { skipped: true, reason: "telegram_unconfigured" };
    }
    if (!dest || (allowed && dest !== allowed)) {
      const err = new Error("telegram_chat_denied");
      err.code = "telegram_chat_denied";
      throw err;
    }
    const chunks = chunkTelegram(redact(String(text || "")), 3900);
    let last = { ok: true };
    for (const chunk of chunks) {
      const body = {
        chat_id: dest,
        text: chunk,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      };
      if (buttons && buttons.length) {
        body.reply_markup = { inline_keyboard: buttons };
      }
      const res = await fetchImpl(`${apiBase}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      last = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || last.ok === false) {
        const err = new Error("telegram_send_failed");
        err.code = "telegram_send_failed";
        err.status = res.status;
        throw err;
      }
    }
    return last;
  }

  return { send, allowedChatId: allowed };
}

export function stuckKeyboard(approvalId) {
  const id = String(approvalId || "");
  return [
    [
      { text: "Reintentar", callback_data: `STUCK_RETRY:${id}` },
      { text: "Parar", callback_data: `STUCK_STOP:${id}` },
    ],
    [
      { text: "Ver log", callback_data: `STUCK_LOGS:${id}` },
      { text: "Cambiar instrucción", callback_data: `STUCK_CHG:${id}` },
    ],
  ];
}
