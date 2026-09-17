# Changelog

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
