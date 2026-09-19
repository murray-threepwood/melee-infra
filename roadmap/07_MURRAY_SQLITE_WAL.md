# 07. Fase 7: `murray.db` (SQLite WAL)

Murray pasa a ser el dueño del estado del sistema en un solo archivo SQLite. Postgres **no se toca**: sigue siendo solo de n8n.

## Prompt de arranque

```text
Leé roadmap/00_AGENT_PROTOCOL.md y SOLO roadmap/07_MURRAY_SQLITE_WAL.md.
Implementá esta fase. No abras 08, 09, 10, archive/ ni 90_BACKLOG_HARDENING.md.
No toques docker.sock, no agregues proxies, no cambies el workflow de Gmail, no agregues litellm.
Una tarea a la vez. Verificación + DoD. PROGRESS.md al terminar cada tarea.
```

## Decisiones cerradas

- Un archivo `/var/lib/murray-agent/murray.db` en el volumen ya existente `murray_agent_data`.
- `PRAGMA journal_mode=WAL;` y `PRAGMA busy_timeout=5000;`.
- Motor: `node:sqlite` (stdlib). Subir la imagen de `murray-agent` a **Node 22**. Prohibido `better-sqlite3` (native build en Alpine).
- Murray es el único proceso que escribe la DB. n8n no abre el archivo: habla HTTP (eso es fase 08).
- Tablas **todas** en esta fase, vacías de negocio salvo migración JSON. La fase 08 no inventa `ALTER TABLE`.

## Fuera de alcance

- `POST /triage/*`, tool de mails, `workflows/email_triage_draft.json`.
- Servicio `litellm`, `/model`, keys Gemini.
- TTL de sandboxes, `heal_openhands`, `recreate`.
- `docker-compose.yml` salvo lo imprescindible para rebuild de `murray-agent` (build context / env `MURRAY_DB_PATH`).
- Bind de `/var/run/docker.sock`. No lo saques ni lo dupliques.

## Archivos permitidos

- `config/murray-agent/Dockerfile`
- `config/murray-agent/db.mjs` (nuevo)
- `config/murray-agent/jobs.mjs`
- `config/murray-agent/memory.mjs`
- `config/murray-agent/session.mjs`
- `config/murray-agent/approvals.mjs`
- `config/murray-agent/server.mjs` (solo wiring de paths / store)
- `docker-compose.yml` (solo `MURRAY_DB_PATH` en el servicio `murray-agent`; no toques volumes de socket)
- `tests/test_jobs.mjs`, `tests/test_murray_agent_http.mjs` y tests unitarios nuevos bajo `tests/test_db.mjs` si hace falta
- `.env.example` (`MURRAY_DB_PATH`)
- Al cerrar DoD 7.4: `architecture_spec.md`, `CONTEXT.md`, `.agents/skills/dev-protocol/lessons-learned.md`

---

## Tarea 7.1: Módulo `db.mjs` + schema + WAL

- **Objetivo**: Un único módulo abre `murray.db`, aplica schema idempotente y deja WAL.
- **Acciones Requeridas**:
  1. Crear `config/murray-agent/db.mjs` que exporte `openMurrayDb({ filePath })`.
  2. Path default: `process.env.MURRAY_DB_PATH` o `/var/lib/murray-agent/murray.db`.
  3. `mkdir` del directorio padre si no existe.
  4. Ejecutar al abrir:

     ```sql
     PRAGMA journal_mode=WAL;
     PRAGMA busy_timeout=5000;
     PRAGMA foreign_keys=ON;

     CREATE TABLE IF NOT EXISTS jobs (
       id TEXT PRIMARY KEY,
       type TEXT NOT NULL,
       status TEXT NOT NULL,
       chat_id TEXT NOT NULL DEFAULT '',
       payload TEXT NOT NULL DEFAULT '{}',
       error TEXT NOT NULL DEFAULT '',
       log TEXT NOT NULL DEFAULT '[]',
       created_at INTEGER NOT NULL,
       run_after INTEGER NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL
     );

     CREATE TABLE IF NOT EXISTS hitl_tokens (
       id TEXT PRIMARY KEY,
       payload TEXT NOT NULL DEFAULT '{}',
       expires_at INTEGER NOT NULL,
       used INTEGER NOT NULL DEFAULT 0
     );

     CREATE TABLE IF NOT EXISTS session_context (
       chat_id TEXT PRIMARY KEY,
       messages TEXT NOT NULL DEFAULT '[]',
       slug TEXT NOT NULL DEFAULT '',
       url TEXT NOT NULL DEFAULT '',
       conversation_id TEXT NOT NULL DEFAULT '',
       last_test_command TEXT NOT NULL DEFAULT '',
       last_mission TEXT NOT NULL DEFAULT '',
       last_job_id TEXT NOT NULL DEFAULT '',
       awaiting_instruction INTEGER NOT NULL DEFAULT 0,
       active_model TEXT NOT NULL DEFAULT ''
     );

     CREATE TABLE IF NOT EXISTS seen_emails (
       message_id TEXT PRIMARY KEY,
       thread_id TEXT NOT NULL DEFAULT '',
       processed_at INTEGER NOT NULL
     );
     ```

  5. `payload`, `log` y `messages` se serializan como JSON text. Los stores parsean al leer.
  6. No expongas SQL crudo al LLM. Ningún tool de chat corre queries libres.
- **Comando de Verificación**:
  ```bash
  node --input-type=module -e "
  import { openMurrayDb } from './config/murray-agent/db.mjs';
  import fs from 'node:fs';
  import os from 'node:os';
  import path from 'node:path';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murray-db-'));
  const filePath = path.join(dir, 'murray.db');
  const db = openMurrayDb({ filePath });
  const wal = db.prepare('PRAGMA journal_mode;').get();
  const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").all().map((r) => r.name);
  const need = ['hitl_tokens','jobs','seen_emails','session_context'];
  if (String(wal.journal_mode).toLowerCase() !== 'wal') throw new Error('WAL_OFF');
  for (const t of need) if (!tables.includes(t)) throw new Error('missing '+t);
  console.log('MURRAY_DB_SCHEMA_WAL_OK');
  "
  ```
- **DoD**: stdout `MURRAY_DB_SCHEMA_WAL_OK`.

---

## Tarea 7.2: Migración JSON y reemplazo de stores

- **Objetivo**: `jobs`, memoria de chat, sesión y tokens HITL leen/escriben SQLite. Misma API pública que hoy, para no reescribir `chat.mjs` / `coding.mjs`.
- **Acciones Requeridas**:
  1. `createJobStore` deja de usar `jobs.json` como fuente de verdad. Persistí las columnas de 7.1. `payload` y `log` siguen siendo objetos/arrays en JS.
  2. `createMemory` y `createSessionStore` usan `session_context` (un row por `chat_id`). Memoria = `messages` (cap 20, como ahora). Sesión = el resto de columnas. `active_model` existe pero **nadie lo escribe todavía** (fase 09).
  3. `createApprovalStore` persiste en `hitl_tokens`. `id` sigue siendo 16 hex (`crypto.randomBytes(8)`). TTL 15 min. Un uso. `peek` / `take` ignoran `used=1` o `expires_at < now`.
  4. Migración **one-shot** al abrir la DB, solo si la tabla destino está vacía y el JSON existe:
     - `jobs.json` → `jobs`, después rename a `jobs.json.migrated`
     - `memory.json` → `session_context.messages`, rename a `memory.json.migrated`
     - `session.json` → resto de `session_context`, rename a `session.json.migrated`
     - Si el row de sesión ya existe por memory, hacé `UPDATE` de columnas de sesión sin borrar `messages`.
  5. Tokens HITL en RAM **no** se migran (TTL 15 min).
  6. Env nuevo: `MURRAY_DB_PATH=/var/lib/murray-agent/murray.db`. Podés dejar `MURRAY_JOBS_PATH` / `MURRAY_MEMORY_PATH` / `MURRAY_SESSION_PATH` solo como origen de migración.
- **Comando de Verificación**:
  ```bash
  node --test tests/test_jobs.mjs tests/test_murray_agent_http.mjs
  ```
- **DoD**: tests en verde. Un job encolado sobrevive a reabrir la DB (agregá un caso en `tests/test_jobs.mjs` o `tests/test_db.mjs` que escriba, cierre, abra, y lea el mismo `id`).

---

## Tarea 7.3: Imagen Node 22

- **Objetivo**: `node:sqlite` existe en el runtime del contenedor.
- **Acciones Requeridas**:
  1. En `config/murray-agent/Dockerfile`: `FROM node:22-alpine`. Seguí instalando `docker-cli`, `docker-cli-compose`, `git`.
  2. En compose, `murray-agent` envía `MURRAY_DB_PATH=/var/lib/murray-agent/murray.db`. El volumen `murray_agent_data:/var/lib/murray-agent` **ya existe**; no lo renombres.
  3. Rebuild: el humano o el agente de esta fase corre `docker compose up -d --build murray-agent` **solo si** van a verificar el contenedor. Los tests de 7.2 corren en el host con Node 22.
- **Comando de Verificación**:
  ```bash
  grep -q 'FROM node:22-alpine' config/murray-agent/Dockerfile && \
  docker compose config | grep -q 'MURRAY_DB_PATH' && \
  echo "MURRAY_NODE22_DB_PATH_OK"
  ```
- **DoD**: stdout `MURRAY_NODE22_DB_PATH_OK`. `docker compose config` sigue mostrando el bind `/var/run/docker.sock` en `murray-agent` (no lo hayas sacado).

---

## Tarea 7.4: Tests y sync de docs

- **Objetivo**: el contrato vivo coincide con SQLite. Las lecciones dejan de mandar `jobs.json` como fuente de verdad.
- **Acciones Requeridas**:
  1. `node --test tests/test_jobs.mjs tests/test_coding_session.mjs tests/test_murray_agent_http.mjs tests/test_triage.mjs` en verde (más `tests/test_db.mjs` si lo creaste).
  2. En el **mismo cambio**, actualizar:
     - `architecture_spec.md`: persistencia Murray = `murray.db` WAL; tablas listadas; JSON migrados.
     - `CONTEXT.md`: término **Job** deja de decir `jobs.json`; pasa a `murray.db`.
     - `lessons-learned.md`: `/jobs` lee SQLite, no `jobs.json`.
  3. Tildá 7.1–7.4 en `PROGRESS.md`.
- **Comando de Verificación**:
  ```bash
  node --test tests/test_jobs.mjs tests/test_coding_session.mjs tests/test_murray_agent_http.mjs tests/test_triage.mjs
  ```
- **DoD**: tests verdes + los tres docs ya no presentan `jobs.json` como store vigente.
