# Changelog

## 0.1.24 — Corrección de Falso Positivo DELETE_INTENT y Extracción de Pytest

- **Corrección de Regex en DELETE_INTENT (`intent.mjs`)**:
  - Se ancló estrictamente `DELETE_INTENT` a comandos destructivos dirigidos al workspace (`borrá todo el workspace`, `eliminá <path>`).
  - Previene que mensajes de refactor o code reviews con palabras como *«eliminá la función»* o *«borraba micro-gaps»* sean secuestrados por el flujo de borrado de disco con la respuesta errónea *«¿Qué borro bajo ./workspace?»*.
- **Extracción Resiliente de Tests (`intent.mjs` & `coding.mjs`)**:
  - Soporte para ejecutores bare `pytest <path>` sin prefijo obligatorio `uv run`.
  - Soporte para comandos delimitados por backticks (`` `pytest ...` ``).
  - Filtrado de sufijos conversacionales en español (*«... dé verde posta, y volvé a subir»*).
  - `recoverCodeHitl` ahora preserva el texto de la instrucción del usuario en lugar de sustituirla por la misión previa cuando el mensaje no es una afirmación corta.

- **Apertura Automática de Pull Requests (Opción B)**:
  - Implementado `createOrGetPullRequest` en `workspace.mjs`: integración con GitHub REST API v3 (`POST /repos/:owner/:repo/pulls`).
  - Generación de título y descripción Markdown estructurada del PR con ticket, hash de commit, comando de test verificado y bitácora técnica de Garfio.
  - Idempotencia total: ante respuesta `422` (PR ya existente), consulta automáticamente y recupera el PR abierto.
  - Al completar el push (`handlePushJob`), Murray notifica a Telegram con el enlace clickeable directo: `<a href="https://github.com/.../pull/X">#X título</a>`.
- **Botón Directo de Aprobación al Terminar Misión**:
  - `handlePollJob` en `coding.mjs`: tan pronto como Garfio finaliza una misión con tests pasados y commits locales pendientes, adjunta inmediatamente el teclado inline `[ 🚀 Aprobar Push & Abrir PR ] [ ❌ Rechazar ]`.
- **Autenticación Git Smart HTTP en GitHub**:
  - Corregido `tokenEnvForHost` en `workspace.mjs`: Git Smart HTTP sobre HTTPS en `github.com` rechaza tokens Bearer con exit code 128. Se implementó `Authorization: Basic base64(x-access-token:token)`, permitiendo operaciones push/fetch desatendidas.
  - Configuración de refspec estándar `remote.origin.fetch = +refs/heads/*:refs/remotes/origin/*` en `ensureHistory`, permitiendo seguimiento de ramas creadas en repos clonados con `--single-branch`.

## 0.1.22 — Diagnóstico Forense Garfio + /estado, /roadmap y Push HITL

- **Diagnóstico Forense de Garfio (TK-01)**:
  - Se determinó que Garfio finalizó exitosamente TK-01 en 23 minutos (commit `e209b4e` en `feat/tk01-numerical-purity`), pero por diseño HITL nunca pushea a GitHub sin confirmación humana.
  - Se corrigió `extractGarfioRationale` en `openhands.mjs`: OpenHands v1 ubica el mensaje final en `event.action.message` (FinishAction) o `event.thought`, antes omitido por buscar únicamente `event.payload.content`. Ahora extrae y formatea el resumen técnico completo para Telegram.
  - Corrección de falsos positivos en `inspect.mjs`: un sandbox con `execution_status === 'finished'` (estado MISSING esperado post-ejecución) y jobs `stuck` viejos ya superados ya no provocan reinicios innecesarios de `openhands`.
- **Comandos Telegram y Ruteo de Intención (`/estado`, `/roadmap`, `/push`)**:
  - Implementado `/estado` (alias `/status` o «qué hizo garfio», «qué hiciste», «qué hay hecho») para inspeccionar el repo activo, rama actual, último commit realizado por Garfio, tickets resueltos vs pendientes, y si hay commits locales pendientes de push.
  - Si el repo tiene commits locales pendientes de subida (`commitsAhead > 0`), `/estado` adjunta automáticamente el teclado HITL `[ Aprobar PUSH ] [ Rechazar ]` para que el usuario pueda autorizar el push en un toque.
  - Implementado `/roadmap` (o «qué hay para hacer», «tickets pendientes») para listar todos los tickets en `roadmap/tickets/*.md` categorizados como `[COMPLETADO]` o `[PENDIENTE]` basándose en el historial de git.
  - Habilitados los comandos de barra `/push`, `/pull`, `/commit`, `/diff`, `/estado`, `/roadmap` en `chat.mjs:parseSlash` y `/help`.
  - Corregido `packHitl` en `reply.mjs` para respetar `{ rawHtml: true }` y evitar el doble escape de etiquetas HTML como `<b>` y `<code>`.

## 0.1.21 — Modo Mal Manager + Notificaciones Terminales de Git

- **Notificaciones Terminales**: Corregido bug donde `pull`, `checkout`, `push` y `delete` finalizaban en silencio por omisión de `terminal: true` ante `MURRAY_TELEGRAM_QUIET=1`. Ahora avisan de inmediato en Telegram al terminar o fallar.
- **Modo Mal Manager (`/malmanager`)**: Monitoreo periódico del avance de Garfio mientras corre una misión de código en el sandbox OpenHands.
  - Intervalos soportados: `30s`, `1m` (default al activar), `2m`, `5m`, `10m`, `30m`, `off`. Persiste en `session_context.micromanage_interval`.
  - Reporte esquemático anti-pared de texto con archivo tocado, último comando con exit code, foco de pensamiento y comentario sarcástico de Murray.
  - Activación por comando (`/malmanager`, `/mirar`, `/verbose`) o lenguaje natural («mirar por el hombro lo que hace garfio como mal manager»).
  - Soporte de consulta inmediata on-demand («¿en qué anda garfio?»).

## 0.1.20 — Inspect profundo + operator-inbox

- «qué pasó» / `/triage` / «en qué andas murray» encolan un job `inspect` (n8n 45s): snapshot redacted → JSON del modelo → auto-fix allowlist (retry, heal, restart/recreate **sin** postgres) **sin teclado**.
- `/jobs` crudo no cambia. Tareas humanas en `operator-inbox/` + tabla `operator_notes`. Murray no commitea el inbox ni edita murray-infra.
- Relajo P12 en `roadmap/91_PERMISSIVE_WINDOW.md`. Fase viva: `roadmap/11_SELF_INSPECT.md`.

## 0.1.19 — Conductor de Garfio no abandona una misión viva

- Timeout de 12 min **no** aplica si el sandbox sigue `RUNNING` (tope duro 4 h).
- `finished` con árbol limpio y commits ahead es misión lista, no `empty_finish`.
- `oh_poll` `queued` cuenta como vuelo: el TTL no mata el sandbox a mitad de faena.
- `MURRAY_TELEGRAM_QUIET` silencia progreso; pausa / tranca / fin sí suenan.

## 0.1.18 — Secrets de Garfio sin prefijo LLM_

- Causa: `POST /api/v1/app-conversations` con `secrets.LLM_API_KEY` → OpenHands 1.36 `validate_secret_name` → start-task ERROR → poll `start_error`.
- `conversationSecrets()` manda solo `OPENAI_API_KEY`. El sandbox sigue tomando la key por `OH_AGENT_SERVER_ENV` (P10).

## 0.1.17 — Sandbox de Garfio alcanza LiteLLM y el repo

- Causa: `oh-agent-server` en Docker `bridge` no resuelve `litellm`, no tenía `OPENAI_API_KEY`, y `WORKSPACE_MOUNT_PATH=./workspace` no montaba `./workspace`. El poll quedaba `stuck`/`error` a los pocos segundos.
- LiteLLM sale a `127.0.0.1:4000`. OpenHands usa `host.docker.internal` + `OPENAI_API_KEY`. Mount absoluto + `SANDBOX_VOLUMES`.
- `MURRAY_HITL_BYPASS=code,clone` y `MURRAY_TELEGRAM_QUIET=1` (ventana permisiva, inventario en `roadmap/91_PERMISSIVE_WINDOW.md`).

## 0.1.16 — OpenHands habla OpenAI-compat al proxy

- `LLM_MODEL=openai/garfio-worker`. El SDK de OpenHands exige el prefijo `openai/` o muere con `LLM Provider NOT provided`.
- `openHandsLlmModel()` prefixea el cerebro de Garfio al crear la conversación. Reintentar un `stuck`/`error` arranca misión limpia, sin follow-up a la conversación muerta.

## 0.1.15 — Carta Gemini: 3.8 Flash y 2.5 Flash-Lite

- `/model` admite `gemini-3.8-flash` y `gemini-2.5-flash-lite`. Sale `gemini-2.5-flash`.
- Fallback LiteLLM: DeepSeek → 3.8 Flash (gratis/superior) → 2.5 Flash-Lite (barato). Cero Pro en default.

## 0.1.14 — Exportación de blueprint y especificación determinista para IA

- Opción 14 agregada a `el_corazon_de_Murray.sh` con submenú interactivo (visualización en pager, guardado en `MURRAY_SYSTEM_BLUEPRINT_FOR_AI.md`, copia al clipboard de macOS con `pbcopy` y volcado directo).
- Soporte de flags CLI (`--export-spec`, `--spec`, `--ai-spec`, `--ai-blueprint`, `14`) para piping a stdout.
- Blueprint arquitectónico y de implementación completo redactado en inglés (10 secciones): invariantes Zero Trust, contratos Compose de 6 servicios, guardrail Draft-Only en Gmail, orquestador DeepSeek con jail git y tokens HITL ≤64b, lifecycle OpenHands 1.11 (`oh-agent-server-*`), router n8n (`parse_mode=HTML`), matriz de triage y runbook determinista de recreación paso a paso.

## 0.1.13 — Triage del obrero y cortes de doble sandbox

- `/triage` y «qué pasa» (sin LLM) diagnostican sandboxes `oh-agent-server-*`, OOM 137, doble start y git vacío. Si hay que sanar: HITL `heal_openhands` (purga solo esos nombres + restart `openhands`). `propose_ops` del LLM no puede inventar ese action.
- El worker de jobs no relanza un `kick` en vuelo: dos arranques de OpenHands en el mismo job ya no pasan. `finished` con git vacío es `empty_finish`, no «misión lista». ≥2 sandboxes vivos → `sandbox_busy`.
- El panel `el_corazon_de_Murray.sh` lista y purga `oh-agent-server-*` (ya no el ancestor `runtime` fantasma).

## 0.1.12 — Conductor: aviso al pausar/trancar/terminar

- OpenHands `sandbox PAUSED` ya no se finge «misión lista». Árbol sucio → Telegram de pausa + commit; limpio o sin archivo → stuck HITL (Reintentar/Parar).
- Murray avisa solo cuando el obrero pausa, se tranca o termina. Tres fallos de poll (el «error: 23» de ruido) marcan stuck; uno suelto no.
- «qué pasó», UUID de 16 o 32 hex y `/jobs <id>` diagnostican sin LLM. «seguí con L01» / «retomá» re-arman HITL desde `lastMission`.

## 0.1.11 — Confirmar plan de código y receta si te trancás

- `si` / `dale` / `ok` confirma el plan previo (memoria o `Test:`/`Comando:`) y arma teclado HITL de verdad.
- Mutación sin comando de test y prosa «necesito que apruebes» ya no se van a DeepSeek a pedir la tarjeta: o HITL recuperado, o receta Murray (`Comando:`, no `Test:`, no `push` suelto, job al aprobar, `/jobs`).
- `Test:` extrae `cd … && uv run pytest`. `push permitido` ya no se lee como pusheá.

## 0.1.10 — Reloj de start en /jobs

- `/jobs` muestra hora de arranque (America/Montevideo) y duración desde `createdAt`. El poll de OpenHands ya no disfraza un job de 8m como «2s».

## 0.1.9 — Estado de jobs por Telegram

- `/jobs` y «estado de los jobs» listan la cola async (clone/code/pull/push/delete/checkout/oh_poll): status, error, edad. `/jobs <id>` muestra las últimas 20 líneas del log del job. Sin LLM, sin HITL.
- Murray ofrece `/jobs` en una línea cuando encola trabajo.

## 0.1.8 — Teclado HITL de código sin depender del LLM

- Misión de código con repo activo + `Comando:` / `corré npm test` arma HITL `kind=code` en intercept, sin DeepSeek.
- `/chat` descarta prosa «Pido Aprobar» / «Tocá Aprobar» si no hay `needs_hitl=true` (n8n no pinta teclado con texto plano).

## 0.1.7 — Panel de control y observabilidad local (el_corazon_de_Murray.sh)

- Panel de control y observabilidad interactivo CLI en un único script autónomo (`el_corazon_de_Murray.sh`), 100% self-hosted en consola.
- Capa 1: Observabilidad del agente (memoria viva de chat `memory.json`, sesión de código `session.json`, jobs async `jobs.json`, ping interactivo a `/chat` y sandboxes de OpenHands).
- Capa 2: Observabilidad de infraestructura (sondeo de salud en tiempo real, streaming de logs coloreado con sed, monitor de presupuesto de memoria RAM < 4.5 GB).
- Capa 3: Observabilidad de workflows y errores (auditoría de ejecuciones de n8n en Postgres y escáner automático de incidentes de RUNBOOK.md).
- Menú de limpiezas granulares (workspace, memoria de Murray, sandboxes huérfanos, rebuilds y reset total).

## 0.1.6 — Git de dev + borrar ./workspace

- Murray lista y borra paths bajo `./workspace` (HITL `APPROVE_DELETE`). Jail realpath; wipe del mount, no de murray-infra.
- Git en el repo activo: status/diff/log/pull/checkout/commit sin HITL; push con `APPROVE_PUSH`. Nunca force ni `main`/`master`. Clone sigue shallow; pull/push hacen unshallow.
- Author de commit default: `Murray <murray-threepwood@users.noreply.github.com>`. `GITHUB_TOKEN` (PAT repo) para clone privado y push. Router: `_DELETE:` / `_PUSH:` → `/workspace/hitl`.

## 0.1.5 — Coding sessions por Telegram (clone + Q&A + OpenHands obrero)

- Murray clona (HITL) repos https GitHub/GitLab en `./workspace`, responde preguntas (tree/read/grep) y dispara misiones de código a OpenHands con HITL.
- Jobs async + `sendMessage` del mismo bot (progreso / stuck + opciones). Cero git push. Cero edición de `murray-infra`.
- OpenHands: health `GET /health`; follow-up `send-message`. Router: `/workspace/hitl` para `_CLONE:` / `_CODE:` / `STUCK_`.
- Privados: `GITHUB_TOKEN` / `GITLAB_TOKEN` en `.env`.

## 0.1.4 — Murray por Telegram (chat + ops HITL)

- Servicio `murray-agent`: DeepSeek chat, `/status` `/health` `/logs`, Gmail meta sin asuntos, compose allowlist.
- Router Telegram: texto libre → Murray. `/oh` y `sandbox:` → OpenHands con el texto original. `APPROVE_OPS` no pega a OpenHands.
- `POST /ops/execute` exige `approval_id` de un uso. Cero send de Gmail.

## 0.1.3 — Healthcheck MCP + lecciones OAuth

- `workspace-mcp` usa `working_dir: /tmp` (el bind `/opt/mcp:ro` como cwd dejaba `unhealthy` falso y rompía `compose exec`).
- Lecciones: trampas OAuth Playground, refresh token ~7 días en app Testing, secretos nunca en chat, import n8n exige `"id"` raíz.
- `PROGRESS.md` deja de listar el mismatch OAuth como bloqueo: Gmail live, triage Active.

## 0.1.2 — Gmail API draft-only (workspace-mcp)

- El shim deja de fingir `unread_count=0` / `awaiting_oauth`. `GET /gmail/unread` y `POST /gmail/drafts` hablan Gmail API. Cero send.
- Inbox vacía: `status=ok`. OAuth ausente: `503 gmail_oauth_missing`.
- `email_triage_draft`: split + dedup + draft + Telegram HTML. Sin Telegram Trigger (un bot = un webhook).
- `architecture_spec.md` pasa a ser contrato vivo (ya no documenta el stub).

## 0.1.1 — HITL Telegram vs OpenHands 1.11

- `telegram_hitl_router`: Rechazar/Pausar no llaman a OpenHands. Aprobar pega `POST /api/v1/app-conversations`.
- n8n 2.x: `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` para que `$env.TELEGRAM_CHAT_ID` funcione.
- Tests: `tests/test_hitl_dispatch.py` y `tests/test_live_hitl_dispatch.sh`.

## 0.1.0 — Stack 1-Person CEO (local)

- Compose con `postgres_db`, `cloudflared`, `n8n`, `workspace-mcp` y `openhands` en `agent-net`.
- Guardrail Gmail draft-only en Compose y en el shim HTTP `config/workspace-mcp/server.mjs` (el paquete npm del roadmap no está publicado).
- Workflows n8n: `telegram_hitl_router` y `email_triage_draft`.
- Suite `tests/test_e2e_stack.sh` (Postgres, schemas, guardrails, circuit breaker, RAM < 4.5 GiB).
- Imagen OpenHands: `ghcr.io/openhands/openhands:latest` (el registry `docker.all-hands.dev` ya no resuelve).
- Guía de operador: `roadmap/99_HUMAN_OPERATOR.md`.
