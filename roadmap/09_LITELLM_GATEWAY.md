# 09. Fase 9: Gateway LiteLLM (DeepSeek + Gemini)

Un contenedor `litellm` en `agent-net` es el único origen de modelos para Murray y OpenHands. Primario DeepSeek. Fallback Gemini (cuenta Google de Murray, **no** el OAuth de Gmail).

**Precondición**: fase 07 al 100% (`session_context.active_model` ya existe).

## Prompt de arranque

```text
Leé roadmap/00_AGENT_PROTOCOL.md y SOLO roadmap/09_LITELLM_GATEWAY.md.
Implementá esta fase. No abras 08 (salvo leer contratos), 10, archive/ ni 90_BACKLOG_HARDENING.md.
No toques docker.sock ni proxies. No toques el workflow de Gmail.
Una tarea a la vez. Verificación + DoD. PROGRESS.md.
```

## Decisiones cerradas

- Servicio Compose `litellm` en `agent-net`. Sin puerto publicado al host, o como máximo `127.0.0.1:4000`.
- Config versionada en `config/litellm/config.yaml`. Cero API keys en ese archivo.
- Primario: `deepseek/deepseek-chat` con `DEEPSEEK_API_KEY`.
- Fallback del router: `gemini/gemini-2.5-flash` con `GEMINI_API_KEY`.
- OpenHands **siempre** pega a `http://litellm:4000` con el alias `murray-worker`. El fallback lo hace LiteLLM, no OpenHands.
- Murray pega al mismo gateway. `/model` cambia `session_context.active_model` (por chat).
- Modelos nombrados permitidos: `deepseek-chat`, `deepseek-reasoner`, `gemini-2.5-flash`.
- `GEMINI_API_KEY` nace en [Google AI Studio](https://aistudio.google.com/) con la cuenta Google de Murray. **Prohibido** reusar `GOOGLE_REFRESH_TOKEN` / `GOOGLE_CLIENT_SECRET`.
- Techo RAM 4.5 GiB **sigue**. LiteLLM entra en el presupuesto. Si lo supera, documentalo; no saques el gateway.
- Tests **no** llaman APIs vivas. Mock del gateway.

## Fuera de alcance

- Socket Docker, proxies, `userns`.
- Endpoints `/triage/*`, workflow de Gmail.
- TTL de sandboxes.
- Vertex AI / Service Account. Esta fase es API key de AI Studio.
- Más proveedores (OpenAI, Anthropic).

## Archivos permitidos

- `config/litellm/config.yaml` (nuevo)
- `docker-compose.yml` (alta `litellm` + env de `murray-agent` y `openhands`; **no** toques volumes de socket)
- `config/murray-agent/llm.mjs`
- `config/murray-agent/chat.mjs` (comando `/model`)
- `config/murray-agent/session.mjs` / stores (solo `active_model`)
- `config/murray-agent/server.mjs` / `persona.md` si hace falta
- `.env.example`
- `tests/test_llm_gateway.mjs` (nuevo) y ajustes de `tests/test_murray_agent_http.mjs`
- Al cerrar 9.5: `architecture_spec.md`, `CONTEXT.md`, `lessons-learned.md`

---

## Tarea 9.1: Servicio `litellm` + config

- **Objetivo**: el compose declara el gateway con fallback.
- **Acciones Requeridas**:
  1. Imagen: pinneá un tag publicado de `ghcr.io/berriai/litellm` (no `:latest` flotante). Verificá el tag con `docker pull` al implementar.
  2. `container_name: murray-litellm`. `restart: unless-stopped`. Red `agent-net`.
  3. Command que cargue `/app/config.yaml`.
  4. Volume: `./config/litellm/config.yaml:/app/config.yaml:ro`.
  5. Env: `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `LITELLM_MASTER_KEY`. Nada hardcodeado.
  6. Healthcheck HTTP al puerto interno 4000 (`/health` o `/health/liveliness` según el tag; si el path del tag no existe, usá el que documente esa imagen y dejalo escrito en un comentario del compose).
  7. `config/litellm/config.yaml` debe definir:
     - Modelos reales: `deepseek/deepseek-chat`, `deepseek/deepseek-reasoner`, `gemini/gemini-2.5-flash`.
     - Alias `murray-worker` → primario DeepSeek chat, fallback Gemini flash.
     - Alias `murray-chat` → mismo fallback (Murray puede apuntar acá si `active_model` está vacío).
     - `general_settings.master_key` lee `LITELLM_MASTER_KEY` (sintaxis env de LiteLLM, no pegues el valor).
  8. `depends_on` de `murray-agent` y `openhands` hacia `litellm` **no** es obligatorio si el healthcheck no está listo en el tag. Preferí healthcheck + `service_healthy` si el endpoint existe.
- **Comando de Verificación**:
  ```bash
  docker compose config >/tmp/murray-compose.yml && \
  grep -q 'murray-litellm' /tmp/murray-compose.yml && \
  grep -q 'LITELLM_MASTER_KEY' /tmp/murray-compose.yml && \
  test -f config/litellm/config.yaml && \
  grep -q 'deepseek/deepseek-chat' config/litellm/config.yaml && \
  grep -q 'gemini/gemini-2.5-flash' config/litellm/config.yaml && \
  grep -q 'murray-worker' config/litellm/config.yaml && \
  echo "LITELLM_COMPOSE_CONFIG_OK"
  ```
- **DoD**: stdout `LITELLM_COMPOSE_CONFIG_OK`. `docker compose config` **sigue** mostrando `/var/run/docker.sock` en `murray-agent` y `openhands`.

---

## Tarea 9.2: Reencaminar Murray y OpenHands

- **Objetivo**: nadie pega a `api.deepseek.com` desde esos dos servicios.
- **Acciones Requeridas**:
  1. `openhands`:
     - `LLM_BASE_URL=http://litellm:4000`
     - `LLM_MODEL=murray-worker`
     - `LLM_API_KEY=${LITELLM_MASTER_KEY}`
  2. `murray-agent`:
     - `LITELLM_BASE_URL=http://litellm:4000`
     - `LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}`
     - `createLlm` usa esos valores (base + Bearer master key). El `model` por request sale de 9.3.
  3. Sacá `DEEPSEEK_BASE_URL=https://api.deepseek.com/v1` del servicio `murray-agent` y `LLM_BASE_URL=https://api.deepseek.com/v1` de `openhands`.
  4. `DEEPSEEK_API_KEY` **sigue** en `.env` y en el servicio `litellm`, no en OpenHands.
- **Comando de Verificación**:
  ```bash
  docker compose config | grep -A2 'LLM_BASE_URL' | grep -q 'http://litellm:4000' && \
  ! docker compose config | grep -q 'api.deepseek.com' && \
  echo "LITELLM_ROUTING_OK"
  ```
- **DoD**: stdout `LITELLM_ROUTING_OK`. DeepSeek queda solo como env del contenedor `litellm` (la key), no como URL de Murray/OpenHands.

---

## Tarea 9.3: `/model` + `active_model`

- **Objetivo**: el CEO cambia el modelo de **Murray** por chat. OpenHands no cambia de alias.
- **Acciones Requeridas**:
  1. Comando `/model` (slash, sin LLM):
     - `/model` → lista `deepseek-chat`, `deepseek-reasoner`, `gemini-2.5-flash` y el activo (o `murray-chat` si vacío).
     - `/model deepseek-chat` | `deepseek-reasoner` | `gemini-2.5-flash` → `session_context.active_model` + reply corto.
     - Otro valor → error, no toques la DB.
  2. `createLlm.complete` usa `active_model` del chat. Si está vacío, `murray-chat`.
  3. Mapeo al nombre que LiteLLM espera (los tres nombres de arriba, o el alias `murray-chat` cuando está vacío).
  4. OpenHands **no** lee `active_model`.
- **Comando de Verificación**:
  ```bash
  node --test tests/test_llm_gateway.mjs tests/test_murray_agent_http.mjs
  ```
- **DoD**: tests cubren lista, set válido, set inválido, y complete() con el modelo del store (mock fetch, sin red).

---

## Tarea 9.4: Tests y `.env.example`

- **Objetivo**: placeholders y tests deterministas.
- **Acciones Requeridas**:
  1. En `.env.example` agregá (placeholders, no keys reales):

     ```bash
     # LiteLLM gateway (fase 09). Gemini = AI Studio, NO el refresh de Gmail.
     LITELLM_MASTER_KEY=clave_aleatoria_litellm_32_hex
     GEMINI_API_KEY=REEMPLAZAR_CON_GEMINI_AI_STUDIO
     ```

  2. Tests mockean `http://litellm:4000/chat/completions` (o el base inyectado).
  3. Si `GEMINI_API_KEY` está vacía, el compose tiene que **parsear**. El fallback live no es DoD. El humano completa H13.
  4. No llames DeepSeek ni Gemini desde `node --test`.
- **Comando de Verificación**:
  ```bash
  grep -q 'GEMINI_API_KEY=' .env.example && \
  grep -q 'LITELLM_MASTER_KEY=' .env.example && \
  ! grep -qE 'GOOGLE_REFRESH_TOKEN' config/litellm/config.yaml && \
  node --test tests/test_llm_gateway.mjs && \
  echo "LITELLM_ENV_TESTS_OK"
  ```
- **DoD**: stdout `LITELLM_ENV_TESTS_OK`.

---

## Tarea 9.5: Sync de docs

- **Objetivo**: el contrato dice gateway, no URL directa.
- **Acciones Requeridas**:
  1. `architecture_spec.md`: servicio `litellm`, alias, `/model`, fallback DeepSeek → Gemini.
  2. `CONTEXT.md`: término **LiteLLM** (gateway en `agent-net`).
  3. `lessons-learned.md`: Murray y OpenHands no pegan a `api.deepseek.com`. Gemini ≠ OAuth Gmail.
  4. Si `tests/check_memory_budget.sh` o el E2E cuentan servicios, incluí `litellm` en el conteo. Techo 4.5 GiB.
- **Comando de Verificación**:
  ```bash
  grep -q 'litellm' architecture_spec.md && \
  grep -q 'gemini-2.5-flash' architecture_spec.md && \
  echo "LITELLM_DOCS_OK"
  ```
- **DoD**: stdout `LITELLM_DOCS_OK`.
