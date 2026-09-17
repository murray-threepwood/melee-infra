import { spawn } from "node:child_process";
import { redact } from "./redact.mjs";

export const ALLOWED_SERVICES = [
  "postgres_db",
  "cloudflared",
  "n8n",
  "workspace-mcp",
  "openhands",
  "murray-agent",
];

const FORBIDDEN_TOKENS = new Set([
  "down",
  "exec",
  "kill",
  "rm",
  "prune",
  "system",
  "attach",
  "cp",
  "commit",
]);

const WEBHOOK_GAP_SERVICES = new Set(["n8n", "cloudflared", "murray-agent"]);

export function webhookGapWarning(service) {
  if (!WEBHOOK_GAP_SERVICES.has(service)) {
    return "";
  }
  return (
    "Aviso: recreate/restart de este servicio puede dejar el webhook Telegram " +
    "mudo 10–20s (connection refused a n8n o túnel). Esperá y reintentá /status."
  );
}

export function assertSafeComposeArgs(args) {
  const tokens = (args || []).map((item) => String(item));
  for (const token of tokens) {
    const bare = token.replace(/^-+/, "");
    if (FORBIDDEN_TOKENS.has(token) || FORBIDDEN_TOKENS.has(bare)) {
      const err = new Error(`ops_forbidden: ${token}`);
      err.code = "ops_forbidden";
      throw err;
    }
    if (token === "-v" || token === "--volumes" || token === "--remove-orphans") {
      const err = new Error(`ops_forbidden: ${token}`);
      err.code = "ops_forbidden";
      throw err;
    }
  }
  return tokens;
}

export function assertAllowedService(service) {
  const name = String(service || "").trim();
  if (!ALLOWED_SERVICES.includes(name)) {
    const err = new Error(
      `servicio no permitido: ${name || "(vacío)"}. Permitidos: ${ALLOWED_SERVICES.join(", ")}`
    );
    err.code = "ops_service_denied";
    throw err;
  }
  return name;
}

function defaultRunCommand(args, { timeoutMs = 45000 } = {}) {
  assertSafeComposeArgs(args);
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const err = new Error("ops_timeout");
      err.code = "ops_timeout";
      reject(err);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: redact(stdout),
        stderr: redact(stderr),
      });
    });
  });
}

export function createOps({
  runCommand = defaultRunCommand,
  project = process.env.COMPOSE_PROJECT_NAME || "murray-infra",
  composeFile = process.env.COMPOSE_FILE || "/opt/stack/docker-compose.yml",
  projectDir = process.env.COMPOSE_PROJECT_DIR || "/opt/stack",
} = {}) {
  const prefix = () => [
    "compose",
    "-p",
    project,
    "-f",
    composeFile,
    "--project-directory",
    projectDir,
  ];

  async function run(args) {
    const result = await runCommand(assertSafeComposeArgs(args));
    return result;
  }

  return {
    allowedServices: () => [...ALLOWED_SERVICES],
    async ps() {
      return run([...prefix(), "ps", "--format", "json"]);
    },
    async logs(service, tail = 50) {
      const name = assertAllowedService(service);
      const lines = Math.min(Math.max(Number(tail) || 50, 1), 80);
      return run([...prefix(), "logs", "--tail", String(lines), "--no-color", name]);
    },
    async restart(service) {
      const name = assertAllowedService(service);
      return run([...prefix(), "restart", name]);
    },
    async recreate(service) {
      const name = assertAllowedService(service);
      return run([
        ...prefix(),
        "up",
        "-d",
        "--force-recreate",
        "--no-deps",
        name,
      ]);
    },
  };
}
