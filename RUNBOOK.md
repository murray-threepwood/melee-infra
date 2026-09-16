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

### Incidente H: n8n alerta “Upgrade to Postgres 17”
- Causa: n8n 2.38 con `postgres:16-alpine`. Es compatibilidad, no un crash.
- **No** subir el major del volumen sin OK humano: `docker compose down -v` destruiría datos.

### Incidente F: workspace-mcp en Restarting
- Causa histórica: el paquete npm `@j3k0/mcp-google-workspace` no existe en el registry (404).
- Estado actual: el servicio corre un shim HTTP local (`config/workspace-mcp/server.mjs`) que **nunca envía correo**. Si alguien vuelve a poner `npm install -g @j3k0/mcp-google-workspace`, el contenedor entra en crash-loop.
