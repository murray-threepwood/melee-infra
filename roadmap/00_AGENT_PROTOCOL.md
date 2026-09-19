# 00. Protocolo y Reglas de Operación del Agente

Este documento establece las directrices operativas, restricciones de seguridad y el protocolo de resolución de problemas que **todo agente autónomo (Cursor, Claude Code, Gemini, OpenHands)** debe acatar al trabajar en este repositorio.

Las fases 1–6 están **cerradas** en [`archive/`](./archive/). El trabajo vivo es 07–10. El endurecimiento del socket Docker está en [`90_BACKLOG_HARDENING.md`](./90_BACKLOG_HARDENING.md) y **no se ejecuta** salvo orden humana explícita.

---

## 1. Rol y Principios de Trabajo

- **Rol**: Ingeniero Senior de Software y DevOps especializado en Infraestructura de Automatización y Agentes Autónomos.
- **Objetivo**: Implementar **una** fase viva (07–10) con verificación y DoD. No rehacer el bootstrap.
- **Criterio de Costo y Robustez**:
  - Maximizar el uso de software de código abierto y auto-hospedado (costo de licencia $0).
  - Emplear servicios de costo operativo mínimo (Cloudflare Zero Trust Free Tier, DeepSeek como primario, Gemini como fallback vía LiteLLM).
  - Red Docker interna aislada y healthchecks nativos: sí.
  - **Postgres vs SQLite (excepción cerrada)**:
    - PostgreSQL 16 es la persistencia de **n8n** (ejecuciones y credenciales). No la reemplaces por SQLite. No upgradées a Postgres 17.
    - El estado de **murray-agent** es SQLite WAL (`murray.db` en `murray_agent_data`) por decisión de arquitectura (fase 07). **No** lo “mejorés” moviéndolo a Postgres.
  - Si implementás una conveniencia de menor robustez, documentá la limitación.

---

## 2. Reglas Inquebrantables de Ejecución

1. **Determinismo Secuencial**:
   - Ejecutá **una sola tarea** a la vez.
   - **Una sola fase viva** por sesión.
   - NUNCA agrupes tareas de distintas fases.
   - NUNCA avances sin el comando de verificación y el DoD en verde.

2. **Qué está prohibido abrir**:
   - `roadmap/archive/` — histórico. No re-implementes esas tareas. No “arregles” el código para que coincida con ese texto.
   - `roadmap/90_BACKLOG_HARDENING.md` — backlog. No implementes doble proxy, `DOCKER_HOST` a un proxy, `VOLUMES=0` como capa de seguridad, ni `userns-remap`.
   - No saques ni agregues el bind `/var/run/docker.sock` en `murray-agent` u `openhands`. El socket **sigue como está**.
   - No implementes el paquete de socket Docker “de yapa” aunque el arquitecto lo haya elegido.
   - No guardes IDs de mail vistos en `workspace-mcp` ni en `$getWorkflowStaticData` de n8n (fase 08).
   - Después de la fase 09: no dejes `LLM_BASE_URL` de Murray u OpenHands apuntando en directo a `api.deepseek.com` ni a Gemini. El gateway es `litellm`.

3. **Verificación Obligatoria y Evidencia**:
   - Cada tarea define un comando bash de verificación.
   - Ejecutalo en el entorno real. Exit 0 + stdout esperado.

4. **Prohibición de Alucinación de Rutas y Servicios**:
   - Usá solo las rutas y nombres de este roadmap vivo.
   - No inventes carpetas temporales fuera del árbol del proyecto.
   - El sandbox de código es `./workspace`.

5. **Manejo Estricto de Secretos**:
   - Credenciales solo desde `.env`.
   - NUNCA hardcodees tokens en `docker-compose.yml`, tests o workflows.
   - Actualizá `.env.example` con placeholders por cada clave nueva.
   - `GEMINI_API_KEY` no es el `GOOGLE_REFRESH_TOKEN` de Gmail.

6. **Principio de Menor Privilegio**:
   - Tráfico público solo por `cloudflared`.
   - Auxiliares en `agent-net` sin puertos públicos, salvo loopback que ya exista o que una fase viva pida.

7. **Sync de docs al cumplir DoD**:
   - Cada fase lista qué líneas de `architecture_spec.md`, `CONTEXT.md` y `lessons-learned.md` actualiza el implementador **en el mismo cambio**.
   - No reescribas `architecture_spec.md` antes de que el código exista.

---

## 3. Seguimiento de Estado (`PROGRESS.md`)

Mantené `PROGRESS.md` en la raíz. Las fases 1–6 quedan tildadas (históricas). El trabajo nuevo usa este bloque:

```markdown
# Estado de Avance del Proyecto

Última actualización: YYYY-MM-DD HH:MM (UTC)
Agente ejecutor: [Cursor | Claude Code | Gemini | OpenHands]

## Fases históricas (no re-ejecutar)
- [x] Fases 1–6: bootstrap, n8n, MCP, OpenHands, E2E, coding sessions
  - Fuente: `roadmap/archive/`

## Fases vivas
- [ ] Fase 7: murray.db SQLite WAL
  - [ ] Tarea 7.1: Módulo db + schema + WAL
  - [ ] Tarea 7.2: Migración JSON y reemplazo de stores
  - [ ] Tarea 7.3: Imagen Node 22
  - [ ] Tarea 7.4: Tests y sync de docs
- [ ] Fase 8: Memoria de correos en murray.db
  - [ ] Tarea 8.1: POST /triage/filter y /triage/mark-seen
  - [ ] Tarea 8.2: Tool list_seen_emails
  - [ ] Tarea 8.3: Workflow email_triage_draft.json
  - [ ] Tarea 8.4: Tests
  - [ ] Tarea 8.5: Sync de docs
- [ ] Fase 9: Gateway LiteLLM
  - [ ] Tarea 9.1: Servicio litellm + config
  - [ ] Tarea 9.2: Reencaminar murray-agent y openhands
  - [ ] Tarea 9.3: /model + active_model
  - [ ] Tarea 9.4: Tests y .env.example
  - [ ] Tarea 9.5: Sync de docs
- [ ] Fase 10: Lifecycle + TTL 30 min
  - [ ] Tarea 10.1: Helper purge + regex
  - [ ] Tarea 10.2: Hook al inicio del job
  - [ ] Tarea 10.3: Watcher 30 min
  - [ ] Tarea 10.4: Tests y sync de docs

## Backlog (no ejecutar)
- [ ] 90: Endurecimiento socket Docker (doble proxy + userns-remap)
```

---

## 4. Protocolo de Diagnóstico y Manejo de Fallas

Si un comando de verificación falla o un contenedor no levanta:

### Paso 1: Diagnóstico No Destructivo
1. Inspeccioná los últimos 50 logs del contenedor involucrado:
   ```bash
   docker compose logs --tail=50 <nombre_servicio>
   ```
2. Inspeccioná el estado de los contenedores:
   ```bash
   docker compose ps -a
   ```
3. Verificá permisos de archivos montados y sintaxis (YAML, JSON, Bash).

### Paso 2: Autocorrección (Máximo 2 Intentos)
- **Intento 1**: Ajustar configuración, sintaxis o variables según el error exacto y reintentar.
- **Intento 2**: Si falló por timing o red, `docker compose restart <servicio>` y verificar.

### Paso 3: Detención y Creación de `BLOCKER.md`
Si tras dos intentos la verificación sigue fallando, **detené** y creá `BLOCKER.md` en la raíz:

```markdown
# Reporte de Bloqueo Técnico

- **Fecha/Hora**: YYYY-MM-DD HH:MM
- **Fase y Tarea**: [Ej. Fase 7 - Tarea 7.1]
- **Comando Ejecutado**:
  ```bash
  [Comando que falló]
  ```
- **Error Observado (stdout / stderr)**:
  ```text
  [Salida exacta del error]
  ```
- **Logs Relevantes del Contenedor**:
  ```text
  [Logs de docker compose logs --tail=50]
  ```
- **Hipótesis del Problema**: [Motivo técnico]
- **Alternativas de Solución Propuestas**:
  1. Alternativa A: [Descripción]
  2. Alternativa B: [Descripción]
```

Luego pedí intervención humana. No montes el socket Docker a un proxy para “salir del blocker”.
