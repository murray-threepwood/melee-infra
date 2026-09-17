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
Servicio de Gmail draft-only: lee y crea borradores vía Gmail API; no puede enviar. HTTP en `workspace-mcp:8000`. Inbox vacía (`status=ok`, `unread_count=0`) no es stub; OAuth ausente es `503`.

## Draft-Only
Invariante: `GMAIL_ALLOW_SENDING=false` y `GMAIL_ALLOW_DRAFTS=true`. El clic de envío ocurre en Gmail, en manos del CEO.

## OpenHands
Runtime de agente de código acotado a `./workspace`, con `no-new-privileges` y socket Docker para sandboxes hijos.

## murray-agent
Servicio HTTP (`murray-agent:8080`) que habla con el CEO por el **mismo** bot Telegram. DeepSeek Chat + diagnóstico/ops del stack + conductor de coding sessions (`./workspace`). No edita murray-infra. Git de dev en el jail: pull/commit sin HITL; push y delete con Aprobar. Nunca force ni push a main/master.

## Coding session
Loop HITL por Telegram: clonar un repo público/privado (token en `.env`) a `./workspace/<slug>`, preguntar, editar/testear con OpenHands, y (con Aprobar) pushear una rama feature o borrar paths bajo `./workspace`. Stuck → opciones (retry/cambiar/parar/log).

_Avoid_: llamar “MCP” al workflow n8n; el MCP es el servicio `workspace-mcp`.
_Avoid_: mapear Postgres a `0.0.0.0`.
_Avoid_: segundo bot Telegram / segundo webhook.
_Avoid_: `git push --force` o push a `main`/`master` desde el bot.
