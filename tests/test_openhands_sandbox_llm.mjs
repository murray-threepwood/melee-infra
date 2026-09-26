import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  assertNoReservedSecretNames,
  assertSandboxReachableLlmBaseUrl,
  conversationSecrets,
  createOpenHandsClient,
  openHandsLlmModel,
  sandboxLlmBaseUrl,
} from "../config/murray-agent/openhands.mjs";

test("assertSandboxReachableLlmBaseUrl acepta litellm en agent-net y rechaza hosts invalidos", () => {
  assert.equal(
    assertSandboxReachableLlmBaseUrl("http://litellm:4000"),
    "http://litellm:4000"
  );
  assert.equal(
    assertSandboxReachableLlmBaseUrl("http://litellm:4000/v1"),
    "http://litellm:4000/v1"
  );
  assert.equal(
    assertSandboxReachableLlmBaseUrl("http://host.docker.internal:4000"),
    "http://host.docker.internal:4000"
  );
  assert.throws(
    () => assertSandboxReachableLlmBaseUrl("http://postgres_db:5432"),
    /sandbox_llm_unreachable/
  );
});

test("sandboxLlmBaseUrl default es litellm en agent-net", () => {
  const url = sandboxLlmBaseUrl({});
  assert.match(url, /litellm/);
});

test("OpenHands 1.36 rechaza secretos LLM_*; conversationSecrets no propaga master key en cleartext", () => {
  assert.throws(
    () => assertNoReservedSecretNames({ LLM_API_KEY: "sk-test" }),
    /reserved_secret_name/
  );
  assert.throws(
    () => assertNoReservedSecretNames({ LLM_BASE_URL: "http://x" }),
    /reserved_secret_name/
  );
  // Hardening: string api key (master key) returns undefined
  assert.equal(conversationSecrets("sk-test-master-not-a-placeholder"), undefined);
  assert.equal(conversationSecrets("  "), undefined);
  // Custom secrets without LLM_* are preserved
  const secrets = conversationSecrets({ CUSTOM_SECRET: "sec123" });
  assert.deepEqual(secrets, { CUSTOM_SECRET: "sec123" });
  assert.throws(
    () => conversationSecrets({ LLM_API_KEY: "sk-bad" }),
    /reserved_secret_name/
  );
});

test("startConversation no propaga master key en cleartext en el body", async () => {
  const seen = [];
  const client = createOpenHandsClient({
    baseUrl: "http://openhands:3000",
    llmApiKey: "sk-test-master-not-a-placeholder",
    fetchImpl: async (url, opts) => {
      seen.push({ url, body: JSON.parse(opts.body) });
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ id: "task-1" }),
        text: async () => "",
      };
    },
  });
  await client.startConversation({
    title: "garfio-ddi",
    text: "Q01",
    llmModel: "deepseek-chat",
  });
  assert.equal(seen[0].body.llm_model, openHandsLlmModel("deepseek-chat"));
  assert.equal(seen[0].body.secrets, undefined);
});

test("compose: LiteLLM confinado a agent-net sin ports host, OpenHands usa litellm y montajes aislados", () => {
  const compose = fs.readFileSync(
    new URL("../docker-compose.yml", import.meta.url),
    "utf8"
  );
  // P1: Sin mapeo de puertos hacia el host
  assert.doesNotMatch(compose, /127\.0\.0\.1:\$\{LITELLM_PORT:-4000\}:4000/);
  // P2: URL interna litellm en agent-net
  assert.match(compose, /LLM_BASE_URL=http:\/\/litellm:4000/);
  // P3, P10, P11: Sin variables superfluas propagando master key
  assert.doesNotMatch(compose, /OH_AGENT_SERVER_ENV=/);
  assert.doesNotMatch(compose, /SANDBOX_ENV_OPENAI_BASE_URL=/);
  // P5: Montaje de workspace aislado por slug
  assert.match(
    compose,
    /WORKSPACE_MOUNT_PATH=\$\{WORKSPACE_HOST_PATH:-\$\{PWD\}\/workspace\}\/\$\{WORKSPACE_SLUG:-active\}/
  );
  assert.match(
    compose,
    /SANDBOX_VOLUMES=\$\{WORKSPACE_HOST_PATH:-\$\{PWD\}\/workspace\}\/\$\{WORKSPACE_SLUG:-active\}:\/workspace\/project:rw/
  );
  // P6 & P7: Normalizados
  assert.match(compose, /MURRAY_HITL_BYPASS=\$\{MURRAY_HITL_BYPASS:-\}/);
  assert.match(compose, /MURRAY_TELEGRAM_QUIET=\$\{MURRAY_TELEGRAM_QUIET:-0\}/);
});

test("litellm acepta openai/garfio-worker y openai/deepseek-chat", () => {
  const yaml = fs.readFileSync(
    new URL("../config/litellm/config.yaml", import.meta.url),
    "utf8"
  );
  assert.match(yaml, /model_name: openai\/garfio-worker/);
  assert.match(yaml, /model_name: openai\/deepseek-chat/);
});

test("compose: sandboxes unificados en agent-net y host-gateway", () => {
  const compose = fs.readFileSync(
    new URL("../docker-compose.yml", import.meta.url),
    "utf8"
  );
  assert.match(compose, /SANDBOX_NETWORK=agent-net/);
  assert.match(compose, /SANDBOX_NETWORK_MODE=agent-net/);
  assert.match(compose, /SANDBOX_EXTRA_HOSTS=host\.docker\.internal:host-gateway/);
  assert.match(compose, /SANDBOX_ADD_HOSTS=host\.docker\.internal:host-gateway/);
  assert.match(compose, /murray-agent:[\s\S]*extra_hosts:[\s\S]*- "host\.docker\.internal:host-gateway"/);
});
