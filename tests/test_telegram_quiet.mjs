import assert from "node:assert/strict";
import { test } from "node:test";
import { createTelegramNotifier } from "../config/murray-agent/telegram.mjs";

test("MURRAY_TELEGRAM_QUIET no pega a Telegram", async () => {
  let hits = 0;
  const telegram = createTelegramNotifier({
    token: "123:ABC",
    chatId: "1169267979",
    quiet: true,
    fetchImpl: async () => {
      hits += 1;
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  const out = await telegram.send({ text: "no me suenes el celular" });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, "telegram_quiet");
  assert.equal(hits, 0);
});

test("MURRAY_TELEGRAM_QUIET sí avisa estados terminales", async () => {
  let hits = 0;
  const telegram = createTelegramNotifier({
    token: "123:ABC",
    chatId: "1169267979",
    quiet: true,
    fetchImpl: async () => {
      hits += 1;
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  const out = await telegram.send({
    text: "misión lista",
    terminal: true,
  });
  assert.equal(out.ok, true);
  assert.equal(hits, 1);
});
