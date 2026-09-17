# Handoff: murray-infra (próxima IA)

Leé esto **antes** de tocar código. Fuente de invariantes: [`.agents/skills/dev-protocol/lessons-learned.md`](./.agents/skills/dev-protocol/lessons-learned.md). Contratos: [`architecture_spec.md`](./architecture_spec.md). Incidentes: [`RUNBOOK.md`](./RUNBOOK.md). Operador humano: [`roadmap/99_HUMAN_OPERATOR.md`](./roadmap/99_HUMAN_OPERATOR.md).

**Prohibido** pegar secretos de `.env` o `.gauth.json` en chat, logs o este archivo.

---

## Estado (2026-09-17)

- Rama de trabajo integrada a `main`. Stack Compose: `postgres_db`, `cloudflared`, `n8n`, `workspace-mcp`, `murray-agent`, `openhands`.
- Verificación: `bash tests/test_e2e_stack.sh` → `E2E_VERIFICACION_COMPLETA_OK`. RAM idle ~1.1 GiB (techo 4.5 GiB).
- Gmail live draft-only. `GET /gmail/unread` → `status=ok`. Send → 403.
- Telegram: un bot, un webhook. Texto libre = Murray (DeepSeek en `murray-agent`). `/oh` o `sandbox:` = OpenHands. Ops mutate = HITL `APPROVE_OPS`.
- Workflows n8n activos: `telegram_hitl_router` (`20uYWal9fr2bWwVV`), `email_triage_draft` (`Z8f9K2mP1qRt5vWx`).
- Murray-en-Telegram **no es Cursor**. No edita este repo. No hay git push desde el bot.

---

## Cómo trabajar acá

1. Skill [`.agents/skills/dev-protocol/SKILL.md`](./.agents/skills/dev-protocol/SKILL.md) + **siempre** `lessons-learned.md`.
2. Rama `<type>/<short-name>` desde `main`. TDD en el seam HTTP, no en el JSON de n8n.
3. Commits locales OK. **Push y merge a `main` solo con OK explícito del humano.**
4. Si cambia un contrato HTTP, webhook, guardrail o presupuesto: actualizar `architecture_spec.md` en el mismo cambio.
5. Al terminar: tests verdes, lección nueva en `lessons-learned.md`, handoff al humano. No push.

---

## Invariantes (no reabrir)

| Tema | Regla |
| :--- | :--- |
| Gmail | `GMAIL_ALLOW_SENDING=false`. No hay `send()` en `gmail-client.mjs`. |
| Telegram | Un `telegramTrigger`. WebhookId `4dae132d-912c-40e0-b048-c00b42e03250`. `parse_mode=HTML`. |
| Chat vs sandbox | Texto libre → `POST murray-agent:8080/chat`. OpenHands solo `/oh` o `sandbox:`. |
| Ops | `restart`/`recreate` de un servicio: `approval_id` de un uso. `callback_data` ≤64 bytes. |
| Compose env | `docker compose restart` **no** recarga `.env`. Usar `up -d --force-recreate`. |
| CWD | `working_dir: /tmp` si el código está en bind `:ro`. Si no, healthcheck `exit=-1` falso. |
| Postgres | `postgres:16-alpine`. No 17 sin migración humana (`down -v` borra el volumen). |
| OpenHands | Imagen `ghcr.io/openhands/openhands:latest`. API `POST /api/v1/app-conversations`. Rechazar/Pausar no llaman. |
| n8n JSON | Import CLI exige `"id"` raíz. `--projectId` xor `--userId`. El mount no publica el flujo. |
| Secretos | Solo `.env` + `config/mcp-auth/.gauth.json`. Rotar secret si se pegó en un chat. |

---

## Trampas que ya pagamos (no repetir)

### OAuth Gmail (no era código)

1. Typo de una letra en `GOOGLE_CLIENT_ID` → `401 invalid_client`.
2. Secret OCR / de otra rotación.
3. OAuth Playground guarda el Client ID viejo en **localStorage** del engranaje.
4. `code=4/...` ~60s → `400 invalid_grant`. Canjear ya.
5. `refresh_token` del cliente **Desktop** contra cliente **Web** → `unauthorized_client`. Reautorizar en Playground con el Web, Access type Offline, scopes readonly+compose **juntos**.
6. App en **Prueba**: el refresh token caduca ~**7 días**.

Cliente Playground: tipo **Web**, redirect URI `https://developers.google.com/oauthplayground` (no en JavaScript origins). Habilitar **Gmail API**, nunca “Gmail MCP API”.

Después de cambiar `GOOGLE_*`: `docker compose up -d --force-recreate workspace-mcp`.

### n8n

- Import sin `"id"` → Postgres `null value in column "id"`.
- Import **desactiva** el workflow. Reactivar y verificar `workflow_entity.active`.
- `/opt/workflows` a veces vacío (Docker Desktop). `docker compose cp ... n8n:/tmp/` e importar desde `/tmp`. Restart remounta.
- `logs --tail=50` mezcla 405 fósiles. Usar `--since` del `StartedAt` del contenedor.
- Telegram default Markdown rompe `REJECT_TASK` (`_`). HTML obligatorio.
- Recreate de `n8n` o `cloudflared`: webhook mudo 10–20s (`connection refused :5678`). Chequear `https://ceo.threepwood.uy/healthz`.

### Docker / tests

- `docker compose stats` (este proyecto), no `docker stats` global. Parsear solo el **uso** del MemUsage (`12.5MiB / 3.8GiB`).
- Compose 5.x emite `GMAIL_ALLOW_SENDING: "false"` con comillas dobles.
- `exec` y healthcheck: `docker compose exec -T -w /tmp <svc>`.
- Tests LLM: mock. Live `/status` no llama a DeepSeek. No imprimir asuntos de Gmail.

---

## Superficies para cambiar infra

| Qué | Dónde | Test |
| :--- | :--- | :--- |
| Gmail HTTP | `config/workspace-mcp/*.mjs` | `tests/test_workspace_mcp_http.mjs`, `test_live_gmail_shim.sh` |
| Chat / ops Telegram | `config/murray-agent/*.mjs` | `tests/test_murray_agent_http.mjs`, `test_live_murray_agent.sh` |
| Router Telegram | `workflows/telegram_hitl_router.json` | `tests/test_hitl_dispatch.py` + import/publish/activar/restart n8n + `test_live_hitl_dispatch.sh` |
| Triage mail | `workflows/email_triage_draft.json` | `tests/test_email_triage_draft.py` (sin `telegramTrigger`) |
| Compose / RAM | `docker-compose.yml` | `tests/test_mcp_draft_only.py`, `tests/check_memory_budget.sh` |
| Suite | | `bash tests/test_e2e_stack.sh` |

n8n projectId de import: `RtVLhOyjbwQ3l5th`. Credencial Telegram nombre `Telegram account`.

---

## Operador (humano, no código)

- Rotar `GOOGLE_CLIENT_SECRET` si se filtró en un chat. Pegar solo en `.env` + `.gauth.json`. Recreate `workspace-mcp`.
- Reautorizar Playground cuando Gmail dé `gmail_oauth_failed` (~7 días en Testing).
- Probar Telegram: texto libre; recreate con Aprobar ops; `/oh` para sandbox. H12 cubrió Rechazar, no Aprobar OpenHands.
- Primer unread real → draft en Gmail + alerta (el cron es 15 min).

---

## Qué no construir en el próximo slice (salvo pedido)

- Segundo bot / segundo webhook.
- `GMAIL_ALLOW_SENDING=true`.
- Postgres 17.
- Hacer de Murray-Telegram un Cursor (editar `murray-infra`, git push).
- Publicar la app OAuth (scopes Gmail = verificación Google).
