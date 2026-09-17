# RUNBOOK: Operación y Mantenimiento del Sistema

## 1. Comandos Frecuentes
- **Panel de control y observabilidad integral (Recomendado)**: `./el_corazon_de_Murray.sh`
- **Ver estado general**: `docker compose ps`
- **Ver logs en tiempo real**: `docker compose logs -f [servicio]`
- **Reiniciar un proceso (mismo env)**: `docker compose restart [servicio]`
- **Recargar `.env` / `working_dir` / command**: `docker compose up -d --force-recreate [servicio]` (`restart` **no** recarga env)
- **Detener stack completo**: `docker compose down`
- **Actualizar imágenes**: `docker compose pull && docker compose up -d`

## 2. Triage de Incidentes Comunes

### Incidente A: Los webhooks de Telegram no llegan a n8n
1. Comprobar que el túnel de Cloudflare esté conectado:
   `docker compose logs --tail=30 cloudflared`
2. Verificar que el subdominio apunte a n8n (`curl -I https://${SUBDOMINIO_PUBLICO}/healthz`).
3. Reiniciar túnel si hubo reconexión de red: `docker compose restart cloudflared`.

### Incidente B: n8n no puede descifrar credenciales
- Causa: Falta o cambio de `N8N_ENCRYPTION_KEY` en `.env`.
- Solución: Asegurar que el valor de `N8N_ENCRYPTION_KEY` en `.env` coincida exactamente con el utilizado en la inicialización original de la base de datos.

### Incidente C: OpenHands consume memoria excesiva
- Causa: Tarea con procesamiento intensivo o contenedor hijo no destruido.
- Diagnóstico: `docker ps --filter "name=openhands"`
- Mitigación: Reiniciar OpenHands para limpiar sandboxes huérfanos:
  `docker compose restart openhands`

### Incidente D: Gmail OAuth 401 / 403 / 503
- `unauthorized_client` / `gmail_oauth_client_mismatch`: el `refresh_token` no es del Client ID Web de `.env` (casi siempre nació del cliente Desktop). Reautorizar en [OAuth Playground](https://developers.google.com/oauthplayground/) con el cliente Web, Access type Offline, canje inmediato. Pegar el token nuevo **solo** en `.env`.
- `invalid_client` / “The OAuth client was not found”: typo en `GOOGLE_CLIENT_ID` **o** el Playground sigue mandando el ID viejo de localStorage (engranaje ⚙️).
- `invalid_grant` / `gmail_oauth_failed`: (a) `code=4/...` de ~60s reutilizado; (b) refresh token de app en **Prueba** caducó (~7 días). Reautorizar Playground → `.env` → `docker compose up -d --force-recreate workspace-mcp`.
- No regenerar el token en “Google Cloud Console” a ciegas: Console rota el **secret**, Playground emite el **refresh_token**.

### Incidente E: cloudflared loguea `Failed to get tunnel`
- Causa: `CLOUDFLARE_TUNNEL_TOKEN` sigue siendo el placeholder de `.env.example`.
- Solución: completar H3–H4 de `roadmap/99_HUMAN_OPERATOR.md` y `docker compose restart cloudflared`.
- Si el log es `dial tcp …:5678: connect: connection refused` justo después de recrear n8n: gap de restart. Verificar `curl -I https://ceo.threepwood.uy/healthz`.

### Incidente G: Botón HITL de Telegram da 405 / AxiosError
- Causa: el flujo publicado pegaba `POST /api/conversations` (ruta SPA de OpenHands 1.11).
- Verificación: `bash tests/test_live_hitl_dispatch.sh` debe imprimir `LIVE_HITL_DISPATCH_OK` y `LIVE_HITL_NO_405_SINCE_RESTART`.
- Trampa: un `logs --tail=50` puede mostrar 405 de *antes* del último restart. Eso es fósil. Contar Axios 405 solo desde `docker inspect -f '{{.State.StartedAt}}' murray-n8n`.
- Mitigación: importar `workflows/telegram_hitl_router.json`, `n8n publish:workflow --id=<id>`, `docker compose restart n8n`. Rechazar/Pausar no deben llamar a OpenHands.

### Incidente I: El bot no responde (silencio total)
- Causa 1: Telegram pega `.../telegram trigger/webhook` (nombre del nodo). n8n 2.38 solo registra el UUID `webhookId`. `setWebhook` tiene que apuntar a `https://${SUBDOMINIO_PUBLICO}/webhook/<webhookId>/webhook`.
- Causa 2: el JSON del flujo sin `webhookId` deja un UUID huérfano → POST 500 `Cannot read properties of undefined (reading 'node')`.
- Verificación: `bash tests/test_live_hitl_dispatch.sh` imprime `webhookId 4dae132d-912c-40e0-b048-c00b42e03250`. Un POST vacío a esa ruta ya no debe ser “unknown webhook”.
- Mitigación: el trigger en `workflows/telegram_hitl_router.json` tiene que llevar ese `webhookId`; import + publish + restart n8n. Luego `setWebhook` a esa URL.

### Incidente J: Rechazar selecciona el botón y no manda `✅ Orden procesada`
- Causa: n8n Telegram default `parse_mode=Markdown`. `REJECT_TASK` tiene `_` y Telegram responde 400 `can't parse entities`.
- Verificación: `python3 tests/test_hitl_dispatch.py` exige `parse_mode=HTML` en los nodos send/notify. Logs n8n: `AxiosError` 400, no 405.
- Mitigación: `additionalFields.parse_mode=HTML` en esos nodos; import + publish + restart.

### Incidente H: n8n alerta “Upgrade to Postgres 17”
- Causa: n8n 2.38 con `postgres:16-alpine`. Es compatibilidad, no un crash.
- **No** subir el major del volumen sin OK humano: `docker compose down -v` destruiría datos.

### Incidente K: `/gmail/unread` devuelve 0 y parece “sin correo”
- Causa histórica: el shim respondía `unread_count=0` + `status: awaiting_oauth` aunque OAuth ya estaba.
- Contrato vivo: `status=ok` es Gmail API (0 puede ser inbox vacía). `503 gmail_oauth_missing` es falta de `GOOGLE_*`. `503 gmail_oauth_client_mismatch` es `unauthorized_client` (refresh token de otro Client ID, Desktop vs Web). `503 gmail_oauth_failed` es `invalid_grant`. `502 gmail_api_failed` es la API.
- Verificación: `bash tests/test_live_gmail_shim.sh` → `LIVE_GMAIL_SHIM_OK`. No imprimir asuntos.
- Trampa: `docker compose restart workspace-mcp` **no** recarga `.env`. Hace falta `docker compose up -d --force-recreate workspace-mcp`.

### Incidente F: workspace-mcp en Restarting
- Causa histórica: el paquete npm `@j3k0/mcp-google-workspace` no existe en el registry (404).
- Estado actual: el servicio corre `server.mjs` + `gmail-client.mjs` (Gmail API draft-only, **nunca send**). Si alguien vuelve a poner `npm install -g @j3k0/mcp-google-workspace`, el contenedor entra en crash-loop.

### Incidente L: `workspace-mcp` figura `unhealthy` pero Gmail responde
- Causa: `working_dir` era `/opt/mcp` (bind `:ro`). Docker Desktop aborta el healthcheck/`compose exec` (`exit=-1`, *cwd outside mount namespace*). El proceso HTTP sigue en `:8000`.
- Verificación: `wget` a `http://workspace-mcp:8000/healthz` **desde n8n** da `gmail_mode=live`. `docker inspect` Health.Status `unhealthy` + FailingStreak alto.
- Mitigación: `working_dir: /tmp` en Compose, command `node /opt/mcp/server.mjs`, tests con `-w /tmp`. Recrear: `docker compose up -d --force-recreate workspace-mcp`. Esperar `healthy`.

### Incidente M: `n8n import:workflow` aborta por `id` NULL
- Causa: el JSON no trae `"id"` en la raíz. Postgres 16: `null value in column "id" of relation "workflow_entity"`.
- Mitigación: asignar un id estable en `workflows/*.json` (HITL: `20uYWal9fr2bWwVV`, triage: `Z8f9K2mP1qRt5vWx`) e importar con `--projectId` **o** `--userId`, nunca los dos. Si `/opt/workflows` está vacío: `docker compose cp` al `/tmp` del contenedor. El import **desactiva**; reactivar y `docker compose restart n8n`.

### Incidente N: El bot tira teclado HITL en cada mensaje (no hay chat)
- Causa: el router viejo mandaba **todo** texto al teclado OpenHands.
- Contrato v1: texto libre → `murray-agent` `/chat`. Solo `/oh` o `sandbox:` abren OpenHands.
- Verificación: `python3 tests/test_hitl_dispatch.py` y `bash tests/test_live_hitl_dispatch.sh` (el publicado tiene `Consultar Murray`).
- Mitigación: import + publish `telegram_hitl_router.json`, `docker compose restart n8n`.

### Incidente Q: ./workspace llena el disco
- Causa: clones shallow + `node_modules` / unshallow de repos grandes.
- Verificación: Telegram `/workspace` (lista + tamaños).
- Mitigación: `borrá <slug>` o `borrá todo el workspace` → Aprobar. Nunca borra fuera de `./workspace`.

### Incidente P: Clone/código por Telegram no hace nada al tocar Aprobar
- Causa: el workflow publicado no tiene `Resolver HITL Workspace` / `/workspace/hitl`, o murray-agent viejo sin `git`.
- Verificación: `python3 tests/test_hitl_dispatch.py` y `bash tests/test_live_workspace_clone.sh`.
- Mitigación: import + publish `telegram_hitl_router.json`; `docker compose up -d --build --force-recreate murray-agent`.

### Incidente R: Murray dice «Tocá Aprobar» y no hay botones
- Causa: el LLM escribió prosa HITL sin `needs_hitl=true`. n8n IF `!!$json.needs_hitl` va a **Responder Murray** (texto), no a **Enviar Teclado Ops**.
- Verificación: el mensaje de misión tiene que incluir `Comando: …` (pytest/npm test/etc.) con repo activo; Murray debe devolver teclado Aprobar/Rechazar. `node --test tests/test_murray_agent_http.mjs` cubre el repro.
- Mitigación: `docker compose up -d --force-recreate murray-agent`. No reimportar n8n por este síntoma: el router está bien.

### Incidente O: Murray no contesta / 403 en ops
- Causa 1: `murray-agent` unhealthy o n8n no publicado con `/chat`.
- Causa 2: `POST /ops/execute` sin `approval_id` vigente (15 min, un uso).
- Verificación: `bash tests/test_live_murray_agent.sh` → `LIVE_MURRAY_AGENT_OK`. `/status` no usa DeepSeek.
- Mitigación: `docker compose up -d --build --force-recreate murray-agent`. No recrear n8n/cloudflared a ciegas: gap de webhook 10–20s.
