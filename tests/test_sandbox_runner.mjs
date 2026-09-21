import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SandboxRunner,
  DockerLocalRunner,
  E2BRunner,
  createSandboxRunner,
} from "../config/murray-agent/sandbox-runner.mjs";

test("SandboxRunner base lanza not_implemented en sus metodos", async () => {
  const runner = new SandboxRunner();
  assert.equal(runner.backend, "base");

  await assert.rejects(() => runner.isAvailable(), /not_implemented/);
  await assert.rejects(() => runner.createSandbox(), /not_implemented/);
  await assert.rejects(() => runner.executeCommand("id", "ls"), /not_implemented/);
  await assert.rejects(() => runner.destroySandbox("id"), /not_implemented/);
  await assert.rejects(() => runner.inspectSandbox("id"), /not_implemented/);
});

test("createSandboxRunner factoria devuelve el runner correcto", () => {
  const dockerRunner = createSandboxRunner({ backend: "docker" });
  assert.ok(dockerRunner instanceof DockerLocalRunner);
  assert.equal(dockerRunner.backend, "docker");

  const e2bRunner = createSandboxRunner({
    backend: "e2b",
    e2bOptions: { apiKey: "test-e2b-key" },
  });
  assert.ok(e2bRunner instanceof E2BRunner);
  assert.equal(e2bRunner.backend, "e2b");

  assert.throws(
    () => createSandboxRunner({ backend: "kubernetes" }),
    /unknown_sandbox_backend/
  );
});

test("DockerLocalRunner verifica disponibilidad del socket docker", async () => {
  const mockFsMissing = {
    existsSync: () => false,
  };
  const runnerUnavailable = new DockerLocalRunner({
    dockerSocket: "/nonexistent/docker.sock",
    fsImpl: mockFsMissing,
  });
  const check1 = await runnerUnavailable.isAvailable();
  assert.equal(check1.available, false);
  assert.ok(check1.reason.includes("docker_socket_missing"));

  await assert.rejects(
    () => runnerUnavailable.createSandbox({ slug: "test/repo" }),
    /docker_socket_missing/
  );

  const mockFsPresent = {
    existsSync: () => true,
  };
  const runnerAvailable = new DockerLocalRunner({
    dockerSocket: "/var/run/docker.sock",
    fsImpl: mockFsPresent,
  });
  const check2 = await runnerAvailable.isAvailable();
  assert.equal(check2.available, true);

  const sandbox = await runnerAvailable.createSandbox({ slug: "acme/repo" });
  assert.equal(sandbox.backend, "docker");
  assert.equal(sandbox.status, "ready");
  assert.ok(sandbox.id.includes("acme-repo"));
});

test("DockerLocalRunner ejecuta comando y detecta OOM 137", async () => {
  const mockSpawn = (cmd, args) => {
    assert.equal(cmd, "docker");
    assert.equal(args[0], "exec");
    return {
      stdout: { on: (evt, fn) => evt === "data" && fn(Buffer.from("output ok")) },
      stderr: { on: (_evt, _fn) => {} },
      on: (evt, fn) => {
        if (evt === "close") fn(137); // OOM killed
      },
    };
  };

  const runner = new DockerLocalRunner({ spawnImpl: mockSpawn });
  const res = await runner.executeCommand("box-1", "python test.py");
  assert.equal(res.exitCode, 137);
  assert.equal(res.stdout, "output ok");
  assert.equal(res.oomKilled, true);
});

test("E2BRunner requiere API key y falla explicitamente si falta", async () => {
  const runnerNoKey = new E2BRunner({ apiKey: "" });
  const avail = await runnerNoKey.isAvailable();
  assert.equal(avail.available, false);
  assert.ok(avail.reason.includes("e2b_api_key_missing"));

  await assert.rejects(
    () => runnerNoKey.createSandbox({ template: "base" }),
    /e2b_api_key_missing/
  );
  await assert.rejects(
    () => runnerNoKey.executeCommand("e2b-1", "ls"),
    /e2b_api_key_missing/
  );
});

test("E2BRunner interactua con API remota con API key", async () => {
  const calls = [];
  const mockFetch = async (url, opts) => {
    calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
    if (url.endsWith("/sandboxes") && opts.method === "POST") {
      return {
        ok: true,
        json: async () => ({ sandboxID: "e2b-sub-123", status: "ready" }),
      };
    }
    if (url.includes("/commands") && opts.method === "POST") {
      return {
        ok: true,
        json: async () => ({ exitCode: 0, stdout: "hello from e2b microvm\n", stderr: "" }),
      };
    }
    if (url.endsWith("/sandboxes/e2b-sub-123") && opts.method === "DELETE") {
      return { ok: true };
    }
    return { ok: false, status: 404, text: async () => "not found" };
  };

  const runner = new E2BRunner({
    apiKey: "e2b_live_test_key_123",
    baseUrl: "https://mock.e2b.dev",
    fetchImpl: mockFetch,
  });

  const check = await runner.isAvailable();
  assert.equal(check.available, true);

  const sandbox = await runner.createSandbox({ template: "base-python" });
  assert.equal(sandbox.id, "e2b-sub-123");
  assert.equal(sandbox.backend, "e2b");
  assert.equal(sandbox.status, "ready");

  const cmdRes = await runner.executeCommand(sandbox.id, "python -c 'print(1)'");
  assert.equal(cmdRes.exitCode, 0);
  assert.equal(cmdRes.stdout, "hello from e2b microvm\n");
  assert.equal(cmdRes.oomKilled, false);

  const delRes = await runner.destroySandbox(sandbox.id);
  assert.equal(delRes.ok, true);

  assert.equal(calls.length, 3);
  assert.equal(calls[0].headers["X-API-KEY"], "e2b_live_test_key_123");
});
