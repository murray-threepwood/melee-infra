import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTelegramQuiet,
  parseHitlBypass,
  shouldBypassHitl,
} from "../config/murray-agent/hitl-policy.mjs";

test("parseHitlBypass vacío deja el peaje HITL intacto", () => {
  assert.deepEqual(parseHitlBypass(""), new Set());
  assert.deepEqual(parseHitlBypass("0"), new Set());
  assert.deepEqual(parseHitlBypass("false"), new Set());
  assert.equal(shouldBypassHitl("code", parseHitlBypass("")), false);
});

test("parseHitlBypass code,clone no toca push ni ops", () => {
  const bypass = parseHitlBypass("code,clone");
  assert.equal(shouldBypassHitl("code", bypass), true);
  assert.equal(shouldBypassHitl("clone", bypass), true);
  assert.equal(shouldBypassHitl("push", bypass), false);
  assert.equal(shouldBypassHitl("delete", bypass), false);
  assert.equal(shouldBypassHitl("ops", bypass), false);
});

test("parseHitlBypass all abre todo; basura se ignora", () => {
  const all = parseHitlBypass("all");
  assert.equal(shouldBypassHitl("push", all), true);
  assert.equal(shouldBypassHitl("stuck", all), true);
  const mixed = parseHitlBypass("code, explotar-el-host, clone");
  assert.deepEqual(mixed, new Set(["code", "clone"]));
});

test("isTelegramQuiet solo con flag explícito", () => {
  assert.equal(isTelegramQuiet(""), false);
  assert.equal(isTelegramQuiet("0"), false);
  assert.equal(isTelegramQuiet("1"), true);
  assert.equal(isTelegramQuiet("quiet"), true);
});
