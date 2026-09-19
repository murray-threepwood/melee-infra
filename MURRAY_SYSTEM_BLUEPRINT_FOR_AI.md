# SYSTEM SPECIFICATION & ARCHITECTURAL BLUEPRINT: MURRAY INFRA (1-PERSON CEO)

> **AUTHORITATIVE DETERMINISTIC SPECIFICATION FOR AI CODING ASSISTANTS**
> **System Name**: Murray Infra (`murray-infra`)
> **Paradigm**: 1-Person Executive Autonomous Engine (1-Person CEO)
> **Target Audience**: Any autonomous AI/LLM agent tasked with reproducing, deploying, or auditing this system.
> **Language**: English (Deterministic Technical Contract)
> **Revision**: 1.0.0 (Living Architecture Contract)

---

## 1. System Identity, Mission & Governance Model

The **Murray Infra** system (`murray-infra`) is an autonomous executive engineering and operational stack designed for a **1-Person CEO**. It allows a single human operator to manage multiple software projects, execute infrastructure operations, monitor cloud communications, and direct autonomous coding agents through a unified, secure mobile interface: **Telegram**.

### Core Governance Principles

1. **Asymmetric Autonomy with Ironclad Guardrails**:
   - **Autonomous (No Approval Needed)**: Read-only diagnostics, git status/diff/log/pull/checkout, repository inspection, draft creation in Gmail, log streaming, resource monitoring, automated triage diagnosis.
   - **Guarded (Cryptographic Human-In-The-Loop Required)**: Git push to remote repositories, deletion of files/workspaces, stack container recreation/restart, email transmission, and starting autonomous code-editing sandbox sessions.
2. **Single Human Operator Verification**:
   - The entire system is bound to a single Telegram user: `TELEGRAM_CHAT_ID`. Any message, callback, or event originating from any other user identifier is dropped silently with zero side-effects.
3. **Draft-Only Communications**:
   - The system is physically incapable of sending emails. It can only triage incoming messages and stage drafts in Gmail. The final "Send" action is strictly reserved for the human CEO within the official Gmail interface.
4. **Hierarchical Agent Roles**:
    - **Executive Conductor (`murray-agent`)**: The conversational personality, strategic planner, stack sysadmin, and git gatekeeper. Operates with the persona of Murray (the demonic talking skull from Monkey Island 3: flamboyant, theatrical megalomania fused with ruthless senior engineering precision).
    - **Mechanical Worker (`openhands` / Garfio - Meathook)**: The code execution sandbox. Isolated inside a Docker runtime, executing edits, running test suites, and handling deep workspace modifications inside `./workspace/<slug>`. Operates with the persona of Garfio (Meathook, pirate with steel hooks programming with backs turned) backed by Senior IT (30+ years, AACC 130+ IQ) engineering rigor, persisting architectural rationales in `garfio_rationales`. Uses LiteLLM alias `garfio-worker`.

---

## 2. Network Topology & Zero Trust Security Perimeter

All components communicate over an internal Docker bridge network named `agent-net`.

```mermaid
flowchart TD
    subgraph External [External Perimeter]
        TelegramAPI["Telegram API (Bot Client)"]
        CFEdge["Cloudflare Edge (Zero Trust)"]
        GoogleAPI["Google Gmail API v1"]
    end

    subgraph Host [Docker Host: agent-net]
        CFDaemon["cloudflared (Tunnel Ingress)"]
        N8N["n8n (Workflow Engine :5678)"]
        Postgres["postgres_db (:5432)"]
        MCP["workspace-mcp (:8000)"]
        MurrayAgent["murray-agent (:8080)"]
        OpenHands["openhands (:3000)"]
    end

    CFEdge <==>|Encrypted Tunnel (Outbound Only)| CFDaemon
    CFDaemon -->|HTTP: http://n8n:5678| N8N
    TelegramAPI <==>|Single Webhook via CF| N8N
    N8N <==>|TCP: postgres_db:5432| Postgres
    N8N <==>|HTTP: http://workspace-mcp:8000| MCP
    N8N <==>|HTTP: http://murray-agent:8080| MurrayAgent
    N8N <==>|HTTP: http://openhands:3000| OpenHands
    MurrayAgent -->|Docker Socket allowlist + HITL| HostSock["/var/run/docker.sock"]
    OpenHands -->|Docker Socket runtime spawn| HostSock
    MCP <==>|HTTPS OAuth 2.0 (Draft-Only)| GoogleAPI
```

### Network Contracts & Invariants

| Service | Container Name | Internal Port | Host Port Binding | Visibility & Security Notes |
| :--- | :--- | :--- | :--- | :--- |
| `cloudflared` | `murray-cloudflared` | N/A | None | Outbound tunnel to Cloudflare Edge. Zero inbound open ports on host. Upstream origin: `http://n8n:5678` (NEVER `localhost`). |
| `n8n` | `murray-n8n` | `5678/tcp` | `127.0.0.1:5678` | Bound exclusively to localhost loopback for local dev/admin UI. Public ingress routed solely via `cloudflared`. |
| `postgres_db` | `murray-postgres` | `5432/tcp` | None | Completely isolated in `agent-net`. Accessible only by `n8n`. Image `postgres:16-alpine`. NEVER expose to `0.0.0.0`. |
| `workspace-mcp`| `murray-workspace-mcp` | `8000/tcp` | None | Completely isolated in `agent-net`. Accessible only by `n8n` and `murray-agent`. `working_dir: /tmp`. |
| `murray-agent` | `murray-agent` | `8080/tcp` | None | Completely isolated in `agent-net`. `working_dir: /tmp`. Accessible by `n8n`. Mounts `/var/run/docker.sock` behind strict allowlist. |
| `openhands` | `murray-openhands` | `3000/tcp` | `127.0.0.1:3000` | Bound exclusively to localhost loopback for local inspection UI. Mounts `/var/run/docker.sock` to spawn runner sandboxes. |

- **Security Profile**: `security_opt: ["no-new-privileges:true"]` applied to runtime containers.
- **Secret Isolation**: Secrets reside strictly in `.env` and `config/mcp-auth/.gauth.json`. NEVER commit secrets to git, print in logs, or paste in chat.

---

## 3. Container Services & Docker Compose Blueprint

The stack is declaratively defined in `docker-compose.yml`.

### Exact Service Specifications

1. **`postgres_db`**:
   - Base image: `postgres:16-alpine` (Do NOT upgrade to Postgres 17 without manual `pg_dump`; major upgrade breaks volume).
   - Volume: `postgres_data:/var/lib/postgresql/data`.
   - Healthcheck: `CMD-SHELL pg_isready -U ${POSTGRES_USER:-n8n_admin} -d ${POSTGRES_DB:-n8n_database}` (interval: 10s, timeout: 5s, retries: 5).
2. **`cloudflared`**:
   - Base image: `cloudflare/cloudflared:latest`.
   - Command: `tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}`.
   - Restarts: `unless-stopped`.
3. **`n8n`**:
   - Base image: `n8nio/n8n:latest`.
   - Critical environment variables:
     - `DB_TYPE=postgresdb`, `DB_POSTGRESDB_HOST=postgres_db`, `DB_POSTGRESDB_PORT=5432`.
     - `N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}` (Critical: loss of key corrupts encrypted credentials).
     - `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (Mandatory: required in n8n 2.x for `$env.TELEGRAM_CHAT_ID` expression evaluation).
     - `TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}`.
     - `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168` (Prunes DB executions older than 7 days).
     - `WEBHOOK_URL=https://${SUBDOMINIO_PUBLICO}/`.
   - Volumes: `n8n_data:/home/node/.n8n`, `./workflows:/opt/workflows:ro`.
   - Depends on: `postgres_db` (condition: `service_healthy`).
   - Healthcheck: `CMD-SHELL wget -q -O - http://127.0.0.1:5678/healthz || exit 1`.
4. **`workspace-mcp`**:
   - Base image: `node:20-alpine`.
   - Working Directory: `/tmp` (**CRITICAL INVARIANT**: If `working_dir` is `/opt/mcp` on a read-only bind mount `:ro`, Docker Desktop on macOS fails healthcheck/exec with exit code -1).
   - Command: `["node", "/opt/mcp/server.mjs"]`.
   - Mounts: `./config/workspace-mcp:/opt/mcp:ro`, `./config/mcp-auth:/app/auth`.
   - Environment: `GMAIL_ALLOW_SENDING=false`, `GMAIL_ALLOW_DRAFTS=true`, Google OAuth keys.
   - Healthcheck: Node fetch probe to `http://127.0.0.1:8000/healthz`.
5. **`murray-agent`**:
   - Build context: `./config/murray-agent` (Dockerfile with Node 20 + Git CLI installed).
   - Working Directory: `/tmp`.
   - Command: `["node", "/opt/agent/server.mjs"]`.
   - Security Opt: `no-new-privileges:true`.
   - Mounts:
     - `./config/murray-agent:/opt/agent:ro`
     - `./docker-compose.yml:/opt/stack/docker-compose.yml:ro`
     - `./.env:/opt/stack/.env:ro`
     - `./workspace:/opt/workspace`
     - `./RUNBOOK.md:/opt/docs/RUNBOOK.md:ro`
     - `./architecture_spec.md:/opt/docs/architecture_spec.md:ro`
     - `/var/run/docker.sock:/var/run/docker.sock`
     - `murray_agent_data:/var/lib/murray-agent`
   - Healthcheck: Node fetch probe to `http://127.0.0.1:8080/healthz`.
6. **`openhands`**:
   - Base image: `ghcr.io/openhands/openhands:latest` (Registry `docker.all-hands.dev` is obsolete/NXDOMAIN).
   - Runtime image env: `SANDBOX_RUNTIME_CONTAINER_IMAGE=ghcr.io/openhands/runtime:latest`.
   - Workspace Mount: `WORKSPACE_MOUNT_PATH=./workspace` mounted at container path `/opt/workspace_base`.
   - Mounts: `/var/run/docker.sock:/var/run/docker.sock`, `~/.openhands-state:/.openhands-state`.
   - Environment: `LLM_MODEL=deepseek/deepseek-chat`, `LLM_BASE_URL=https://api.deepseek.com/v1`, `MAX_ITERATIONS=30`.

---

## 4. Google Workspace Gateway (`workspace-mcp`): Draft-Only Guardrail

The `workspace-mcp` service is a custom lightweight Node.js HTTP server implementing strict Gmail API mediation.

### Immutable Safety Guardrails
- `GMAIL_ALLOW_SENDING=false` and `GMAIL_ALLOW_DRAFTS=true` are hardcoded invariants.
- Send Blocker: Any HTTP request directed to `/gmail/send`, `/gmail/batch-send`, or `/gmail/messages/send` is intercepted and immediately rejected with HTTP `403` and JSON `{ "error": "gmail_send_blocked" }`.
- Zero Send Implementation: `gmail-client.mjs` contains no `send()` method. The code to send email literally does not exist in the codebase.
- The human CEO must open the draft in the official Gmail client and click "Send".

### HTTP REST Contracts

1. `GET /healthz`:
   - Returns HTTP 200: `{ "status": "ok", "service": "workspace-mcp", "gmail_allow_sending": false, "gmail_allow_drafts": true, "gmail_mode": "live" | "unconfigured" }`.
2. `GET /gmail/unread`:
   - Executes query `q=is:unread`, capped at 15 messages.
   - HTTP 200: `{ "status": "ok", "unread_count": N, "messages": [{ "id", "threadId", "sender", "subject", "summary", "senderHtml", "subjectHtml", "summaryHtml", "date", "inReplyTo" }] }`.
   - HTTP 503 `gmail_oauth_missing`: Missing `GOOGLE_CLIENT_ID` or `GOOGLE_REFRESH_TOKEN`.
   - HTTP 503 `gmail_oauth_client_mismatch`: Refresh token was generated by another Client ID (e.g. Desktop client instead of Web client).
   - HTTP 503 `gmail_oauth_failed`: Token refresh failed (e.g. expired 7-day token in Testing app status).
   - **Crucial Invariant**: An empty inbox (`unread_count: 0`) with `status: ok` is a legitimate response from the live Gmail API, NOT a stub.
3. `POST /gmail/drafts`:
   - Payload: `{ "messageId"?, "threadId"?, "to"?, "subject"?, "replyBody"?, "body"?, "inReplyTo"? }`.
   - Creates a draft message via Gmail API (`users.drafts.create`). Encodes RFC 2822 email in base64url.
   - HTTP 200: `{ "ok": true, "draft": true, "sent": false, "id": "<draft_id>", "messageId": "...", "threadId": "...", "status": "created" }`.

### Google Cloud OAuth Configuration Rules
- Client Type: **Web Application** (NOT Desktop App).
- Authorized Redirect URI: `https://developers.google.com/oauthplayground`.
- Scopes: `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.compose`.
- API Enabled: **Gmail API** in Google Cloud Console (NEVER search for non-existent "Gmail MCP API").

---

## 5. Executive Conductor & Safety Orchestrator (`murray-agent`)

The `murray-agent` microservice coordinates user interaction, stack observability, and git operations within `./workspace`.

### Architecture & Persona
- **LLM Provider**: DeepSeek Chat (`deepseek-chat`) via `https://api.deepseek.com/v1`.
- **System Persona**: Murray, the talking demon skull from Monkey Island 3.
  - Tone: Pomposity, theatrical megalomania, humorous contempt for mortal flaws, paired with surgical, production-grade systems engineering excellence.
  - Language: Rioplatense Spanish with sandwich structure (theatrical hook -> dense technical facts -> ominous closure).
  - Strict Rule: Murray does NOT hallucinate changes. Murray does NOT edit `murray-infra` files. Code modifications occur exclusively in `./workspace/<slug>`.

### Deterministic Interceptors (Bypassing LLM)
To guarantee determinism, low latency, and zero token waste, key intents are intercepted in code before invoking the LLM:
- **Slash Commands**: `/status`, `/health`, `/repo`, `/workspace`, `/jobs`, `/jobs <id>`, `/triage` execute local functions directly.
- **Coding Missions**: When an active repository exists and a test command is detected (`Test: ...` or `Comando: ...`), the request immediately bypasses the LLM and issues an HITL proposal with `kind=code`.
- **Confirmation Words**: `si`, `dale`, `ok` automatically confirm the previous pending plan from session memory and generate the HITL keyboard.
- **Hallucination Suppression**: If DeepSeek responds with prose instructing the user to "Touch Approve" without issuing a formal tool call, the agent suppresses the response and outputs a structured syntax recipe (`Comando: ...`).

### Human-In-The-Loop (HITL) Protocol & State Machine
- **Callback Data Limit**: Telegram limits inline keyboard `callback_data` to **64 bytes**.
- **Token Format**: 16-character hexadecimal token (`crypto.randomBytes(8).toString('hex')`).
- **Token Format Strings**:
  - `APPROVE_OPS:<hex>` / `REJECT_OPS:<hex>` (TTL: 15 min, single-use).
  - `APPROVE_CLONE:<hex>` (Enqueues git clone job).
  - `APPROVE_CODE:<hex>` (Enqueues OpenHands coding session).
  - `APPROVE_DELETE:<hex>` (Enqueues scoped path deletion).
  - `APPROVE_PUSH:<hex>` (Enqueues git push to feature branch).
  - `STUCK_RETRY:<hex>`, `STUCK_STOP:<hex>`, `STUCK_LOGS:<hex>`, `STUCK_CHG:<hex>`.

### Docker Socket Whitelist (`ops.mjs`)
`murray-agent` mounts `/var/run/docker.sock` to control the stack, but enforces strict allowlists via `assertSafeComposeArgs`:
- **Allowed**: `ps`, `logs --tail<=80`, `restart <service>`, `up -d --force-recreate --no-deps <service>`, and `heal_openhands`.
- **Forbidden**: `down -v`, `exec`, arbitrary `kill`, arbitrary `rm`.
- **`heal_openhands` Implementation**:
  1. Inspects running containers: `docker ps -a --filter "name=oh-agent-server" --format "{{.ID}}\t{{.Names}}"`.
  2. Filters strictly for names matching `^oh-agent-server-`.
  3. Executes `docker rm -f` strictly against those container IDs.
  4. Restarts OpenHands: `docker compose restart openhands`.

### Workspace Jail & Git Constraints
- **Root Directory**: `./workspace` (`/opt/workspace` in container).
- **Symlink Jail Check**: Evaluates canonical realpaths (`fs.realpathSync`) to prevent path traversal and avoid macOS `/var` vs `/private/var` symlink bugs.
- **Autonomous Git (No HITL Required)**: `status`, `diff`, `log`, `commit`, `pull`, `checkout`.
- **Guarded Git (HITL Required)**:
  - `clone`: Shallow clone (`--depth 1 --single-branch`). Unshallows automatically on subsequent branch fetches. Token passed via HTTP auth header, NEVER exposed in URLs or logs.
  - `push`: Requires explicit HITL approval. **PUSH TO `main` OR `master` IS FORBIDDEN**. Force push (`--force`) is FORBIDDEN.
  - `delete`: Requires explicit HITL approval. Scope strictly confined to `./workspace`.

### Async Job Queue (`jobs.json`)
- Persistent asynchronous state machine:
  - States: `queued` -> `running` -> `done` | `failed` | `stuck` | `paused`.
  - Mutex Kick Guarantee: `jobs.mjs` prevents concurrent execution kicks on the same job promise, preventing duplicate sandbox spawns.
  - Timestamp Invariant: Job age and duration are computed strictly from `createdAt` (America/Montevideo timezone).

---

## 6. Autonomous Code Execution Sandbox (`openhands`)

OpenHands runs as an isolated mechanical worker container to modify code in `./workspace/<slug>`.

### OpenHands 1.11+ API Contracts
- **Health**: `GET /health` returns HTTP 200 `"OK"` (Do NOT query `/api/health` - returns the SPA HTML document).
- **Create Conversation (Start Task)**: `POST /api/v1/app-conversations` with `{ "task": "<mission_text>" }` (Do NOT query `POST /api/conversations` - returns HTTP 405 Method Not Allowed).
- **Send Follow-up Message**: `POST /api/v1/app-conversations/{id}/send-message`.
- **Search Events**: `GET /api/v1/conversation/{id}/events/search`.

### Child Sandbox Management & OOM Exit 137 Prevention
- OpenHands spins up ephemeral Docker containers named `oh-agent-server-<uuid>` using the image `ghcr.io/openhands/runtime:latest`.
- **Double Start Issue**: Triggering concurrent task creation creates duplicate `oh-agent-server` containers, rapidly exhausting host memory and triggering Docker OOM (Exit 137). The single-kick promise mutex in `murray-agent` eliminates this.
- **Zombie Cleanup**: `el_corazon_de_Murray.sh` Option 3/13 and `/triage` `heal_openhands` safely terminate orphaned `oh-agent-server-*` containers without touching core infrastructure.

### Execution State Machine Handling
- `PAUSED` with dirty working tree -> Job marked as `paused`. Notifies CEO to review git diff and commit.
- `PAUSED` with clean working tree -> Job marked as `stuck` (`sandbox_paused`). Sends HITL keyboard (Retry/Stop/Change).
- `finished` with 0 git changes and clean tree -> Job marked as `stuck` (`empty_finish`). Prevents falsely reporting completion when the agent did not touch code.
- Poll Errors: 3 consecutive network poll failures trigger `stuck` (`poll_error`).

---

## 7. Telegram HITL Router & n8n Workflows

n8n serves as the external event router and periodic cron manager.

### The Single Webhook Rule
Telegram bots can register exactly ONE webhook URL.
- **Canonical Webhook URL**: `https://ceo.threepwood.uy/webhook/4dae132d-912c-40e0-b048-c00b42e03250/webhook`.
- **Trigger Invariant**: The trigger node must explicitly specify `webhookId: "4dae132d-912c-40e0-b048-c00b42e03250"`. Pointing the webhook to the node name causes HTTP 404/500 errors in n8n 2.x.

### Telegram HTML Parse Mode Invariant
- **CRITICAL**: Every Telegram send or edit node in n8n MUST have `additionalFields.parse_mode = "HTML"`.
- Reason: The default n8n Markdown parser treats underscores (`_`) as formatting delimiters. Callback data like `APPROVE_OPS:1a2b` or `REJECT_TASK` fails with Telegram HTTP 400 (`Bad Request: can't parse entities`).

### Workflow 1: Telegram HITL Router (`workflows/telegram_hitl_router.json`)
- **Published ID**: `20uYWal9fr2bWwVV`.
- **Routing Logic**:
  1. Ingress Webhook validates sender ID == `TELEGRAM_CHAT_ID`. Drops invalid users.
  2. Freeform text messages -> `POST http://murray-agent:8080/chat`.
  3. `/oh ...` or `sandbox: ...` -> OpenHands raw keyboard dispatch.
  4. Callback `APPROVE_OPS` -> `POST http://murray-agent:8080/ops/execute`.
  5. Callback `REJECT_OPS` -> `POST http://murray-agent:8080/ops/reject`.
  6. Callbacks `_CLONE:`, `_CODE:`, `_DELETE:`, `_PUSH:`, `STUCK_` -> `POST http://murray-agent:8080/workspace/hitl`.
  7. Keyboard Construction: Reads `hitl.approve_data` and `hitl.reject_data` directly from agent responses.

### Workflow 2: Email Triage Draft (`workflows/email_triage_draft.json`)
- **Published ID**: `Z8f9K2mP1qRt5vWx`.
- **Trigger**: Cron Schedule (every 15 minutes).
- **Execution Flow**:
  1. Calls `GET http://workspace-mcp:8000/gmail/unread`.
  2. If `unread_count > 0`, splits messages.
  3. Deduplicates message IDs using workflow static data:
     ```javascript
     const staticData = $getWorkflowStaticData('global');
     staticData.processedIds = staticData.processedIds || [];
     const newMessages = items.filter(i => !staticData.processedIds.includes(i.json.id));
     ```
  4. Calls `POST http://workspace-mcp:8000/gmail/drafts` to generate drafts.
  5. Sends HTML alert to the CEO on Telegram.
  6. **Invariant**: Contains NO Telegram trigger to prevent webhook hijacking.

---

## 8. Resource Quotas & Operational Limits

- **RAM Budget Ceiling**: Total cumulative RAM across all 6 core containers MUST remain **< 4.5 GB (4608 MiB)**.
- **Normal Idle Footprint**: ~1140 MiB - 1230 MiB.
- **Memory Measurement Invariant**:
  - `docker compose stats --no-stream` outputs memory in format: `12.5MiB / 3.8GiB`.
  - When parsing with scripts, parse ONLY the first token (actual usage). Parsing `GiB` globally mistakenly parses the host limit (3.8GiB), inflating the reported usage to tens of gigabytes.
- **Database Housekeeping**:
  - n8n execution data is pruned automatically: `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168` (hours).

---

## 9. Incident Triage Matrix & Lessons Learned

| Incident | Root Cause | Diagnostic Signature | Permanent Architectural Fix |
| :--- | :--- | :--- | :--- |
| **A: Webhook Dead** | Cloudflare tunnel dropped or misconfigured. | `cloudflared` logs show connection errors. | Ensure tunnel token matches Cloudflare Zero Trust; upstream target is `http://n8n:5678`. |
| **B: Credential Decrypt Fail** | `N8N_ENCRYPTION_KEY` changed or missing. | n8n logs show encryption failure. | Restore original key in `.env`. |
| **C: OpenHands Runaway RAM** | Orphaned `oh-agent-server-*` containers. | High RAM in `docker stats`. | Run `el_corazon` Option 13 or `/triage` `heal_openhands`. |
| **D: Gmail OAuth Mismatch** | Refresh token from Desktop client vs Web client ID. | HTTP 503 `gmail_oauth_client_mismatch`. | Re-authorize in Google OAuth Playground using Web Client ID and immediate offline exchange. |
| **E: Tunnel Connect Fail** | Tunnel using placeholder token from `.env.example`. | `cloudflared` logs `Failed to get tunnel`. | Set real token in `.env` and recreate container. |
| **G: 405 on HITL Button** | Workflow calling OpenHands SPA route `/api/conversations`. | `AxiosError 405` in n8n logs. | Use API route: `POST /api/v1/app-conversations`. |
| **H: Postgres 17 Warning** | n8n warning about Postgres major version. | Log warning `Upgrade to Postgres 17`. | Invariant: Stay on `postgres:16-alpine`. Do NOT destroy volume. |
| **I: Bot Silent (No Reply)** | Telegram webhook pointing to node name. | HTTP 404 / 500 on webhook. | Register webhook using canonical `webhookId`: `4dae132d-912c-40e0-b048-c00b42e03250`. |
| **J: Reject Button 400** | Telegram node using default Markdown parser. | Telegram API error `can't parse entities`. | Enforce `additionalFields.parse_mode = "HTML"`. |
| **K: Fake 0 Unread Mails** | Historical stub returning 0 unread on missing OAuth. | `status: awaiting_oauth` in stub. | Real API returns 503 on missing OAuth; 0 unread with `status: ok` is real empty inbox. |
| **L: MCP Unhealthy** | Container `working_dir` set to `:ro` bind mount. | `docker inspect` shows exit=-1 on healthcheck. | Set `working_dir: /tmp` in `docker-compose.yml`. |
| **M: Workflow Import Fail** | Root workflow JSON missing `"id"` attribute. | Postgres error: `null value in column "id"`. | Ensure `"id"` is hardcoded at workflow root. |
| **N: Bot Sends HITL on Chat**| Router routing all text to OpenHands keyboard. | Keyboard on greeting messages. | Free text routes to `murray-agent /chat`. |
| **O: Murray 403 on Ops** | Ops executed without valid single-use token. | HTTP 403 `ops_approval_denied`. | Require valid 16-hex approval token issued within 15 min. |
| **P: Clone/Code No Action** | Router missing `/workspace/hitl` dispatch node. | Button acknowledged but no job queued. | Route `_CLONE:`, `_CODE:`, etc. to `/workspace/hitl`. |
| **R: Prosa "Tocá Aprobar"** | LLM emitted prose instead of structured tool. | Text received without inline buttons. | Interceptor recipes; enforce test command syntax. |
| **S: PAUSED Falsely Done** | Polling treated PAUSED state as completed mission. | Premature notification with incomplete code. | PAUSED checks git tree; flags stuck or requests commit. |
| **T: Sandbox OOM 137** | Duplicate job kicks spawned multiple sandboxes. | Exit code 137 in Docker logs. | Single-kick mutex in `jobs.mjs`. |

---

## 10. Step-by-Step Deterministic Recreation Recipe

Any AI assistant can recreate this exact system by executing this sequential runbook:

### Step 1: Directory Scaffolding
Create the directory structure:
```bash
mkdir -p config/murray-agent config/workspace-mcp config/mcp-auth config/cloudflared workflows workspace tests
```

### Step 2: Environment Configuration (`.env.example`)
Create `.env.example` with:
- `POSTGRES_USER=n8n_admin`
- `POSTGRES_PASSWORD=cambiar_password_seguro`
- `POSTGRES_DB=n8n_database`
- `N8N_ENCRYPTION_KEY=<random_32_hex>`
- `SUBDOMINIO_PUBLICO=ceo.threepwood.uy`
- `CLOUDFLARE_TUNNEL_TOKEN=<token>`
- `TELEGRAM_BOT_TOKEN=<token>`
- `TELEGRAM_CHAT_ID=<numeric_id>`
- `GOOGLE_CLIENT_ID=<client_id>`
- `GOOGLE_CLIENT_SECRET=<client_secret>`
- `GOOGLE_REFRESH_TOKEN=<refresh_token>`
- `DEEPSEEK_API_KEY=<deepseek_key>`

### Step 3: Implement Google Workspace MCP (`config/workspace-mcp/`)
1. Create `gmail-client.mjs`: Implements OAuth token refresh and Gmail API calls (`messages.list`, `messages.get`, `drafts.create`). Ensure NO `send()` method exists.
2. Create `server.mjs`: Exposes `GET /healthz`, `GET /gmail/unread`, `POST /gmail/drafts`. Block `/gmail/send` with HTTP 403. Set process working directory to `/tmp`.

### Step 4: Implement Murray Agent (`config/murray-agent/`)
1. Create `Dockerfile`: Based on `node:20-alpine`, installs `git`, `docker-cli`, `python3`.
2. Create `persona.md`: System prompt defining Murray (Monkey Island talking skull persona, senior sysadmin rigor, rioplatense Spanish).
3. Create `ops.mjs`: Docker Compose wrapper with strict allowlist (`ps`, `logs`, `restart`, `recreate`, `heal_openhands`).
4. Create `openhands.mjs`: REST client for OpenHands 1.11 API (`/health`, `/api/v1/app-conversations`, `/events/search`).
5. Create `workspace.mjs`: Git execution wrapper inside `./workspace/<slug>`. Enforce realpath jail. Block push to `main`/`master`.
6. Create `jobs.mjs`: Asynchronous job store (`jobs.json`) with single-kick execution mutex.
7. Create `chat.mjs`: Conversation engine integrating DeepSeek LLM, memory store (20 turns), and deterministic slash command interceptors (`/status`, `/jobs`, `/triage`).
8. Create `server.mjs`: HTTP router exposing `/healthz`, `/chat`, `/ops/execute`, `/ops/reject`, `/workspace/hitl`.

### Step 5: Declare Docker Compose (`docker-compose.yml`)
Write the Docker Compose file matching Section 3:
- Network: `agent-net` (bridge).
- Services: `postgres_db`, `cloudflared`, `n8n`, `workspace-mcp`, `murray-agent`, `openhands`.
- Enforce `working_dir: /tmp` for `workspace-mcp` and `murray-agent`.
- Mount `/var/run/docker.sock` to `murray-agent` and `openhands`.
- Mount `./workspace` to `murray-agent` (`/opt/workspace`) and `openhands` (`/opt/workspace_base`).

### Step 6: Define and Import n8n Workflows (`workflows/`)
1. Create `workflows/telegram_hitl_router.json` with ID `20uYWal9fr2bWwVV`, canonical webhook ID `4dae132d-912c-40e0-b048-c00b42e03250`, and `parse_mode: "HTML"` on all Telegram nodes.
2. Create `workflows/email_triage_draft.json` with ID `Z8f9K2mP1qRt5vWx`, 15-minute cron schedule, and static data deduplication.
3. Import into n8n via CLI:
   ```bash
   docker compose exec n8n n8n import:workflow --input=/opt/workflows/telegram_hitl_router.json --projectId=<project_id>
   docker compose exec n8n n8n publish:workflow --id=20uYWal9fr2bWwVV
   ```

### Step 7: Build Observability & Control Panel (`el_corazon_de_Murray.sh`)
Implement the single-file bash dashboard with:
- Healthcheck probes for all 6 containers.
- Layer 1 Agent Observability (`memory.json`, `session.json`, `jobs.json`).
- Layer 2 Infrastructure Observability (colored live log streaming, RAM monitor).
- Layer 3 Workflow Observability (Postgres execution history, RUNBOOK incident auto-scanner).
- Option 14: Deterministic AI blueprint export (`generate_ai_specification`).

### Step 8: Verification & Automated Testing
Execute validation suites:
- `bash tests/test_e2e_stack.sh`: Verifies Postgres, schema constraints, guardrails, and circuit breakers.
- `bash tests/check_memory_budget.sh`: Verifies total RAM footprint is strictly under 4.5 GB.
- `node --test tests/*.mjs`: Unit tests with mocked providers (no live API calls in CI).

---
*End of Authoritative Technical Blueprint — Murray Infra (1-Person CEO)*
