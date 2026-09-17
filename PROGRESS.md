# Estado de Avance del Proyecto

Última actualización: 2026-09-17 20:20 (UTC)
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
- [x] Fase 6: Murray por Telegram (v1 chat + ops HITL)
  - [x] Servicio `murray-agent` + router n8n (texto libre ≠ teclado OpenHands)
- [x] Fase 6b: Coding sessions (clone/Q&A/OpenHands obrero)
  - [x] Spike OpenHands follow-up + jobs async
  - [x] HITL clone + tree/read/grep
  - [x] propose_code_mission + stuck options + Murray pregunta antes

## Acciones humanas pendientes
- H1–H12: cerrados. H12 (2026-09-16 ~20:34 UY): Rechazar → `✅ Orden procesada: REJECT_TASK:16`.
- Gmail OAuth **live**. Workflows n8n **activos**: HITL `20uYWal9fr2bWwVV`, triage `Z8f9K2mP1qRt5vWx`.
- Postgres 16: alerta de n8n 2.38 ignorada a propósito (no upgrade de major).
- **Operador (no bloquea código)**:
  1. Import + publish + reactivar `telegram_hitl_router` (nodos workspace HITL) y `docker compose up -d --build --force-recreate murray-agent`.
  2. Telegram: `cloná https://github.com/owner/repo` → Aprobar. Preguntá por el código. Pedí un cambio con comando de test → Aprobar código.
  3. Recreate de un servicio del stack sigue pidiendo Aprobar ops.
  4. `/oh` queda para sandbox crudo.
  5. Rotar `GOOGLE_CLIENT_SECRET` si se pegó en un chat. Refresh token Testing ~7 días.
