# Estado de Avance del Proyecto

Última actualización: 2026-09-18 22:10 (UTC-3)
Agente ejecutor: Cursor

## Fases históricas (no re-ejecutar)

Fuente: `roadmap/archive/`. Banner HISTÓRICO en cada archivo.

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
- [x] Fase 6c: Git de dev + borrar ./workspace
  - [x] Delete HITL de path/slug/wipe bajo ./workspace
  - [x] pull/checkout/commit sin HITL; push HITL feature-only + unshallow

## Fases vivas

- [x] Fase 7: murray.db SQLite WAL
  - [x] Tarea 7.1: Módulo db + schema + WAL
  - [x] Tarea 7.2: Migración JSON y reemplazo de stores
  - [x] Tarea 7.3: Imagen Node 22
  - [x] Tarea 7.4: Tests y sync de docs
- [x] Fase 8: Memoria de correos en murray.db
  - [x] Tarea 8.1: POST /triage/filter y /triage/mark-seen
  - [x] Tarea 8.2: Tool list_seen_emails
  - [x] Tarea 8.3: Workflow email_triage_draft.json
  - [x] Tarea 8.4: Tests
  - [x] Tarea 8.5: Sync de docs
- [x] Fase 9: Gateway LiteLLM
  - [x] Tarea 9.1: Servicio litellm + config
  - [x] Tarea 9.2: Reencaminar murray-agent y openhands
  - [x] Tarea 9.3: /model + active_model
  - [x] Tarea 9.4: Tests y .env.example
  - [x] Tarea 9.5: Sync de docs
- [x] Fase 10: Lifecycle + TTL 30 min
  - [x] Tarea 10.1: Helper purge + regex
  - [x] Tarea 10.2: Hook al inicio del job
  - [x] Tarea 10.3: Watcher 30 min
  - [x] Tarea 10.4: Tests y sync de docs
- [x] Fase 11: Self-inspect + operator-inbox
  - [x] Tarea 11.1: Inspect async + auto-ops allowlist
  - [x] Tarea 11.2: operator-inbox append-only y notas de operador
- [ ] Fase 12: Estabilización, Sandboxing y Orquestación Determinista
  - [x] Tarea 1.1: Sanitización Universal Telegram HTML + parse_mode HTML + fallback HTTP 400
  - [x] Tarea 1.2: Desacoplamiento de Webhooks (ACK <50ms en /chat, /workspace/hitl, /triage)
  - [x] Tarea 1.3: Janitor Docker Fortalecido (TTL 30m)
  - [x] Tarea 1.4: Base de esquemas Zod en murray-agent
  - [ ] Tarea 2.1: Git Bare Cache + Worktrees
  - [ ] Tarea 2.2: GIT_ASKPASS efímero 0700
  - [ ] Tarea 2.3: Unificación de Red Sandboxes (agent-net + host-gateway)
  - [ ] Tarea 3.1: Auditor AST Anti-Test Hacking en Python
  - [ ] Tarea 3.2: Sensor de Saturación OOM 137 y Alerta Telegram con Solución E2B
  - [ ] Tarea 3.3: Seam Abstracto SandboxRunner
  - [ ] Tarea 3.4: Esquemas Zod con uniones discriminadas
  - [ ] Tarea 4.1: Modo Mal Manager con EventStream cada 60s
  - [ ] Tarea 4.2: Simplificación n8n como Ingress Passthrough
  - [ ] Tarea 4.3: Verificación Integral E2E

## Backlog (no ejecutar)

- [ ] 90: Endurecimiento socket Docker (doble proxy + `VOLUMES=0` + `userns-remap`)

## Acciones humanas pendientes

- H1–H12: cerrados. H12 (2026-09-16 ~20:34 UY): Rechazar → `✅ Orden procesada: REJECT_TASK:16`.
- H13 (fase 9): HECHO 2026-09-18. `GEMINI_API_KEY` y `LITELLM_MASTER_KEY` distintas en `.env`. Recreate `--build` de `litellm` / `murray-agent` / `openhands`.
- H14 (fase 8): HECHO 2026-09-18. Import CLI + publish + Active de `email_triage_draft` (`Z8f9K2mP1qRt5vWx`). Sin staticData. HTTP a `/triage/filter` y `/triage/mark-seen`. n8n restart para cargar la versión publicada.
- Gmail OAuth **live**. Workflows n8n **activos**: HITL `20uYWal9fr2bWwVV`, triage `Z8f9K2mP1qRt5vWx`.
- Postgres 16: alerta de n8n 2.38 ignorada a propósito (no upgrade de major).
- **Operador (no bloquea código de 07–10)**:
  1. Pegar `GITHUB_TOKEN` (PAT de murray-threepwood, scope `repo`) en `.env` si aún falta. Import + publish + reactivar `telegram_hitl_router` y `docker compose up -d --force-recreate murray-agent`.
  2. Telegram: `/workspace`. `cloná https://github.com/owner/repo` → Aprobar. `hacé pull`. `commiteá "feat: …"`. `pusheá` (HITL, no en main). `borrá <slug>` → Aprobar.
  3. Recreate de un servicio del stack sigue pidiendo Aprobar ops.
  4. `/oh` queda para sandbox crudo.
  5. Rotar `GOOGLE_CLIENT_SECRET` si se pegó en un chat. Refresh token Testing ~7 días.
