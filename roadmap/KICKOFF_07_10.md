# Kickoff: implementar fases 07–10 de punta a punta

Pegá el bloque de abajo **entero** en un agente nuevo (Cursor / Claude Code / Gemini). No le agregues el backlog de Docker ni `roadmap/archive/`.

Si la sesión se satura a mitad de camino, el agente para en un corte de fase (DoD verde + `PROGRESS.md`) y la próxima sesión retoma el mismo prompt: `PROGRESS.md` dice cuál es la siguiente tarea vacía.

```text
Sos un agente autónomo de ingeniería en el repo murray-infra.

## Misión
Implementá las fases vivas 07 → 08 → 09 → 10 hasta el 100% del DoD de cada una.
Esta misión autoriza encadenar las cuatro fases en la misma sesión.
Igual: UNA sola tarea a la vez. No abras la fase N+1 hasta que la N tenga todas las tareas tildadas en PROGRESS.md y sus comandos de verificación en verde.

No re-implementes el bootstrap. No toques el endurecimiento del socket Docker.

## Orden de lectura (en este orden, nada más al arrancar)
1. .agents/skills/dev-protocol/SKILL.md
2. .agents/skills/dev-protocol/lessons-learned.md
3. HANDOFF.md
4. roadmap/00_AGENT_PROTOCOL.md
5. PROGRESS.md
6. SOLO el archivo de la fase que vas a ejecutar ahora:
   - roadmap/07_MURRAY_SQLITE_WAL.md
   - después 08_EMAIL_MEMORY_SEEN.md
   - después 09_LITELLM_GATEWAY.md
   - después 10_SANDBOX_LIFECYCLE_TTL.md

No leas roadmap/archive/ para implementar. No leas roadmap/90_BACKLOG_HARDENING.md para implementar. No trates MURRAY_SYSTEM_BLUEPRINT_FOR_AI.md como ley.

## Estado actual (2026-09-18)
- Fases 1–6 CERRADAS (histórico en roadmap/archive/). Stack Compose ya corre: postgres, cloudflared, n8n, workspace-mcp, murray-agent, openhands.
- murray-agent hoy persiste jobs/memoria/sesión en JSON y HITL en un Map en RAM.
- email_triage_draft (id Z8f9K2mP1qRt5vWx) deduplica con $getWorkflowStaticData. workspace-mcp es draft-only y no debe ganar estado.
- Murray y OpenHands pegan a DeepSeek en directo. Todavía no hay contenedor litellm.
- Socket: /var/run/docker.sock montado en murray-agent y openhands. ops.mjs es el allowlist. ESO NO SE CAMBIA.
- Humanos H1–H12 hechos. H13 (GEMINI_API_KEY + LITELLM_MASTER_KEY) y H14 (reimport del triage) son del operador DESPUÉS de las fases 9 y 8. Vos no los hagas. Dejalos escritos en PROGRESS.md.
- architecture_spec.md es contrato de lo que YA corre. Actualizalo solo al cumplir el DoD de cada fase, en el mismo cambio que el código. No lo reescribas al inicio.

## Rama y git
- Creá rama feat/murray-db-litellm-ttl desde la base actual.
- Commits locales OK si el humano no dijo lo contrario. Push / merge a main SOLO con OK explícito del humano (dev-protocol approval gate).
- No commitees .env, .gauth.json, ni MURRAY_SYSTEM_BLUEPRINT_FOR_AI.md.
- No actualices git config. No --no-verify.

## Cómo ejecutar cada fase
1. Leé SOLO el .md de esa fase.
2. Respetá "Archivos permitidos" y "Fuera de alcance".
3. Hacé la tarea N. Corré el comando de verificación de ESA tarea.
4. Si pasa: tildá en PROGRESS.md y seguí a la tarea N+1.
5. Si falla: máximo 2 correcciones. Si sigue rojo: BLOCKER.md y PARÁ. No inventes un proxy Docker para salir del blocker.
6. Al cerrar la fase: sync de docs que pide el DoD (architecture_spec.md, CONTEXT.md, lessons-learned.md) + tests verdes.

## Prohibido (aunque “mejore” el diseño)
- Re-ejecutar roadmap/archive/ (fases 1–6).
- Implementar roadmap/90_BACKLOG_HARDENING.md: tecnativa/docker-socket-proxy, DOCKER_HOST a un proxy, VOLUMES=0 como capa de seguridad, userns-remap, daemon.json.
- Sacar o agregar el bind /var/run/docker.sock en murray-agent u openhands.
- Quitar recreate de propose_ops “por si acaso”.
- Mover el estado de murray-agent a Postgres. Postgres 16 es SOLO de n8n.
- Guardar mails vistos en workspace-mcp o en static data de n8n.
- Cambiar el id del workflow email_triage_draft. Debe seguir Z8f9K2mP1qRt5vWx.
- Reusar GOOGLE_REFRESH_TOKEN / GOOGLE_CLIENT_SECRET como GEMINI_API_KEY.
- Llamar APIs LLM vivas desde node --test. Mock.
- GMAIL_ALLOW_SENDING=true. Segundo bot Telegram. Push a main/master desde el bot. Postgres 17.

## Destino por fase (resumen; el detalle manda el .md)
- 07: config/murray-agent/db.mjs + schema (jobs, hitl_tokens, session_context, seen_emails). WAL. Node 22 + node:sqlite (no better-sqlite3). Migrar jobs.json / memory.json / session.json si existen y la tabla está vacía, rename a *.migrated. Stores con la misma API pública. MURRAY_DB_PATH en compose. No endpoints /triage/*. No litellm.
- 08: POST /triage/filter y /triage/mark-seen. Tool list_seen_emails (ids + hora, CERO subjects). Reescribir workflows/email_triage_draft.json (sin staticData). Mark-seen solo tras draft 2xx. No migrar staticData.seen (un ciclo de re-draft está aceptado). Recordá H14 para el humano.
- 09: servicio litellm en agent-net. config/litellm/config.yaml sin keys. Primario deepseek/deepseek-chat. Fallback gemini/gemini-2.5-flash. OpenHands LLM_BASE_URL=http://litellm:4000 model murray-worker. Murray vía LITELLM_BASE_URL + LITELLM_MASTER_KEY. /model escribe session_context.active_model. .env.example con placeholders. Recordá H13 para el humano. Techo RAM 4.5 GiB sigue.
- 10: hook al kick de job code + watcher 5 min / TTL 30 min. Solo oh-agent-server-*. No reemplaza heal_openhands. Tests de reloj sin Docker vivo. Socket intacto. Cero socket-proxy-*.

## Cuando termines las cuatro
1. PROGRESS.md: 07–10 todas tildadas. H13/H14 siguen vacíos (humanos).
2. Corré la suite que cada DoD pidió (al menos jobs, murray-agent HTTP, seen emails, llm gateway, sandbox ttl, coding session, triage).
3. docker compose config: /var/run/docker.sock SIGUE en murray-agent y openhands. Cero servicio socket-proxy.
4. Informe al humano: qué cambió, cómo verificar, que H14 importa el triage y H13 pega Gemini + LITELLM_MASTER_KEY. No hagas push.

Si el contexto se satura: terminá la fase en curso (DoD + docs + PROGRESS) y pedí sesión nueva con este mismo prompt. No arranques la fase siguiente a medias.
```
