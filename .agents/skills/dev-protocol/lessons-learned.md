# LESSONS LEARNED & ARCHITECTURAL INVARIANTS

Este archivo registra las lecciones aprendidas, invariantes técnicas y patrones de arquitectura descubiertos en el desarrollo del proyecto.

> **Regla de Operación**: Debe ser **consultado al iniciar** cualquier tarea y **actualizado al finalizar**, antes de solicitar la aprobación del usuario para la entrega git.

---

## 1. Invariantes de Arquitectura y Contratos

*(Registrá aquí contratos cerrados, convenciones de interfaz y decisiones de diseño que no deben reabrirse ni revertirse sin consulta explícita).*

- **Contratos de Interfaz**: Las interfaces públicas son el límite de prueba (seam). Si una prueba requiere inspeccionar el estado interno de un módulo, la abstracción es incorrecta.
- **Manejo de Secretos**: Ningún token, contraseña ni clave privada se escribe en código, git, logs, handoffs ni chat. Credenciales solo en `.env` y `config/mcp-auth/.gauth.json` (gitignore). Un handoff que pegue `GOOGLE_CLIENT_SECRET` / refresh token **es un incidente**: rotar el secret en Google Cloud Console, actualizar esos dos archivos, `docker compose up -d --force-recreate workspace-mcp`. No reimprimir el valor.
- **n8n HITL ChatID**: el filtro `$env.TELEGRAM_CHAT_ID` solo funciona si esa variable está inyectada en el servicio `n8n` de Compose. El JSON del workflow no alcanza. En n8n 2.x también hace falta `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.
- **workspace-mcp draft-only**: `GMAIL_ALLOW_SENDING=false` y `GMAIL_ALLOW_DRAFTS=true` son invariantes. El paquete npm `@j3k0/mcp-google-workspace` no está publicado; el seam HTTP vive en `config/workspace-mcp/server.mjs` + `gmail-client.mjs` y rechaza cualquier ruta de send. Gmail API real: `status=ok` (inbox vacía inclusive). OAuth ausente = `503`, nunca `unread_count=0` fingido ni `awaiting_oauth`.
- **docker compose restart no recarga `.env`**: el contenedor viejo sigue con el env del create. Después de cambiar secretos o `working_dir`: `docker compose up -d --force-recreate <servicio>`. `restart` solo SIGTERM/SIGSTART el mismo container.
- **Gmail `unauthorized_client`**: el `refresh_token` nació de **otro** OAuth Client ID (casi siempre Desktop vs Web). No se “arregla” recreando el contenedor. Hay que reautorizar en el Playground con el cliente Web que está en `.env`. El shim reintenta una vez con `config/mcp-auth/.gauth.json` si ese client_id es distinto; si env y gauth son el mismo cliente, Google sigue diciendo mismatch.
- **architecture_spec.md es contrato vivo**: si no existe, crearlo. Si cambia un shape HTTP, un webhook, un guardrail o un presupuesto, actualizarlo en el mismo cambio. El stub `awaiting_oauth` / `stub_until_oauth` no puede volver a ese archivo.
- **Un bot Telegram = un webhook**: `email_triage_draft` no lleva `telegramTrigger`. Los callbacks siguen en `telegram_hitl_router`. El schedule de triage deduplica por `id` (static data) antes de `POST /gmail/drafts`; si no, cada 15 min duplica borradores.
- **OpenHands registry**: `docker.all-hands.dev` resuelve NXDOMAIN. Imagen vigente: `ghcr.io/openhands/openhands:latest` (puerto 3000, workspace `/opt/workspace_base`).
- **OpenHands HITL**: el UI local responde HTML en `/api/conversations` (POST → 405). Crear conversación: `POST /api/v1/app-conversations`. Rechazar/Pausar no deben pegarle a OpenHands. H12 cubrió **Rechazar**. **Aprobar** (OpenHands + DeepSeek) sigue siendo prueba humana, no DoD de código.
- **n8n no recarga `./workflows`**: el mount es referencia. Un JSON nuevo no cambia el flujo publicado. Import + `publish:workflow` + `docker compose restart n8n`. `import:workflow --userId` y `--projectId` son mutuamente excluyentes. Todo JSON de workflow importado vía CLI requiere un campo `"id"` raíz no nulo; si falta, Postgres aborta `null value in column "id" of relation "workflow_entity" violates not-null constraint`. IDs publicados: HITL `20uYWal9fr2bWwVV`, triage `Z8f9K2mP1qRt5vWx`.
- **OAuth Playground: cuatro trampas, no un bug de código**: (1) typo de una letra en `GOOGLE_CLIENT_ID` → `401 invalid_client` / “The OAuth client was not found”. (2) secret OCR/rotado de otra tanda, largo distinto. (3) el engranaje ⚙️ guarda Client ID/secret en **localStorage**; corregir `.env` no alcanza, hay que pegar el par Web otra vez en el Playground. (4) el `code=4/...` caduca ~60s o al reutilizarlo → `400 invalid_grant`; reautorizar Paso 1 y canjear **ya**. El `refresh_token` tiene que nacer del cliente **Web**, no del Desktop.
- **405 fósil en logs de n8n**: `docker compose logs --tail=50 n8n` mezcla Axios 405 de *antes* del SIGTERM con el proceso actual. H12 / HITL vivo se verifica con `docker compose logs --since "$(docker inspect -f '{{.State.StartedAt}}' murray-n8n)"` y/o `execution_entity.startedAt` posterior al publish. El grafo publicado tiene que tener el nodo `¿Aprobar OpenHands?`.
- **`working_dir` no puede ser un bind `:ro`**: `workspace-mcp` monta `./config/workspace-mcp` → `/opt/mcp:ro`. Si `working_dir=/opt/mcp`, Docker Desktop aborta healthcheck y `compose exec` con *cwd outside of container mount namespace* (`exit=-1`). El proceso HTTP sigue vivo → `ps` dice `unhealthy` y el test live falla. Cwd canónico: `/tmp`. Command: `node /opt/mcp/server.mjs`. Tests y exec: `-w /tmp`.
- **`PROGRESS.md` no es un diario de bloqueos muertos**: si OAuth ya está live y el triage `active=t`, no dejar escrito “mismatch bloquea Active”. El operador lee eso como trabajo pendiente.
- **Telegram chat vs sandbox**: texto libre va a `murray-agent` (DeepSeek). El teclado OpenHands **crudo** solo si el mensaje es `/oh` o `sandbox:`. Clone/edits pedidos a Murray usan HITL `APPROVE_CLONE`/`APPROVE_CODE` y el obrero OpenHands.
- **Coding sessions**: un repo activo por chat en `./workspace/<slug>`. Solo `https://github.com|gitlab.com`. Clone shallow; pull/push unshallow. `git push` exige HITL + `allowPush` y **nunca** `main`/`master` ni `--force`. Delete de cualquier path bajo `./workspace` exige HITL. Token privado: `GITHUB_TOKEN`/`GITLAB_TOKEN` vía `http.extraHeader`, nunca en la URL ni logs. Author default `Murray <murray-threepwood@users.noreply.github.com>`. n8n timeout de `/chat` es 45s → jobs async + `sendMessage` del mismo bot (`TELEGRAM_CHAT_ID` only).
- **HITL sin teclado = prosa del LLM, no n8n roto**: el IF `!!$json.needs_hitl` manda a **Enviar Teclado Ops** solo con flag. DeepSeek puede escribir «Pido Aprobar» / «Tocá Aprobar» / «ya disparé propose_code_mission» **sin** invocar la tool → `needs_hitl=false` → **Responder Murray** (texto plano, cero botones). Clone/delete/push ya interceptan. Misión de código con comando de test extraíble también debe interceptar. Nunca mandar copy de Aprobar si no hay `hitl.approve_data`.
- **`/jobs` no es `docker logs`**: lista `jobs.json` (clone/code/git/delete/oh_poll). El «log» son notify de Telegram + `status=done|failed|stuck`, cap 40 guardadas / 20 al mostrar. No sustituye `/logs n8n`. Slash e intercept, sin LLM. Reloj y duración salen de `createdAt` (America/Montevideo); `updatedAt` miente en `oh_poll` porque el worker lo toca cada ~2s.
- **Jail `./workspace` en macOS**: `path.resolve(/var/...)` y `fs.realpathSync` (`/private/var/...`) no son el mismo string. Comparar contra el realpath de la raíz; si no, `rm` de un hijo jailed explota `workspace_jail`.
- **OpenHands 1.11 API**: health `GET /health` (`"OK"`). `GET /api/health` es HTML de la SPA. Alta `POST /api/v1/app-conversations` (start task). Follow-up `POST /api/v1/app-conversations/{id}/send-message`. Eventos `GET /api/v1/conversation/{id}/events/search`. `execution_status` incluye `stuck`. Circuit breaker real está en `detectStuck` (status/timeout/loop), no solo en el script simulado.
- **`approval_id` ops de un uso**: `POST /ops/execute` sin token vigente es `403`. Telegram `callback_data` ≤64 bytes → id hex de 16 chars (`APPROVE_OPS:<hex>`). Restart/recreate **no** pasan por el LLM.
- **docker.sock en murray-agent**: el seam es `ops.mjs` (allowlist + `assertSafeComposeArgs`). Nunca `down -v` / `exec`. Recreate con `--no-deps`. `--project-directory /opt/stack` monta `docker-compose.yml` + `.env` (el LLM no puede `cat` .env: no hay tool de shell).
- **n8n import desactiva el workflow**: `import:workflow` loguea `Deactivating workflow`. Después: `update:workflow --id=... --active=true` (deprecado pero funciona) o publish + restart. Verificar `workflow_entity.active`.
- **Bind `./workflows` a veces vacío hasta recrear n8n**: Docker Desktop puede servir `/opt/workflows` vacío. Workaround: `docker compose cp workflows/foo.json n8n:/tmp/foo.json` e importar desde `/tmp`. Un restart de n8n suele remountar.

---

## 2. Integraciones Externas y Protocolos

*(Registrá aquí peculiaridades de APIs externas, modelos LLM, bases de datos o servicios de red).*

- **Determinismo en Tests de LLM**: Las pruebas automatizadas nunca deben depender de llamadas en vivo a APIs de modelos con muestreo no determinista. Usar siempre mocks, stubs o fixtures grabados.
- **Timeouts y Circuit Breakers**: Toda llamada HTTP saliente a servicios externos debe definir un timeout explícito y un mecanismo de corte ante fallos reiterados.
- **Compose v5 quotes**: `docker compose config` emite `GMAIL_ALLOW_SENDING: "false"` (comillas dobles). Un grep que busque `'false'` con comillas simples falla en Compose 5.x; parsear YAML/JSON.
- **cloudflared placeholder**: un token de ejemplo deja el proceso `running` con `Failed to get tunnel`. No es un crash; el hostname público no existe hasta H3–H4 del operador. El token real de este stack ya está: si *vuelve* ese log, el túnel está mal, no es “esperado”. Recreates de n8n dejan un `connection refused` a `:5678` en logs del túnel; es el gap del restart, no un hostname roto. Verificar `curl -I https://ceo.threepwood.uy/healthz`.
- **Postgres 16 vs n8n 2.38**: n8n alerta `Upgrade to Postgres 17`. No subir de major sin OK humano: rompe el volumen `postgres_data`.
- **Gmail en Google Cloud**: habilitar **Gmail API**, nunca **Gmail MCP API**. El MCP de este stack es `workspace-mcp`, no un producto de Google. Consent OAuth 2026: **Google Auth Platform** → **Público** → **Usuarios externos** (Gmail personal). **Interno** solo con Google Workspace. No verificar ni publicar la app; test user = el CEO.
- **OAuth Testing ≈ refresh token de 7 días**: app en **Prueba** (externa, sin publicar) → Google caduca el `refresh_token` ~7 días → `503 gmail_oauth_failed` / `invalid_grant`. Mitigación operativa: reautorizar en Playground (engranaje Web, canje inmediato) y `force-recreate workspace-mcp`. Publicar/verificar la app **no** es el default: scopes Gmail piden revisión de Google.
- **OAuth Playground + Desktop = `redirect_uri_mismatch`**: el Playground redirige a `https://developers.google.com/oauthplayground`. H8.4 es cliente **Web** con esa URI en **redirect URIs**, no en JavaScript origins (el origin no admite path). El `GOOGLE_REFRESH_TOKEN` nace de ese Client ID. Access type Offline en el engranaje.
- **OAuth Playground Step 1 no tiene Add**: abrir **Gmail API v1** y tildar readonly + compose, o pegar las dos URLs en `Input your own scopes` **separadas por un espacio** y **Authorize APIs**. Un token, los dos scopes.
- **Telegram HITL webhookId**: n8n 2.38 registra `POST /webhook/<webhookId>/webhook`. Telegram pegando `.../telegram trigger/webhook` da 404. Trigger sin `webhookId` + UUID huérfano da 500 `reading 'node'`. El JSON canónico tiene que incluir `webhookId` `4dae132d-912c-40e0-b048-c00b42e03250`.
- **n8n Telegram Markdown por default**: `GenericFunctions.js` pone `parse_mode=Markdown` si el nodo no lo declara. `REJECT_TASK` tiene `_` → Telegram 400 `can't parse entities`. Los nodos send/notify tienen que llevar `additionalFields.parse_mode=HTML`.
- **Rotar `GOOGLE_CLIENT_SECRET` no exige nuevo refresh_token**: el token está atado al Client ID. Después del reset: mismo `GOOGLE_REFRESH_TOKEN`, secret nuevo en `.env` + `.gauth.json`, `force-recreate workspace-mcp`.

---

## 3. Rendimiento, Recursos y Almacenamiento

*(Registrá aquí presupuestos de memoria, restricciones de CPU o límites de concurrencia).*

- **Presupuesto de Memoria**: Validar que la huella de memoria acumulada de los servicios no exceda el límite operativo del entorno anfitrión.
- **Persistencia Aislada**: Los volúmenes y rutas de almacenamiento persistente deben declararse explícitamente sin montar directorios raíz del anfitrión.
- **docker stats MemUsage**: el formato es `12.5MiB / 3.8GiB`. Si el parser busca `GiB` en toda la línea, toma el **límite** y infla el total a cientos de GB. Parsear solo el primer token (uso). Medir con `docker compose stats`, no `docker stats` global.
- **Huella idle observada**: ~838–850 MiB (5 servicios, 2026-09-16); ~1140–1230 MiB con `murray-agent` + coding volumes (2026-09-17). Techo `< 4.5 GB`. Un runtime hijo de OpenHands suma aparte; si se pasa el techo, recrear `openhands`.

---

## 4. Protocolo de Mantenimiento

1. **Consulta Obligatoria**: El agente **DEBE** leer este archivo antes de comenzar a escribir código o diagnosticar un error.
2. **Registro Inmediato**: Al descubrir un bug no obvio, una trampa de configuración o una decisión arquitectónica duradera, el agente **DEBE** registrarla en este archivo en el paso 6 del flujo principal (`dev-protocol`).
