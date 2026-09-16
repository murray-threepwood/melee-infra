# Changelog

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
