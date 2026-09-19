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
Runtime de agente de código acotado a `./workspace`, con `no-new-privileges` y socket Docker para sandboxes hijos. Representa a **Garfio (Meathook)**, el obrero mecánico senior de código.

## Garfio (Meathook)
Obrero Mecánico e Ingeniero Principal Senior (30+ años IT, AACC 130+ IQ) ejecutando dentro del sandbox OpenHands. Con garfios en lugar de manos y de espaldas a la pantalla, pica código quirúrgico, extermina dependencias superfluas y rinde cuentas a Murray y al CEO. Por defecto usa el alias `garfio-worker` en LiteLLM, pero Murray puede trasplantarle el cerebro dinámicamente (`/garfio model <modelo>` o `/cerebro <modelo>` o en lenguaje natural: `cambiale el cerebro a garfio por <modelo>`). Shhh: Garfio jamás debe enterarse de que es una criatura ensamblada tipo Frankenstein.

## garfio_rationales
Tabla relacional en `murray.db` (SQLite WAL) donde se persisten el resumen, decisiones de arquitectura y humo/antipatrones descartados por Garfio tras cada misión. Consultable vía `/garfio` o `/garfio <slug>`.

## /manual
Manual operativo interactivo esquemático y condensado que expone todas las herramientas, comandos y flujos disponibles en Murray y Garfio. Consultable vía `/manual`, `/help`, o diciendo `ayuda` / `comandos`.

## LiteLLM
Gateway HTTP en `agent-net` (`litellm:4000`). Murray y OpenHands pegan acá, no a `api.deepseek.com`. Primario DeepSeek. Fallback Gemini 3.8 Flash y, si no entra, 2.5 Flash-Lite (AI Studio, no el OAuth de Gmail).

## murray-agent
Servicio HTTP (`murray-agent:8080`) que habla con el CEO por el **mismo** bot Telegram. Chat vía LiteLLM + diagnóstico/ops del stack + conductor de coding sessions (`./workspace`). `/model` elige el modelo del chat. No edita murray-infra. Git de dev en el jail: pull/commit sin HITL; push y delete con Aprobar. Nunca force ni push a main/master. `/jobs` consulta la cola async.

## Job
Fila async en `murray.db` (tabla `jobs`, SQLite WAL): clone, code, oh_poll, pull, push, delete, checkout. Status `queued|running|done|failed|stuck|paused`. El CEO las ve con `/jobs`. `paused` es sandbox OpenHands PAUSED con working tree sucio; no es «misión lista».

## Coding session
Loop HITL por Telegram: clonar un repo público/privado (token en `.env`) a `./workspace/<slug>`, preguntar, editar/testear con OpenHands, y (con Aprobar) pushear una rama feature o borrar paths bajo `./workspace`. Stuck → opciones (retry/cambiar/parar/log).

## Triage
Diagnóstico del obrero OpenHands sin LLM. Frase canónica `/triage`; hablado: «qué pasa», «qué pasa con el obrero», «diagnosticá». Resume jobs, sandboxes `oh-agent-server-*`, git del slug y RAM Docker. No vuelca eventos JSON. Sanar (purgar sandboxes + restart openhands) pide HITL `heal_openhands`.

## seen_emails
Tabla de `murray.db` con IDs de Gmail ya procesados (`message_id`, `thread_id`, `processed_at`). Sin asuntos ni cuerpos. El cron pregunta `POST /triage/filter` y marca `POST /triage/mark-seen` solo si el draft respondió 2xx. `workspace-mcp` no guarda vistos.

## sandbox TTL
Purga automática de contenedores `oh-agent-server-*` con más de 30 minutos si no hay job `code`/`oh_poll` en vuelo. Watcher cada 5 min. Hook al inicio de un job `code`. No reemplaza el HITL `heal_openhands`.

## empty_finish
OpenHands `finished` con `git changes` vacío y working tree limpio. No es misión lista: job `stuck` + teclado. Casi siempre el obrero ni tocó el repo.

_Avoid_: llamar “MCP” al workflow n8n; el MCP es el servicio `workspace-mcp`.
_Avoid_: mapear Postgres a `0.0.0.0`.
_Avoid_: segundo bot Telegram / segundo webhook.
_Avoid_: `git push --force` o push a `main`/`master` desde el bot.
