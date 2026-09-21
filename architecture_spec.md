# Architecture Specification (`architecture_spec.md`) — Murray Infra

Este documento define la especificación de arquitectura viva, contratos de red, políticas de seguridad y límites de recursos para el sistema **1-Person CEO** (`murray-infra`). Cumple con la directiva de sincronización de contratos estipulada en [.agents/skills/dev-protocol/documentation.md](./.agents/skills/dev-protocol/documentation.md).

Si cambia un contrato HTTP, un workflow publicado, un guardrail o un presupuesto, este archivo se actualiza **en el mismo cambio**. No es un snapshot histórico: `CHANGELOG.md` guarda el relato.

---

## 1. Topología de Red y Perímetro (Zero Trust)

Todos los contenedores operan en la red interna tipo bridge `agent-net`. Ningún servicio expone puertos a `0.0.0.0` del host, salvo amarres exclusivos a loopback local (`127.0.0.1`) para auditoría y desarrollo.

```mermaid
flowchart TD
    subgraph Internet [Perímetro Externo]
        UserTelegram["Telegram API (Bot Client)"]
        CFEdge["Cloudflare Edge (Zero Trust)"]
        GmailCloud["Google Gmail API"]
    end

    subgraph Host [Docker Host: agent-net]
        CFDaemon["cloudflared (Tunnel Ingress)"]
        N8N["n8n (Orquestador :5678)"]
        Postgres["postgres_db (:5432)"]
        MCP["workspace-mcp (:8000)"]
        MurrayAgent["murray-agent (:8080)"]
        LiteLLM["litellm (:4000)"]
        OpenHands["openhands (:3000)"]
    end

    CFEdge <==>|Túnel cifrado sin puertos entrantes| CFDaemon
    CFDaemon -->|HTTP: http://n8n:5678| N8N
    UserTelegram <==>|Webhook único vía CF| N8N
    N8N <==>|TCP 5432| Postgres
    N8N <==>|HTTP :8000| MCP
    N8N <==>|HTTP :8080 chat/ops| MurrayAgent
    N8N <==>|HTTP :3000| OpenHands
    MurrayAgent -->|HTTP :4000| LiteLLM
    OpenHands -->|HTTP host.docker.internal:4000 openai/garfio-worker| LiteLLM
    MurrayAgent -->|compose allowlist + HITL| Stack[docker.sock]
    MCP <==>|HTTPS OAuth 2.0 (Draft-Only)| GmailCloud
```

### Contratos de Red y Puertos

| Servicio | Nombre Docker DNS | Puerto Interno | Mapeo Host | Visibilidad |
| :--- | :--- | :--- | :--- | :--- |
| `cloudflared` | `cloudflared` | N/A (Outbound) | Ninguno | Red privada `agent-net`. Conexión de túnel saliente a Cloudflare. |
| `n8n` | `n8n` | `5678/tcp` | `127.0.0.1:${N8N_PORT:-5678}` | Loopback host para UI local; tráfico entrante público sólo vía `cloudflared`. Hostname público: `ceo.threepwood.uy` → `http://n8n:5678` (nunca `localhost` desde el túnel). |
| `postgres_db` | `postgres_db` | `5432/tcp` | Ninguno | Aislado en `agent-net`. Accesible únicamente por `n8n`. Imagen `postgres:16-alpine`. **No** subir a 17 sin OK humano (rompe el volumen). |
| `workspace-mcp`| `workspace-mcp` | `8000/tcp` | Ninguno | Aislado en `agent-net`. Accesible por `n8n`. HTTP Gmail API draft-only (`config/workspace-mcp/server.mjs`). |
| `murray-agent` | `murray-agent` | `8080/tcp` | Ninguno | Aislado en `agent-net`. Chat vía LiteLLM + ops allowlist. `working_dir=/tmp`. |
| `litellm` | `litellm` | `4000/tcp` | `127.0.0.1:${LITELLM_PORT:-4000}` | Gateway. Imagen `ghcr.io/berriai/litellm:v1.99.1`. Health `GET /health/liveliness`. Loopback **permisivo** (P1, `roadmap/91_PERMISSIVE_WINDOW.md`): el sandbox no resuelve DNS `litellm`. Cero keys en el YAML. |
| `openhands` | `openhands` | `3000/tcp` | `127.0.0.1:${OPENHANDS_PORT:-3000}` | Loopback host para UI local. `LLM_BASE_URL=http://host.docker.internal:4000`. `OPENAI_API_KEY` = master LiteLLM. `LLM_MODEL=openai/garfio-worker`. `WORKSPACE_MOUNT_PATH` **absoluto** (`COMPOSE_PROJECT_DIR/workspace`). |

---

## 2. Invariantes de Seguridad y Políticas de Aislamiento

1. **HITL (Human-In-The-Loop) en Telegram**:
   - Todo update valida `chat.id` / `from.id` contra `$env.TELEGRAM_CHAT_ID`. IDs no autorizados: silencio total.
   - `$env.*` exige la variable en el servicio Compose `n8n` **y** `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (n8n 2.x).
   - Un bot = **un** webhook. El trigger canónico es `https://ceo.threepwood.uy/webhook/4dae132d-912c-40e0-b048-c00b42e03250/webhook` (`allowed_updates`: `message` + `callback_query`). La ruta `.../telegram trigger/webhook` da 404 en n8n 2.38.
   - Texto libre → `POST http://murray-agent:8080/chat` (Murray contesta ya). `/oh …` o `sandbox: …` → teclado OpenHands crudo. `APPROVE_OPS:` / `REJECT_OPS:` → ops HITL. `APPROVE_CLONE:` / `APPROVE_CODE:` / `APPROVE_DELETE:` / `APPROVE_PUSH:` / `STUCK_*` → `POST http://murray-agent:8080/workspace/hitl`. Ninguno de esos pega crudo a OpenHands.
   - **Aprobar OpenHands** (`/oh` escape hatch) = `POST http://openhands:3000/api/v1/app-conversations` con el **texto original** de la misión (static data `missions[message_id]`). **Rechazar/Pausar** no llaman a OpenHands. `POST /api/conversations` es la SPA (405).
   - Teclado Murray: `hitl.approve_data` / `hitl.reject_data` (no hardcodear solo `APPROVE_OPS`).
   - Nodos Telegram send/notify: `additionalFields.parse_mode=HTML`. El default Markdown rompe `REJECT_TASK` (`_`).

2. **Guardrail *Draft-Only* en Google Workspace (`workspace-mcp`)**:
   - Variables inmutables: `GMAIL_ALLOW_SENDING=false` y `GMAIL_ALLOW_DRAFTS=true`.
   - Rutas de envío (`/gmail/send`, `/gmail/batch-send`, `/gmail/messages/send`) → `403` **antes** de tocar Gmail. No existe `send()` en `gmail-client.mjs`.
   - El envío final lo hace el operador en la UI de Gmail. Prohibido `GMAIL_ALLOW_SENDING=true`.

3. **Aislamiento del Runtime Sandbox (`openhands`)**:
   - `security_opt: ["no-new-privileges:true"]`.
   - Workspace host acotado a `./workspace` (compartido con murray-agent).
   - `MAX_ITERATIONS=30`. Health real: `GET /health` → `"OK"`. `GET /api/health` es la SPA HTML (no usarlo).
   - Follow-up: `POST /api/v1/app-conversations/{id}/send-message`. Eventos: `GET /api/v1/conversation/{id}/events/search`. `execution_status` incluye `stuck`.
   - Imagen: `ghcr.io/openhands/openhands:latest` (`docker.all-hands.dev` = NXDOMAIN).

4. **Zero Trust & Secretos**:
   - Secretos solo en `.env` y `config/mcp-auth/.gauth.json` (gitignore). Nunca en git ni en el chat.
   - OAuth Gmail: habilitar **Gmail API** (nunca “Gmail MCP API”). Cliente **Web** + Playground redirect `https://developers.google.com/oauthplayground`. Un `refresh_token` con `gmail.readonly` + `gmail.compose`.

5. **`murray-agent` (Telegram chat + conductor de coding sessions)**:
   - Chat vía LiteLLM (`/model` por chat). No edita `murray-infra`. OpenHands es el obrero en `./workspace/<slug>`. Murray corre git en ese jail: status/diff/log/pull/checkout/commit **sin HITL**; **push y delete con HITL**. Push nunca a `main`/`master`, nunca `--force`.
   - `POST /ops/execute` exige `approval_id` de un solo uso emitido por `propose_ops` / `/chat` con `needs_hitl=true` y `hitl.kind=ops`. Sin eso → `403 ops_approval_denied`.
   - Compose allowlist: `ps`, `logs --tail<=80`, `restart`, `up -d --force-recreate --no-deps` de un servicio. `heal_openhands` (HITL vía `propose_ops` **no** existe; el job `inspect` lo corre **sin** teclado si hay finding): `docker rm -f` de contenedores cuyo nombre matchea `^oh-agent-server-` + `restart openhands`. Prohibido `down -v`, `exec`, `kill`, `rm` genérico. `postgres_db` nunca auto-recreate.
   - Sandbox TTL (operativo, no HITL): al kick de un job `code` sin otro `code`/`oh_poll` `running`, purga huérfanos `oh-agent-server-*`. Watcher cada 5 min borra los de más de 30 min si no hay vuelo. No reinicia `openhands`. No reemplaza `heal_openhands`.
   - `callback_data` Telegram ≤64 bytes: `APPROVE_OPS:<16 hex>`, `APPROVE_CLONE:<16 hex>`, `APPROVE_CODE:<16 hex>`, `APPROVE_DELETE:<16 hex>`, `APPROVE_PUSH:<16 hex>`, `STUCK_RETRY:<16 hex>`.
   - Clone: solo `https://github.com` / `https://gitlab.com`, shallow `--depth 1 --single-branch`, jail bajo `./workspace`. Pull/push/otra rama: `fetch --unshallow` + fetch. Token privado en `GITHUB_TOKEN` / `GITLAB_TOKEN` (`.env`), nunca en la URL ni el chat. Author de commit: default `Murray <murray-threepwood@users.noreply.github.com>` (override `MURRAY_GIT_*`).
   - Delete: cualquier path relativo a `./workspace` (archivo, `node_modules`, un slug, o wipe). HITL. No sale del jail.
   - Dos clientes del **mismo** bot: n8n (webhook inbound) y murray-agent (`sendMessage` de progreso/stuck). Solo `TELEGRAM_CHAT_ID`.

### 2.1. Diagrama de Secuencia: Ciclo de Vida y Flujo HITL

```mermaid
sequenceDiagram
    autonumber
    actor CEO as CEO Telegram
    participant N8N as n8n
    participant Agent as murray-agent
    participant MCP as workspace-mcp
    participant OH as openhands

    Note over N8N,MCP: Triage 15 min draft-only
    N8N->>MCP: GET /gmail/unread
    MCP-->>N8N: status=ok
    opt unread_count > 0
        N8N->>Agent: POST /triage/filter
        Agent-->>N8N: new_ids
        N8N->>MCP: POST /gmail/drafts
        N8N->>Agent: POST /triage/mark-seen
        N8N->>CEO: alerta HTML
    end

    Note over CEO,Agent: Chat libre
    CEO->>N8N: texto
    N8N->>Agent: POST /chat
    alt needs_hitl ops
        N8N->>CEO: teclado approve_data
        CEO->>N8N: callback _OPS
        N8N->>Agent: POST /ops/execute
        Agent-->>N8N: reply
        N8N->>CEO: HTML
    else needs_hitl clone, code, delete o push
        N8N->>CEO: teclado approve_data
        CEO->>N8N: callback _CLONE _CODE _DELETE o _PUSH
        N8N->>Agent: POST /workspace/hitl
        Agent-->>N8N: ack job
        N8N->>CEO: HTML
        Agent->>CEO: progreso sendMessage
        opt mision codigo
            Agent->>OH: POST /api/v1/app-conversations
            Agent->>OH: GET events/search
        end
    else respuesta
        N8N->>CEO: reply HTML
    end

    Note over CEO,OH: Mision sandbox
    CEO->>N8N: /oh o sandbox:
    N8N->>CEO: teclado OpenHands
    alt APPROVE_TASK
        N8N->>OH: POST /api/v1/app-conversations mission_text
    else REJECT o PAUSE
        N8N->>CEO: Orden procesada
    end
```

---

## 3. Contratos de Interfaces y APIs

### 3.1. `workspace-mcp` (HTTP REST, Gmail API real)

Seam de prueba: `createGmailClient({ fetchImpl })` y `createWorkspaceMcpServer({ gmailClient })`. Los tests inyectan `fetch`; no pegan a Google. Producción usa `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.

Inbox vacía (`unread_count=0`, `status=ok`) **no** es stub. OAuth ausente es `503` `gmail_oauth_missing`, jamás un `unread_count=0` fingido.

- **`GET /healthz`**
  - `200`: `{"status":"ok","service":"workspace-mcp","gmail_allow_sending":false,"gmail_allow_drafts":true,"gmail_mode":"live"|"unconfigured"}`
- **`GET /gmail/unread`**
  - `200`: `{"status":"ok","unread_count":N,"messages":[{ "id","threadId","sender","subject","summary","senderHtml","subjectHtml","summaryHtml","date","inReplyTo" }]}`
  - `503`: `{"error":"gmail_oauth_missing"|"gmail_oauth_client_mismatch"|"gmail_oauth_failed","message":"..."}`
  - `502`: `{"error":"gmail_api_failed","message":"..."}`
  - Timeout saliente: 10s. Cap: 15 mensajes (`q=is:unread`).
- **`POST /gmail/drafts`**
  - Body (cualquiera alcanza): `{ "messageId"? , "threadId"? , "to"? , "subject"? , "replyBody"? , "body"? , "inReplyTo"? }`
    - `messageId` hidrata hilo/From/Subject vía `users.messages.get`.
    - `body` es alias de `replyBody`. Vacío → placeholder draft-only (no send).
  - `200`: `{"ok":true,"draft":true,"sent":false,"id":"<gmail draft id>","messageId":"...","threadId":"...","status":"created"}`
  - `403`: `GMAIL_ALLOW_DRAFTS=false`
  - `500` `guardrail_violation`: si `GMAIL_ALLOW_SENDING=true` (el proceso igual no envía)
- Rutas send: `403` `{"error":"gmail_send_blocked",...}` sin llamar al client.

### 3.1b. `murray-agent` (HTTP REST, DeepSeek + ops HITL + workspace)

Seam: `createMurrayAgentServer({ engine })`, `createChatEngine({ ops, llm, coding, ... })`, `createCodingSession({ workspace, jobs, openhands, ops, llm, operatorInbox })`. Tests mockean `llm.complete`, `ops.runCommand` y `gitRun`. Cero DeepSeek/GitHub vivos en unit tests.

- **`GET /healthz`**: `200` `{"status":"ok","service":"murray-agent","model":"deepseek-chat"}`
- **`POST /chat`**: `{ chat_id, text, message_id? }`
  - `200`: `{ reply, replies, parse_mode:"HTML", needs_hitl, hitl?, needs_job?, job_id? }`
  - Slash sin LLM: `/status` (alias `/estado`), `/health`, `/logs <servicio>`, `/repo`, `/workspace`, `/jobs`, `/jobs <id>`, `/triage`, `/model`, `/roadmap`, `/push`, `/pull`, `/commit`, `/diff`
  - `/jobs`: últimos 20 jobs del chat (id, type, status, start HH:MM America/Montevideo, duración desde `createdAt`, slug, error). `/jobs <id>` acepta id Murray (16 hex) o UUID OpenHands (32 hex): detalle + snapshot live (`sandbox`/`exec`). Edad **no** usa `updatedAt`. Solo lectura, sin HITL. "estado de los jobs" lista. UUID pegado o «en qué quedó task <hex>» **no** dumpan el job: encolan `inspect`.
  - `/triage` / «qué pasa» / «qué pasó» / «en qué andas murray» / «diagnosticá»: ACK job `inspect` (dump redacted + `llm.complete` sin tools + auto-ops allowlist). Cero JSON de eventos. Telegram **terminal** al terminar. Sandboxes con `execution_status === 'finished'` (estado normal post-misión) o jobs stuck viejos ya superados por ejecuciones terminadas **no** activan falso `heal_openhands` ni reinicios. Hallazgos que no entran en allowlist → `operator-inbox/YYYY-MM-DD.md` + `operator_notes`. `propose_ops` del LLM **no** incluye `heal_openhands`.
  - `/estado` (o «qué hizo garfio», «qué hiciste», «qué hay hecho»): `repo_status` sin LLM. Informa repo activo, rama actual, último commit (hash, autor, mensaje), tickets resueltos vs pendientes (`roadmap/tickets/*.md`), y diff/commits pendientes de push. Si `commitsAhead > 0`, adjunta inmediatamente el teclado HITL `[ 🚀 Aprobar Push & Abrir PR ] [ ❌ Rechazar ]` con `hitl.kind = 'push'`.
  - `/roadmap` (o «qué hay para hacer», «tickets pendientes»): `roadmap` sin LLM. Lista tickets del roadmap con estado (COMPLETADO si está en log de commits o rama activa, PENDIENTE en caso contrario).
  - Rationale de Garfio: `extractGarfioRationale` extrae la síntesis técnica desde `FinishAction.message` (OpenHands v1) y `event.thought`, soportando cabeceras markdown flexibles. Si Garfio concluyó con éxito, Telegram recibe el resumen técnico del commit y cambios.
  - Finalización de misión de código: si `commitsAhead > 0`, `handlePollJob` adjunta automáticamente el teclado HITL inline `[ 🚀 Aprobar Push & Abrir PR ] [ ❌ Rechazar ]`. Al tocar Aprobar, `handlePushJob` ejecuta `git push origin HEAD`, llama a GitHub REST API (`POST /repos/:owner/:repo/pulls` o recupera el existente si 422), y notifica a Telegram con el enlace directo al Pull Request.
  - Autenticación Git GitHub: `http.extraHeader` usa `Authorization: Basic <base64(x-access-token:token)>` (Git Smart HTTP en github.com rechaza Bearer puro con 128). `ensureHistory` asegura `remote.origin.fetch = +refs/heads/*:refs/remotes/origin/*` para soportar tracking de ramas creadas en clones `--single-branch`.
  - Clone sin URL, mutate sin repo activo, o delete sin path: pregunta, no HITL, no LLM
  - Misión de código con repo activo + comando de test extraíble (`Comando: …` / `Test: …` / `corré npm test`): intercept HITL `kind=code` **sin LLM**. Mutación sin comando (p. ej. `creá el test`) no va al LLM: receta Murray (`Comando:`).
  - `si` / `dale` / `ok` con repo activo confirma el plan previo (último assistant o `lastTestCommand`) y arma HITL. `seguí` / `retomá` / `seguí con L01` igual, desde `lastMission`. Sin plan recuperable, o «no me da los botones»: receta Murray, `needs_hitl=false`.
  - Copy que pide Aprobar / `propose_code_mission` / botón Aprobar **sin** `needs_hitl=true` + `hitl.approve_data` es inválida. `/chat` recupera HITL si el texto del LLM trae comando de test; si no, receta Murray (nunca «Tocá Aprobar» en prosa).
  - `/push` o «pusheá» / «hacé push» / «git push» genera teclado HITL `kind=push` si `commitsAhead > 0`. `\bpush\b` suelto en status no es `propose_push`.
  - `needs_hitl=true` + `hitl.approval_id` (16 hex) + `hitl.kind` (`ops`|`clone`|`code`|`delete`|`push`) + `hitl.approve_data`/`reject_data`
  - Jobs `oh_poll`: Telegram al pausar, trancar o terminar (aunque `MURRAY_TELEGRAM_QUIET=1`; el quiet solo tapa progreso). `sandbox_status=PAUSED` + `execution_status` vacío **no** es done. Working tree sucio → status `paused` + aviso de commit; limpio → stuck HITL `sandbox_paused`. `finished` + git vacío + árbol limpio **y cero commits ahead de main** → stuck `empty_finish`. `finished` + commits locales sin pushear → misión lista, aviso explícito de que GitHub no los tiene. Reloj de 12 min no corta si sandbox `RUNNING` (tope 4 h). Tres fallos HTTP de poll → stuck `poll_error:…`. `kick` en vuelo se reusa (no segundo `startConversation`). ≥2 `oh-agent-server` running → code job `sandbox_busy`.
- **`POST /ops/execute`** y **`POST /ops/reject`**: `{ approval_id }` solo `kind=ops`
  - `action=restart|recreate` exige `service` allowlist
  - `action=heal_openhands`: lista `docker ps -a --filter name=oh-agent-server`, `rm -f` solo IDs cuyo **nombre** es `oh-agent-server-*`, después `compose restart openhands`. El job `inspect` lo invoca directo (P12, sin HITL). `propose_ops` nunca tiene ese action. `/ops/execute` sigue exigiendo `approval_id` si alguien emitió HITL ops.
  - TTL de sandboxes: hook al kick `code` + watcher 5 min / 30 min. Mismo regex. El watcher no hace `restart openhands`.
  - `200` con `reply` HTML
  - `403` `ops_approval_denied` si falta, está usado, venció (~15 min) o el kind no es ops
- **`POST /workspace/hitl`**: `{ callback_data, chat_id }`
  - Responde HTTP 200 en <50ms una vez asentada la orden en SQLite WAL (`jobs`), evitando timeouts 504 y Double Kicks por reintentos de webhook
  - Clone/code/delete/push approve → encola job, `needs_job=true` (el webhook no espera `git clone`, `rm`, `git push` ni OpenHands)
  - Pull/checkout también son jobs (pueden unshallow); no piden HITL
  - Reject no clona, no borra, no pushea ni llama OpenHands
  - `STUCK_RETRY|STOP|LOGS|CHG:<hex>`
  - `403` si el token HITL no vale o ya fue consumido
- **`POST /triage`** (y `GET /triage`): `{ chat_id?, job_id? }`
  - Responde HTTP 200 en <50ms asentando job `inspect` en SQLite WAL (`jobs`), con `needs_job=true` y `job_id`
  - Desacopla inspecciones profundas de Docker y LLM, eliminando timeouts HTTP 504 de Telegram
- **`POST /triage/filter`**: `{ ids: string[] }` → `{ new_ids }` (orden de entrada, dedup). `ids` no-array → `400` `ids_required`.
- **`POST /triage/mark-seen`**: `{ message_id, thread_id? }` upsert en `seen_emails`. `message_id` vacío → `400` `message_id_required`.
- Gmail vía tool: solo `{ http, status, error, unread_count }`. Cero `messages`/`subject`.
- Tool `list_seen_emails`: `{ count, emails: [{ message_id, processed_at }] }` del día civil America/Montevideo. Cero subject/sender. No pega a `/gmail/unread`.
- n8n `Consultar Murray` timeout **45s**. Clone/misión/inspect largos van por jobs + `sendMessage`.

### 3.2. `n8n` Workflows & Triggers

Import: `n8n import:workflow --input=... --projectId=RtVLhOyjbwQ3l5th` (no combinar `--userId` y `--projectId`). Después `n8n publish:workflow --id=...` y `docker compose restart n8n`. `--activeState=fromJson` no activa en este deploy.

- **Telegram HITL Router** (`workflows/telegram_hitl_router.json`, id publicado `20uYWal9fr2bWwVV`):
  - Trigger con `webhookId` `4dae132d-912c-40e0-b048-c00b42e03250`. Sin ese campo: 500 `reading 'node'`.
  - Credencial Telegram: nombre `Telegram account` (id vivo `9IhWvhoAHuzho5J5`).
  - Texto libre → `POST http://murray-agent:8080/chat`. `/oh` o `sandbox:` → teclado OpenHands + `staticData.missions`.
  - `APPROVE_OPS` → `POST http://murray-agent:8080/ops/execute`. `REJECT_OPS` → `/ops/reject`. No OpenHands.
  - `_CLONE:` / `_CODE:` / `_DELETE:` / `_PUSH:` / `STUCK_` → `POST http://murray-agent:8080/workspace/hitl`. No OpenHands.
  - Teclado Murray: `callback_data` = `{{ $json.hitl.approve_data }}` / `reject_data`.
- **Email Triage Draft** (`workflows/email_triage_draft.json`, id publicado `Z8f9K2mP1qRt5vWx`):
  - Schedule 15 min → `GET http://workspace-mcp:8000/gmail/unread` → IF `unread_count > 0` → `POST http://murray-agent:8080/triage/filter` → solo `new_ids` → split → `POST /gmail/drafts` → (solo 2xx) `POST /triage/mark-seen` → notify Telegram HTML.
  - `workspace-mcp` es stateless: no guarda vistos. La memoria es `seen_emails` en `murray.db`.
  - **No** lleva `telegramTrigger` (no se puede robar el webhook del HITL).
  - **No** crea drafts si `new_ids` está vacío. Mark-seen usa el id del mail, no el del draft.
  - Misma credencial Telegram. El clic de envío sigue siendo Gmail, no el bot. Import/publish es H14 (humano).

### 3.3. Proveedor LLM y Orquestación de Agentes

- **Gateway**: `litellm` en `agent-net` (`http://litellm:4000`) para Murray. OpenHands sandbox **no** está en esa red: usa `http://host.docker.internal:4000` (loopback publicado). Cero `api.deepseek.com` en Murray/OpenHands.
- **Alias**: `garfio-worker` (OpenHands default) y `murray-chat` (Murray si `active_model` vacío). `murray-worker` sigue existiendo en el YAML. También `openai/garfio-worker` y `openai/deepseek-chat`. Primario `deepseek/deepseek-chat`. Fallback: `gemini/gemini-3.8-flash` → `gemini/gemini-2.5-flash-lite`.
- **Prefijo OpenHands**: el SDK llama a LiteLLM *como cliente*, no como proxy. Hay que mandar `openai/<alias>` (`LLM_MODEL` y `llm_model` de `POST /api/v1/app-conversations`). Murray lo normaliza en `openHandsLlmModel()`. Un alias pelado (`deepseek-chat`) → `BadRequest` / job `stuck` `error`. Trasplantar cerebro (`/garfio model`) guarda el alias sin prefijo; el cliente lo agrega al disparar.
- **Sandbox ≠ agent-net**: `oh-agent-server-*` nace en Docker `bridge`. No resuelve `litellm`. `LLM_BASE_URL` tiene que ser `http://host.docker.internal:4000` **y** LiteLLM tiene que estar publicado en loopback. `./workspace` relativo en `WORKSPACE_MOUNT_PATH` deja el sandbox sin bind (solo un `.git` dummy). Contrato: `assertSandboxReachableLlmBaseUrl()`.
- **OPENAI_API_KEY**: con modelo `openai/…` el SDK del sandbox ignora `LLM_API_KEY` y exige `OPENAI_API_KEY`. Murray manda **solo** `secrets.OPENAI_API_KEY` en el POST de alta (`conversationSecrets()`). Un secreto `LLM_*` explota: `Secret name 'LLM_API_KEY' starts with reserved prefix 'LLM_' and cannot be used` → job `start_error`.
- **HITL bypass permisivo y notificaciones terminales**: `MURRAY_HITL_BYPASS=code,clone` (default compose de la ventana 91). Push/delete/ops siguen con teclado. `MURRAY_TELEGRAM_QUIET=1` silencia el sondeo redundante de progreso; toda resolución final (`done`/`failed` de pull, checkout, push, delete, clone) y tranca/pausa emite con `terminal: true` para llegar al CEO.
- **Modo Mal Manager (`/malmanager`)**: Monitoreo periódico del avance de Garfio en misiones de código. Opciones: `30s`, `1m` (default al activar), `2m`, `5m`, `10m`, `30m`, `off`. Persiste en `session_context.micromanage_interval`. Despacha reportes concisos y esquemáticos (sin paredes de texto) en cada intervalo cumplido con `terminal: true`. En lenguaje natural: «mirar por el hombro lo que hace garfio como mal manager» o consulta on-demand «¿en qué anda garfio?».
- **Modelos `/model`**: `deepseek-chat`, `deepseek-reasoner`, `gemini-3.8-flash`, `gemini-2.5-flash-lite`. Se guardan en `session_context.active_model` por chat. OpenHands no lee `active_model`; usa `session_context.garfio_model` (default `garfio-worker`). Cero Pro en default/fallback.
- **`GEMINI_API_KEY`**: Google AI Studio. No reusar `GOOGLE_REFRESH_TOKEN` / `GOOGLE_CLIENT_SECRET`. H13 (humano) pega las keys.
- Tests de LLM: no llamar APIs vivas por default (mocks / fixtures). `/status` live no usa LLM.

---

## 4. Persistencia y Volúmenes

| Volumen / Ruta Host | Destino en Contenedor | Propósito |
| :--- | :--- | :--- |
| `postgres_data` (Docker Named Volume) | `/var/lib/postgresql/data` | Persistencia transaccional de `n8n`. Major 16; no migrar a 17 sin OK. |
| `n8n_data` (Docker Named Volume) | `/home/node/.n8n` | Claves criptográficas locales y configuraciones de `n8n`. |
| `./workflows` (Bind Mount, RO) | `/opt/workflows:ro` | JSON versionado. El mount **no** recarga flujos publicados. |
| `./config/workspace-mcp` (Bind Mount, RO) | `/opt/mcp:ro` | `server.mjs` + `gmail-client.mjs`. **`working_dir` del contenedor es `/tmp`**, no `/opt/mcp`: un cwd sobre bind `:ro` hace que Docker Desktop mate healthcheck/`compose exec` (`exit=-1`) aunque el proceso HTTP siga vivo. |
| `./config/mcp-auth` (Bind Mount) | `/app/auth` | `.gauth.json` OAuth (gitignore). |
| `./config/murray-agent` (Bind Mount, RO) | `/opt/agent:ro` | Chat/ops/coding HTTP. **`working_dir=/tmp`**. |
| `./config/litellm/config.yaml` (Bind Mount, RO) | `/app/config.yaml:ro` | Modelos y fallbacks. Cero API keys en el YAML. |
| `./workspace` (Bind Mount) | murray-agent `/opt/workspace`; openhands `/opt/workspace_base` | Repos clonados (un slug por repo). Writable. No es murray-infra. |
| `murray_agent_data` | `/var/lib/murray-agent` | `murray.db` SQLite WAL (`MURRAY_DB_PATH`). Tablas: `jobs`, `hitl_tokens`, `session_context`, `seen_emails`. JSON `jobs.json` / `memory.json` / `session.json` se migran one-shot si la tabla está vacía y se renombran a `*.migrated`. Postgres sigue siendo solo de n8n. |

---

## 5. Presupuesto de Recursos y Capacidad

- **Memoria RAM Total del Stack**: **< 4.5 GB** para los 7 contenedores (incluye `litellm`). `docker stats` MemUsage es `12.5MiB / 3.8GiB`: parsear **solo el uso** (primer token). Medir con `docker compose stats`.
- **Monitoreo**: [tests/check_memory_budget.sh](./tests/check_memory_budget.sh).
- **Ejecuciones n8n**: `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168`.
