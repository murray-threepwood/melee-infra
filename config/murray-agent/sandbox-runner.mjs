import fs from "node:fs";
import { spawn } from "node:child_process";

export class SandboxRunner {
  constructor({ backend = "base" } = {}) {
    this.backend = backend;
  }

  async isAvailable() {
    throw new Error("not_implemented: isAvailable debe implementarse en la subclase");
  }

  async createSandbox(_opts = {}) {
    throw new Error("not_implemented: createSandbox debe implementarse en la subclase");
  }

  async executeCommand(_sandboxId, _command, _opts = {}) {
    throw new Error("not_implemented: executeCommand debe implementarse en la subclase");
  }

  async destroySandbox(_sandboxId) {
    throw new Error("not_implemented: destroySandbox debe implementarse en la subclase");
  }

  async inspectSandbox(_sandboxId) {
    throw new Error("not_implemented: inspectSandbox debe implementarse en la subclase");
  }
}

export class DockerLocalRunner extends SandboxRunner {
  constructor({
    dockerSocket = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock",
    defaultNetwork = process.env.SANDBOX_NETWORK || "agent-net",
    spawnImpl = spawn,
    fsImpl = fs,
  } = {}) {
    super({ backend: "docker" });
    this.dockerSocket = dockerSocket;
    this.defaultNetwork = defaultNetwork;
    this.spawnImpl = spawnImpl;
    this.fsImpl = fsImpl;
  }

  async isAvailable() {
    try {
      const exists = this.fsImpl.existsSync(this.dockerSocket);
      if (!exists) {
        return {
          available: false,
          reason: `docker_socket_missing: Socket Docker no encontrado en ${this.dockerSocket}`,
        };
      }
      return { available: true };
    } catch (err) {
      return {
        available: false,
        reason: `docker_check_error: ${err.message}`,
      };
    }
  }

  async createSandbox({
    slug = "",
    containerName = "",
    image = "openhands/sandbox:latest",
    network = this.defaultNetwork,
    env = {},
  } = {}) {
    const avail = await this.isAvailable();
    if (!avail.available) {
      const err = new Error(avail.reason);
      err.code = "docker_unavailable";
      throw err;
    }

    const name = containerName || `oh-sandbox-${slug.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now().toString(36)}`;
    return {
      id: name,
      name,
      status: "ready",
      backend: "docker",
      network,
      image,
      createdAt: Date.now(),
      env,
    };
  }

  async executeCommand(sandboxId, command, { timeoutMs = 60000, env = {}, cwd } = {}) {
    const args = ["exec"];
    if (cwd) {
      args.push("-w", cwd);
    }
    for (const [k, v] of Object.entries(env)) {
      args.push("-e", `${k}=${v}`);
    }
    args.push(sandboxId, "sh", "-c", command);

    const start = Date.now();
    return new Promise((resolve, reject) => {
      let timer = null;
      let proc = null;
      try {
        proc = this.spawnImpl("docker", args);
      } catch (err) {
        return reject(err);
      }

      let stdout = "";
      let stderr = "";

      if (proc.stdout) {
        proc.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
      }
      if (proc.stderr) {
        proc.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
      }

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {}
          const err = new Error(`command_timeout: Comando superó el tiempo límite de ${timeoutMs}ms`);
          err.code = "command_timeout";
          reject(err);
        }, timeoutMs);
      }

      proc.on("error", (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });

      proc.on("close", (code) => {
        if (timer) clearTimeout(timer);
        const durationMs = Date.now() - start;
        const exitCode = typeof code === "number" ? code : 1;
        resolve({
          exitCode,
          stdout,
          stderr,
          durationMs,
          oomKilled: exitCode === 137,
        });
      });
    });
  }

  async destroySandbox(sandboxId) {
    return new Promise((resolve) => {
      try {
        const proc = this.spawnImpl("docker", ["rm", "-f", sandboxId]);
        proc.on("close", (code) => {
          resolve({ ok: code === 0 });
        });
        proc.on("error", () => {
          resolve({ ok: false });
        });
      } catch {
        resolve({ ok: false });
      }
    });
  }

  async inspectSandbox(sandboxId) {
    return new Promise((resolve) => {
      try {
        const proc = this.spawnImpl("docker", ["inspect", sandboxId]);
        let stdout = "";
        if (proc.stdout) {
          proc.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
          });
        }
        proc.on("close", (code) => {
          if (code !== 0) {
            return resolve({ running: false, status: "stopped", raw: null });
          }
          try {
            const data = JSON.parse(stdout);
            const state = data[0]?.State || {};
            resolve({
              running: Boolean(state.Running),
              status: state.Status || "unknown",
              exitCode: state.ExitCode ?? null,
              oomKilled: Boolean(state.OOMKilled),
              raw: data[0] || null,
            });
          } catch {
            resolve({ running: false, status: "unknown", raw: null });
          }
        });
        proc.on("error", () => {
          resolve({ running: false, status: "error", raw: null });
        });
      } catch {
        resolve({ running: false, status: "error", raw: null });
      }
    });
  }
}

export class E2BRunner extends SandboxRunner {
  constructor({
    apiKey = process.env.E2B_API_KEY || "",
    baseUrl = process.env.E2B_BASE_URL || "https://api.e2b.dev",
    fetchImpl = fetch,
    timeoutMs = 30000,
  } = {}) {
    super({ backend: "e2b" });
    this.apiKey = String(apiKey || "").trim();
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async isAvailable() {
    if (!this.apiKey) {
      return {
        available: false,
        reason: "e2b_api_key_missing: Variable E2B_API_KEY no configurada en el entorno",
      };
    }
    return { available: true };
  }

  _assertApiKey() {
    if (!this.apiKey) {
      const err = new Error(
        "e2b_api_key_missing: Se requiere E2B_API_KEY en variables de entorno para usar SANDBOX_BACKEND=e2b"
      );
      err.code = "e2b_api_key_missing";
      throw err;
    }
  }

  async createSandbox({
    template = "base",
    metadata = {},
    env = {},
    timeoutMs = this.timeoutMs,
  } = {}) {
    this._assertApiKey();

    const res = await this.fetchImpl(`${this.baseUrl}/sandboxes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify({
        template,
        metadata,
        envVars: env,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`e2b_create_error: HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.code = "e2b_create_error";
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    return {
      id: data.sandboxID || data.id || `e2b-${Date.now().toString(36)}`,
      status: "ready",
      backend: "e2b",
      template,
      metadata,
      createdAt: Date.now(),
    };
  }

  async executeCommand(sandboxId, command, { timeoutMs = 60000, env = {}, cwd } = {}) {
    this._assertApiKey();
    const start = Date.now();

    const res = await this.fetchImpl(`${this.baseUrl}/sandboxes/${sandboxId}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": this.apiKey,
      },
      body: JSON.stringify({
        cmd: command,
        envVars: env,
        cwd,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`e2b_exec_error: HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.code = "e2b_exec_error";
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const durationMs = Date.now() - start;

    return {
      exitCode: Number(data.exitCode ?? 0),
      stdout: String(data.stdout || ""),
      stderr: String(data.stderr || ""),
      durationMs,
      oomKilled: Number(data.exitCode) === 137,
    };
  }

  async destroySandbox(sandboxId) {
    this._assertApiKey();
    const res = await this.fetchImpl(`${this.baseUrl}/sandboxes/${sandboxId}`, {
      method: "DELETE",
      headers: {
        "X-API-KEY": this.apiKey,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    return { ok: res.ok };
  }

  async inspectSandbox(sandboxId) {
    this._assertApiKey();
    const res = await this.fetchImpl(`${this.baseUrl}/sandboxes/${sandboxId}`, {
      method: "GET",
      headers: {
        "X-API-KEY": this.apiKey,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      return { running: false, status: "stopped", raw: null };
    }

    const data = await res.json();
    return {
      running: data.status === "running" || data.status === "ready",
      status: data.status || "unknown",
      raw: data,
    };
  }
}

export function createSandboxRunner({
  backend = process.env.SANDBOX_BACKEND || "docker",
  dockerOptions = {},
  e2bOptions = {},
  customRunners = {},
} = {}) {
  const normalized = String(backend || "docker").toLowerCase().trim();

  if (customRunners[normalized]) {
    const CustomClass = customRunners[normalized];
    return new CustomClass();
  }

  if (normalized === "docker") {
    return new DockerLocalRunner(dockerOptions);
  }

  if (normalized === "e2b") {
    return new E2BRunner(e2bOptions);
  }

  const err = new Error(
    `unknown_sandbox_backend: Backend "${backend}" no soportado. Opciones válidas: "docker", "e2b"`
  );
  err.code = "unknown_sandbox_backend";
  throw err;
}
