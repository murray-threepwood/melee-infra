# RUNBOOK: Operación y Mantenimiento del Sistema

## 1. Comandos Frecuentes
- **Ver estado general**: `docker compose ps`
- **Ver logs en tiempo real**: `docker compose logs -f [servicio]`
- **Reiniciar un servicio específico**: `docker compose restart [servicio]`
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

### Incidente D: Error 401/403 en Google Workspace MCP
- Causa: Expiración del refresh token de Google Cloud OAuth.
- Mitigación: Regenerar el token en Google Cloud Console e inyectar el nuevo valor en `GOOGLE_REFRESH_TOKEN` en `.env`.

### Incidente E: cloudflared loguea `Failed to get tunnel`
- Causa: `CLOUDFLARE_TUNNEL_TOKEN` sigue siendo el placeholder de `.env.example`.
- Solución: completar H3–H4 de `roadmap/99_HUMAN_OPERATOR.md` y `docker compose restart cloudflared`.

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
