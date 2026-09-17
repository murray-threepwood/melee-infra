# 06. Coding sessions por Telegram (Murray conductor + OpenHands obrero)

Fase posterior al stack 1-Person CEO. El CEO le habla a **Murray** para clonar un repo, preguntar, editar/testear, pushear una feature y borrar `./workspace`. OpenHands es el worker. Un bot, un webhook. Push nunca a `main`/`master`. Cero edición de `murray-infra`.

## Decisiones cerradas

- Híbrido: Murray = chat/HITL/progreso/stuck/git. OpenHands = mutar + tests en sandbox (sigue sin pushear).
- Repos: clones https GitHub/GitLab en `./workspace/<slug>`. Privados con `GITHUB_TOKEN`/`GITLAB_TOKEN` en `.env`.
- `/oh` y `sandbox:` siguen como escape hatch crudo.
- Disco: `/workspace` lista; delete HITL de cualquier path bajo `./workspace`.
- Git: status/diff/log/pull/checkout/commit sin HITL; push HITL a la rama actual si no es main/master. Clone shallow; unshallow on demand.

## Tareas (implementadas en `feat/telegram-coding-sessions`)

### 6.0 Spike OpenHands + timeouts

- Health real: `GET /health`.
- Follow-up: `POST /api/v1/app-conversations/{id}/send-message`.
- n8n `/chat` timeout 45s → jobs async.
- RAM: techo 4.5 GiB; hijos runtime de OpenHands cuentan.

### 6.1 Clone + Q&A

- `workspace.mjs` + HITL `APPROVE_CLONE`.
- Tools tree/read/grep. `/repo`.

### 6.2 Jobs async + Telegram outbound

- `jobs.mjs` + `telegram.mjs` `sendMessage` (mismo bot, solo `TELEGRAM_CHAT_ID`).

### 6.3 Misión código

- `propose_code_mission` + `APPROVE_CODE` → OpenHands. Reject no llama.

### 6.4 Stuck + opciones

- `detectStuck` + teclado `STUCK_RETRY|STOP|LOGS|CHG`.

### 6.5 Murray pregunta antes

- Sin URL → pedir URL. Sin repo activo → pedir clone. Sin test command → preguntar.

## Verificación

```bash
node --test tests/test_workspace.mjs tests/test_coding_session.mjs tests/test_murray_agent_http.mjs
python3 tests/test_hitl_dispatch.py
bash tests/test_e2e_stack.sh
```

Tras cambiar el JSON: import + publish + reactivar `telegram_hitl_router` + restart n8n. Recreate murray-agent con `--build` (imagen con `git`).
Commits en `./workspace`: `MURRAY_GIT_NAME` y `MURRAY_GIT_EMAIL` en `.env`, después `docker compose up -d --force-recreate murray-agent`.
