# Changelog

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
