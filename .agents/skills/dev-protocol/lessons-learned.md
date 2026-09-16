# LESSONS LEARNED & ARCHITECTURAL INVARIANTS

Este archivo registra las lecciones aprendidas, invariantes técnicas y patrones de arquitectura descubiertos en el desarrollo del proyecto.

> **Regla de Operación**: Debe ser **consultado al iniciar** cualquier tarea y **actualizado al finalizar**, antes de solicitar la aprobación del usuario para la entrega git.

---

## 1. Invariantes de Arquitectura y Contratos

*(Registrá aquí contratos cerrados, convenciones de interfaz y decisiones de diseño que no deben reabrirse ni revertirse sin consulta explícita).*

- **Contratos de Interfaz**: Las interfaces públicas son el límite de prueba (seam). Si una prueba requiere inspeccionar el estado interno de un módulo, la abstracción es incorrecta.
- **Manejo de Secretos**: Ningún token, contraseña ni clave privada se escribe en código fuente ni se commitea en git. Todas las credenciales se inyectan mediante `.env` (ignorado en `.gitignore`).
- **n8n HITL ChatID**: el filtro `$env.TELEGRAM_CHAT_ID` solo funciona si esa variable está inyectada en el servicio `n8n` de Compose. El JSON del workflow no alcanza. En n8n 2.x también hace falta `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.
- **workspace-mcp draft-only**: `GMAIL_ALLOW_SENDING=false` y `GMAIL_ALLOW_DRAFTS=true` son invariantes. El paquete npm `@j3k0/mcp-google-workspace` no está publicado; el seam HTTP vive en `config/workspace-mcp/server.mjs` + `gmail-client.mjs` y rechaza cualquier ruta de send. Gmail API real: `status=ok` (inbox vacía inclusive). OAuth ausente = `503`, nunca `unread_count=0` fingido ni `awaiting_oauth`.
- **docker compose restart no recarga `.env`**: el contenedor viejo sigue con el env del create. Después de cambiar secretos: `docker compose up -d --force-recreate <servicio>`.
- **Gmail `unauthorized_client`**: el `refresh_token` nació de **otro** OAuth Client ID (casi siempre Desktop vs Web). No se “arregla” recreando el contenedor. Hay que reautorizar en el Playground con el cliente Web que está en `.env`.
- **architecture_spec.md es contrato vivo**: si no existe, crearlo. Si cambia un shape HTTP, un webhook, un guardrail o un presupuesto, actualizarlo en el mismo cambio. El stub `awaiting_oauth` / `stub_until_oauth` no puede volver a ese archivo.
- **Un bot Telegram = un webhook**: `email_triage_draft` no lleva `telegramTrigger`. Los callbacks siguen en `telegram_hitl_router`. El schedule de triage deduplica por `id` (static data) antes de `POST /gmail/drafts`; si no, cada 15 min duplica borradores.
- **OpenHands registry**: `docker.all-hands.dev` resuelve NXDOMAIN. Imagen vigente: `ghcr.io/openhands/openhands:latest` (puerto 3000, workspace `/opt/workspace_base`).
- **OpenHands HITL**: el UI local responde HTML en `/api/conversations` (POST → 405). Crear conversación: `POST /api/v1/app-conversations`. Rechazar/Pausar no deben pegarle a OpenHands.
- **n8n no recarga `./workflows`**: el mount es referencia. Un JSON nuevo no cambia el flujo publicado. Import + `publish:workflow` + `docker compose restart n8n`. `import:workflow --userId` y `--projectId` son mutuamente excluyentes.
- **405 fósil en logs de n8n**: `docker compose logs --tail=50 n8n` mezcla Axios 405 de *antes* del SIGTERM con el proceso actual. H12 / HITL vivo se verifica con `docker compose logs --since "$(docker inspect -f '{{.State.StartedAt}}' murray-n8n)"` y/o `execution_entity.startedAt` posterior al publish. El grafo publicado tiene que tener el nodo `¿Aprobar OpenHands?`.

---

## 2. Integraciones Externas y Protocolos

*(Registrá aquí peculiaridades de APIs externas, modelos LLM, bases de datos o servicios de red).*

- **Determinismo en Tests de LLM**: Las pruebas automatizadas nunca deben depender de llamadas en vivo a APIs de modelos con muestreo no determinista. Usar siempre mocks, stubs o fixtures grabados.
- **Timeouts y Circuit Breakers**: Toda llamada HTTP saliente a servicios externos debe definir un timeout explícito y un mecanismo de corte ante fallos reiterados.
- **Compose v5 quotes**: `docker compose config` emite `GMAIL_ALLOW_SENDING: "false"` (comillas dobles). Un grep que busque `'false'` con comillas simples falla en Compose 5.x; parsear YAML/JSON.
- **cloudflared placeholder**: un token de ejemplo deja el proceso `running` con `Failed to get tunnel`. No es un crash; el hostname público no existe hasta H3–H4 del operador. El token real de este stack ya está: si *vuelve* ese log, el túnel está mal, no es “esperado”.
- **Postgres 16 vs n8n 2.38**: n8n alerta `Upgrade to Postgres 17`. No subir de major sin OK humano: rompe el volumen `postgres_data`.
- **Gmail en Google Cloud**: habilitar **Gmail API**, nunca **Gmail MCP API**. El MCP de este stack es `workspace-mcp`, no un producto de Google. Consent OAuth 2026: **Google Auth Platform** → **Público** → **Usuarios externos** (Gmail personal). **Interno** solo con Google Workspace. No verificar ni publicar la app; test user = el CEO.
- **OAuth Playground + Desktop = `redirect_uri_mismatch`**: el Playground redirige a `https://developers.google.com/oauthplayground`. H8.4 es cliente **Web** con esa URI en **redirect URIs**, no en JavaScript origins (el origin no admite path). El `GOOGLE_REFRESH_TOKEN` nace de ese Client ID. Access type Offline en el engranaje.
- **OAuth Playground Step 1 no tiene Add**: abrir **Gmail API v1** y tildar readonly + compose, o pegar las dos URLs en `Input your own scopes` **separadas por un espacio** y **Authorize APIs**. Un token, los dos scopes.
- **Telegram HITL webhookId**: n8n 2.38 registra `POST /webhook/<webhookId>/webhook`. Telegram pegando `.../telegram trigger/webhook` da 404. Trigger sin `webhookId` + UUID huérfano da 500 `reading 'node'`. El JSON canónico tiene que incluir `webhookId` `4dae132d-912c-40e0-b048-c00b42e03250`.
- **n8n Telegram Markdown por default**: `GenericFunctions.js` pone `parse_mode=Markdown` si el nodo no lo declara. `REJECT_TASK` tiene `_` → Telegram 400 `can't parse entities`. Los nodos send/notify tienen que llevar `additionalFields.parse_mode=HTML`.

---

## 3. Rendimiento, Recursos y Almacenamiento

*(Registrá aquí presupuestos de memoria, restricciones de CPU o límites de concurrencia).*

- **Presupuesto de Memoria**: Validar que la huella de memoria acumulada de los servicios no exceda el límite operativo del entorno anfitrión.
- **Persistencia Aislada**: Los volúmenes y rutas de almacenamiento persistente deben declararse explícitamente sin montar directorios raíz del anfitrión.
- **docker stats MemUsage**: el formato es `12.5MiB / 3.8GiB`. Si el parser busca `GiB` en toda la línea, toma el **límite** y infla el total a cientos de GB. Parsear solo el primer token (uso). Medir con `docker compose stats`, no `docker stats` global.

---

## 4. Protocolo de Mantenimiento

1. **Consulta Obligatoria**: El agente **DEBE** leer este archivo antes de comenzar a escribir código o diagnosticar un error.
2. **Registro Inmediato**: Al descubrir un bug no obvio, una trampa de configuración o una decisión arquitectónica duradera, el agente **DEBE** registrarla en este archivo en el paso 6 del flujo principal (`dev-protocol`).
