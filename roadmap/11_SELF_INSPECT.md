# 11. Fase 11: Self-inspect + operator-inbox

Murray deja de responder «qué pasó» con un dump de `/jobs`. Junta un snapshot redacted, lo manda al modelo del chat, clasifica auto-fix vs tarea humana, ejecuta **solo** el allowlist de ops (sin teclado en este flujo) y deja el resto en `operator-inbox/` para Cursor.

**Precondición**: fases 07–10 en DoD. **No** reabrir 07–10. **No** tocar `roadmap/90_BACKLOG_HARDENING.md`.

## Prompt de arranque

```text
Leé roadmap/00_AGENT_PROTOCOL.md y SOLO roadmap/11_SELF_INSPECT.md.
Implementá inspect async + operator-inbox. No abras archive/ ni 90.
Murray no edita murray-infra ni pushea main. Una tarea a la vez. Verificación + DoD.
```

## Decisiones cerradas

- n8n `Consultar Murray` timeout **45s** → job `inspect` + `sendMessage` terminal. No subir el timeout de n8n.
- `/jobs` y «estado de los jobs» siguen siendo la lista cruda. `/jobs <id>` (16/32 hex) sigue siendo detalle determinista.
- `/triage`, «qué pasó», «en qué andas murray», UUID suelto o «en qué quedó task <hex>» → `action: inspect`.
- Snapshot determinista (sin LLM): jobs, session_context, OpenHands conversation **sin** `session_api_key`, sandboxes `oh-agent-server-*`, git del slug, `compose ps` + mem, logs cortos de `openhands` y `murray-agent`, docs allowlist (RUNBOOK/lessons/architecture/CHANGELOG/CONTEXT/91). Cap ~12k chars. Cero `.env`. Cero eventos OpenHands crudos.
- El modelo (active_model / murray-chat) devuelve JSON cerrado. Si no parsea → reply determinista + nota `llm_inspect_unparseable`.
- Auto-ops **sin HITL** en este flujo, con finding que respalde: `retry_stuck` (uno), `heal_openhands`, `restart`/`recreate` de un servicio ∈ `ALLOWED_SERVICES` **excepto** `postgres_db`. Inventario P12 en `91_PERMISSIVE_WINDOW.md`.
- `propose_ops` del chat **sigue** pidiendo teclado. Push a main, force, `docker exec`, `down -v`, editar `.mjs` → `operator_task`.
- Murray **no** commitea `operator-inbox/`. Bind `./operator-inbox:/opt/operator-inbox:rw`. Tabla `operator_notes`. Docs extra `:ro` (`CHANGELOG.md`, `CONTEXT.md`, `91_PERMISSIVE_WINDOW.md`). No montar `.git` ni el repo entero.

## Fuera de alcance

- Murray parcheando `openhands.mjs` / compose desde Telegram.
- Montar el `.git` de murray-infra y auto-merge.
- Socket-proxy (90).
- Subir el timeout de n8n.

## Archivos

- `config/murray-agent/inspect.mjs`, `operator-inbox.mjs`
- `config/murray-agent/intent.mjs`, `coding.mjs`, `llm.mjs`, `docs.mjs`, `db.mjs`, `server.mjs`, `sandbox-ttl.mjs`
- `docker-compose.yml`, `operator-inbox/README.md`
- `tests/test_inspect.mjs` (+ ajustes HTTP/classify)

## DoD

- [x] «qué pasó» / `/triage` ACK `needs_job` inspect; `/chat` no espera al LLM.
- [x] `/jobs` crudo intacto (PAUSED live sigue en slash).
- [x] Snapshot sin `session_api_key` / `LITELLM_MASTER_KEY`.
- [x] Schema rechaza `docker exec`; no auto-recreate `postgres_db`; heal sí con finding.
- [x] operator-inbox append + `operator_notes`; Murray no hace git commit ahí.
- [x] `node --test tests/test_inspect.mjs tests/test_coding_session.mjs tests/test_murray_agent_http.mjs tests/test_triage.mjs tests/test_sandbox_ttl.mjs`
