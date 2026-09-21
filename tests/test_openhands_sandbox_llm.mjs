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

test("assertSandboxReachableLlmBaseUrl rechaza DNS de agent-net", () => {
  assert.throws(
    () => assertSandboxReachableLlmBaseUrl("http://litellm:4000"),
    /sandbox_llm_unreachable/
  );
  assert.throws(
    () => assertSandboxReachableLlmBaseUrl("http://litellm:4000/v1"),
    /sandbox_llm_unreachable/
  );
  assert.equal(
    assertSandboxReachableLlmBaseUrl("http://host.docker.internal:4000"),
    "http://host.docker.internal:4000"
  );
  assert.equal(
    assertSandboxReachableLlmBaseUrl("http://host.docker.internal:4000/v1"),
    "http://host.docker.internal:4000/v1"
  );
});

test("sandboxLlmBaseUrl default es host.docker.internal, no litellm", () => {
  const url = sandboxLlmBaseUrl({});
  assert.match(url, /host\.docker\.internal/);
  assert.doesNotMatch(url, /litellm/);
});

test("OpenHands 1.36 rechaza secretos LLM_*; conversationSecrets no los emite", () => {
  assert.throws(
    () => assertNoReservedSecretNames({ LLM_API_KEY: "sk-test" }),
    /reserved_secret_name/
  );
  assert.throws(
    () => assertNoReservedSecretNames({ LLM_BASE_URL: "http://x" }),
    /reserved_secret_name/
  );
  const secrets = conversationSecrets("sk-test-master-not-a-placeholder");
  assert.deepEqual(secrets, { OPENAI_API_KEY: "sk-test-master-not-a-placeholder" });
  assert.equal(conversationSecrets("  "), undefined);
  assert.doesNotThrow(() => assertNoReservedSecretNames(secrets));
});

test("startConversation manda secrets OPENAI_API_KEY al sandbox, sin prefijo LLM_", async () => {
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
  assert.equal(seen[0].body.secrets.OPENAI_API_KEY, "sk-test-master-not-a-placeholder");
  assert.equal(seen[0].body.secrets.LLM_API_KEY, undefined);
});

test("compose: LiteLLM sale a loopback y OpenHands no usa DNS litellm hacia el sandbox", () => {
  const compose = fs.readFileSync(
    new URL("../docker-compose.yml", import.meta.url),
    "utf8"
  );
  assert.match(compose, /127\.0\.0\.1:\$\{LITELLM_PORT:-4000\}:4000/);
  assert.match(compose, /LLM_BASE_URL=http:\/\/host\.docker\.internal:\$\{LITELLM_PORT:-4000\}/);
  assert.match(compose, /OPENAI_API_KEY=\$\{LITELLM_MASTER_KEY/);
  assert.match(compose, /OH_AGENT_SERVER_ENV=/);
  assert.match(compose, /OPENAI_API_KEY":"\$\{LITELLM_MASTER_KEY/);
  assert.match(compose, /SANDBOX_ENV_OPENAI_BASE_URL=http:\/\/host\.docker\.internal:\$\{LITELLM_PORT:-4000\}/);
  assert.match(compose, /OPENAI_BASE_URL=http:\/\/host\.docker\.internal:\$\{LITELLM_PORT:-4000\}/);
  assert.match(
    compose,
    /WORKSPACE_MOUNT_PATH=\$\{WORKSPACE_HOST_PATH:-\$\{PWD\}\/workspace\}/
  );
  assert.match(
    compose,
    /SANDBOX_VOLUMES=\$\{WORKSPACE_HOST_PATH:-\$\{PWD\}\/workspace\}:\/workspace\/project:rw/
  );
  assert.doesNotMatch(
    compose,
    /openhands:[\s\S]*LLM_BASE_URL=http:\/\/litellm:4000/
  );
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
