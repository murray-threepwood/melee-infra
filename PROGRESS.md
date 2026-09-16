# Estado de Avance del Proyecto

Última actualización: 2026-09-16 22:30 (UTC)
Agente ejecutor: Cursor

## Fases y Tareas
- [x] Fase 1: Inicialización de Entorno y Red Segura
  - [x] Tarea 1.1: Inicialización de Directorios
  - [x] Tarea 1.2: Generación de .env.example y .env
  - [x] Tarea 1.3: Servicio postgres_db
  - [x] Tarea 1.4: Servicio cloudflared
  - [x] Tarea 1.5: Script tests/test_postgres.sh
- [x] Fase 2: Orquestador n8n y Canal HITL (Telegram)
  - [x] Tarea 2.1: Despliegue de n8n conectado a Postgres
  - [x] Tarea 2.2: Workflow workflows/telegram_hitl_router.json
  - [x] Tarea 2.3: Validación del Webhook y Filtro de Seguridad
- [x] Fase 3: Conector Google Workspace con Guardrails
  - [x] Tarea 3.1: Despliegue del servicio workspace-mcp
  - [x] Tarea 3.2: Configuración de Guardrail Draft-Only
  - [x] Tarea 3.3: Script tests/test_mcp_draft_only.py
  - [x] Tarea 3.4: Workflow workflows/email_triage_draft.json
- [x] Fase 4: Runtime Sandbox de OpenHands y Telemetría
  - [x] Tarea 4.1: Contenedor OpenHands con socket Docker
  - [x] Tarea 4.2: Integración LiteLLM con DeepSeek
  - [x] Tarea 4.3: Script tests/test_openhands_api.sh
- [x] Fase 5: Verificación Integral del Stack
  - [x] Tarea 5.1: Despliegue coordinado completo
  - [x] Tarea 5.2: Validación de consumo de RAM (< 4.5 GB)
  - [x] Tarea 5.3: Script tests/test_e2e_stack.sh
  - [x] Tarea 5.4: Runbook operativo y de fallas

## Acciones humanas pendientes
- **BLOCKER Gmail**: no existe `config/mcp-auth/.gauth.json` (H9). El shim sigue en stub (`unread_count=0`). No se importó `email_triage_draft` ni se tocó OAuth. No poner `GMAIL_ALLOW_SENDING=true`.
- **H12**: grafo publicado **verde** (`LIVE_HITL_DISPATCH_OK`, nodo `¿Aprobar OpenHands?`, 0 Axios 405 desde el restart 12:46 UTC). El click de las 12:32 UTC pegó a `/api/conversations` (grafo viejo) y **no cuenta**. No hay ejecución HITL posterior al publish; no se re-pide el click.
- Túnel `ceo.threepwood.uy`, Telegram y DeepSeek: cerrados. HITL publicado con IF de aprobación.
- Postgres 16: alerta de n8n 2.38 ignorada a propósito (no upgrade de major).
