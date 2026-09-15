# CONTEXT.md — Glosario de dominio (murray-infra)

## 1-Person CEO
Sistema de automatización ejecutiva operado por una sola persona, con aprobación humana obligatoria antes de acciones irreversibles.

## HITL
Human-In-The-Loop. Canal Telegram con botones Aprobar / Rechazar / Pausar. El bot ignora cualquier `chat.id` distinto de `TELEGRAM_CHAT_ID`.

## agent-net
Red bridge Docker interna. Postgres, n8n, cloudflared, workspace-mcp y OpenHands se resuelven por nombre de servicio. Sin puertos públicos salvo loopback.

## cloudflared
Conector del túnel Cloudflare Zero Trust. El origen interno de n8n es `http://n8n:5678`, nunca `localhost` desde ese contenedor.

## workspace-mcp
Servicio de Gmail/Calendar con guardrail draft-only: puede leer y crear borradores; no puede enviar. Hoy es un shim HTTP local hasta OAuth real.

## Draft-Only
Invariante: `GMAIL_ALLOW_SENDING=false` y `GMAIL_ALLOW_DRAFTS=true`. El clic de envío ocurre en Gmail, en manos del CEO.

## OpenHands
Runtime de agente de código acotado a `./workspace`, con `no-new-privileges` y socket Docker para sandboxes hijos.

_Avoid_: llamar “MCP” al workflow n8n; el MCP es el servicio `workspace-mcp`.
_Avoid_: mapear Postgres a `0.0.0.0`.
