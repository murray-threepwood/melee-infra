# 10. Fase 10: Lifecycle de sandboxes + TTL 30 min

Limpieza **operativa** de contenedores `oh-agent-server-*`. El socket Docker **no cambia**: sigue el bind actual y el allowlist de `ops.mjs`.

**Precondición**: fase 07 al 100% (tabla `jobs`). No requiere fase 08 ni 09. No requiere proxies.

## Prompt de arranque

```text
Leé roadmap/00_AGENT_PROTOCOL.md y SOLO roadmap/10_SANDBOX_LIFECYCLE_TTL.md.
Implementá esta fase. No abras archive/ ni 90_BACKLOG_HARDENING.md.
No saques docker.sock. No agregues tecnativa/docker-socket-proxy. No toques recreate.
No toques Gmail ni litellm. Una tarea a la vez. Verificación + DoD. PROGRESS.md.
```

## Decisiones cerradas

- Hook al **inicio** de un kick de job `code` (antes de `startConversation`): si no hay otro job `code` u `oh_poll` en `running`, purgar `oh-agent-server-*` huérfanos.
- Watcher interno cada **5 minutos**: `docker rm -f` de sandboxes con más de **30 minutos** de vida si no hay job de código en vuelo (`code` / `oh_poll` con status `running`).
- Mismo regex que heal: `^oh-agent-server-` (`OH_SANDBOX_NAME_RE` en `ops.mjs`).
- No reemplaza HITL `heal_openhands` (eso sigue para obrero enfermo *ahora*).
- `rm` solo por ese regex + IDs allowlist. Prohibido `prune`, `down`, `-v`, `compose down`.
- Reloj inyectable en tests (`now = () => …`). Default de tests: **sin** Docker vivo.

## Fuera de alcance

- `tecnativa/docker-socket-proxy`, `DOCKER_HOST`, `userns-remap`, `daemon.json`.
- Sacar o agregar el volume `/var/run/docker.sock`.
- Quitar `recreate` de `propose_ops`.
- Cambiar el workflow de Gmail o LiteLLM.
- Purgar contenedores que no matcheen `oh-agent-server-*`.

## Archivos permitidos

- `config/murray-agent/ops.mjs`
- `config/murray-agent/jobs.mjs` (hook en kick)
- Módulo nuevo chico: `config/murray-agent/sandbox-ttl.mjs`
- `config/murray-agent/server.mjs` (arrancar el watcher)
- `tests/test_sandbox_ttl.mjs` (nuevo), ajustes mínimos de `tests/test_jobs.mjs` / `tests/test_triage.mjs`
- Al cerrar 10.4: `architecture_spec.md`, `CONTEXT.md`, `lessons-learned.md`

---

## Tarea 10.1: Helper purge + regex

- **Objetivo**: una función pura decide qué IDs borrar. Docker es un puerto inyectable.
- **Acciones Requeridas**:
  1. `sandbox-ttl.mjs` exporta:
     - `TTL_MS = 30 * 60 * 1000`
     - `WATCH_EVERY_MS = 5 * 60 * 1000`
     - `isCodeFlight(jobs)` → true si algún job `code` o `oh_poll` tiene `status === "running"`
     - `selectExpiredSandboxes(rows, { now, ttlMs })` → subset de `{ id, name, createdAt }` que matchean `OH_SANDBOX_NAME_RE` y `now - createdAt >= ttlMs`
     - `selectOrphans(rows)` → todos los que matchean el regex (para el hook de kick)
  2. `ops.mjs` expone `purgeOpenHandsSandboxes(ids)` reusando `assertHealRmArgs` (mismos checks: `rm -f` + hex + ids allowlist). No abras `prune`.
  3. Listar sandboxes: el mismo `listOpenHandsSandboxes` de hoy, más `createdAt` si hace falta (epoch ms). Si `docker ps` no da created fácil, `inspect` **solo** de esos nombres. No inspecciones todo el host.
- **Comando de Verificación**:
  ```bash
  node --test tests/test_sandbox_ttl.mjs
  ```
- **DoD**: tests **sin** spawn de `docker`: regex acepta `oh-agent-server-abc`, rechaza `murray-n8n` y `oh-runtime-foo`. Un row de 29 min no se borra; uno de 31 min sí. `isCodeFlight` true bloquea el watcher (la función de decisión, no el rm).

---

## Tarea 10.2: Hook al inicio del job

- **Objetivo**: un kick de código no nace encima de zombies si no hay vuelo.
- **Acciones Requeridas**:
  1. En el worker, **antes** de llamar a OpenHands para un job `code`:
     - Si `isCodeFlight` (otro `code`/`oh_poll` `running` distinto de este) → no purgues; el mutex de kick sigue vigente.
     - Si no hay vuelo → `selectOrphans` + `purgeOpenHandsSandboxes`.
  2. Falla de purge: logueá en el job (`appendLog`) y **seguí** con el kick (un zombie que no se pudo borrar no cancela la misión). No tires el proceso.
  3. No purgues en `clone` / `pull` / `push` / `delete` / `checkout`.
- **Comando de Verificación**:
  ```bash
  node --test tests/test_sandbox_ttl.mjs tests/test_jobs.mjs
  ```
- **DoD**: un test de worker con `ops.purgeOpenHandsSandboxes` mock prueba: job `code` sin vuelo llama purge; job `pull` no llama; segundo `code` con otro `running` no llama.

---

## Tarea 10.3: Watcher 30 min

- **Objetivo**: cada 5 min, fuera de un vuelo, borrar sandboxes viejos.
- **Acciones Requeridas**:
  1. Al boot de `server.mjs`, `setInterval` de `WATCH_EVERY_MS` (o `setTimeout` encadenado). `unref()` para no impedir el exit en tests.
  2. Tick: listar sandboxes → si `isCodeFlight` return → si no, `selectExpiredSandboxes` → purge de esos IDs.
  3. Reloj y `list`/`purge` inyectables. Intervalo configurable por env `MURRAY_SANDBOX_TTL_MS` / `MURRAY_SANDBOX_WATCH_MS` **solo** para tests (defaults = 30 min / 5 min).
  4. El watcher **no** reinicia `openhands` (eso es heal HITL).
- **Comando de Verificación**:
  ```bash
  node --test tests/test_sandbox_ttl.mjs
  ```
- **DoD**: un tick con vuelo no llama purge. Un tick sin vuelo y un sandbox de 31 min llama purge con ese id. Un sandbox de 10 min no entra.

---

## Tarea 10.4: Tests y sync de docs

- **Objetivo**: docs y tests alineados. Socket intacto.
- **Acciones Requeridas**:
  1. `node --test tests/test_sandbox_ttl.mjs tests/test_jobs.mjs tests/test_triage.mjs tests/test_murray_agent_http.mjs`
  2. `docker compose config` todavía monta `/var/run/docker.sock` en `murray-agent` y `openhands`. Cero servicio `socket-proxy-*`.
  3. Docs:
     - `architecture_spec.md`: hook + TTL 30 min + watcher 5 min. Heal HITL sigue.
     - `CONTEXT.md`: término **sandbox TTL** (purga automática de `oh-agent-server-*` > 30 min sin job en vuelo).
     - `lessons-learned.md`: el TTL no reemplaza `heal_openhands`; no es `docker rm` libre.
  4. Tildá 10.1–10.4 en `PROGRESS.md`.
- **Comando de Verificación**:
  ```bash
  node --test tests/test_sandbox_ttl.mjs tests/test_jobs.mjs tests/test_triage.mjs && \
  docker compose config | grep -c '/var/run/docker.sock' | grep -q '[2-9]' && \
  ! docker compose config | grep -q 'socket-proxy' && \
  echo "SANDBOX_TTL_DOCS_SOCKET_OK"
  ```
- **DoD**: stdout `SANDBOX_TTL_DOCS_SOCKET_OK`. Tests verdes. Socket sin proxies.
