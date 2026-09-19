# 91. Ventana permisiva (inventario para hardening)

> **NO es una fase de implementación nueva.** Es el inventario de relajos que se abrieron el 2026-09-19 para que Garfio deje de morir en el primer token.
> Un agente de ciberseguridad tiene que **revertir o encapsular** cada fila. Hasta entonces, el cluster corre más abierto a propósito.

## Por qué se abrió

El sandbox `oh-agent-server-*` nace en el Docker `bridge` default, **no** en `murray-infra_agent-net`.

Síntomas reproducidos:

| Señal | Evidencia |
| :--- | :--- |
| `LLM Provider NOT provided` con `deepseek-chat` pelado | conversación previa; se parcheó con `openai/` |
| `OPENAI_API_KEY` vacío con `llm_model=openai/deepseek-chat` | logs del sandbox 2026-09-19 14:41:36Z |
| `litellm` NXDOMAIN desde el sandbox | `getent hosts litellm` → NO |
| `host.docker.internal:4000` connection refused | LiteLLM no estaba publicado al host |
| Sandbox **sin mounts** | `docker inspect` Mounts vacío; `/workspace/project` solo `.git` dummy |
| `WORKSPACE_MOUNT_PATH=./workspace` relativo | OpenHands no bind-monta el repo clonado |
| `Secret name 'LLM_API_KEY' starts with reserved prefix 'LLM_'` | start-task ERROR; poll `start_error`; job `71651762dd784273` |

## Relajos vivos (revertir)

| ID | Qué se relajó | Archivo | Revertir a |
| :--- | :--- | :--- | :--- |
| P1 | LiteLLM publicado en `127.0.0.1:4000` | `docker-compose.yml` `ports` de `litellm` | Sin `ports`. Solo `agent-net`. |
| P2 | `LLM_BASE_URL` / `OPENAI_BASE_URL` = `http://host.docker.internal:4000` | `openhands` env | URL interna `http://litellm:4000` **si** el sandbox está en `agent-net`. |
| P3 | `OPENAI_API_KEY=${LITELLM_MASTER_KEY}` duplicada en OpenHands | `openhands` env | Quitar `OPENAI_*` cuando el SDK reciba `api_key`+`base_url` bien. |
| P4 | `startConversation` manda `secrets.OPENAI_API_KEY` (master) | `openhands.mjs` | No mandar master key en el body; inyectar por red interna. **Nunca** `LLM_API_KEY`: OpenHands 1.36 `validate_secret_name` rechaza prefijo `LLM_` → start_error. |
| P5 | `WORKSPACE_MOUNT_PATH` absoluto + `SANDBOX_VOLUMES` RW de todo `./workspace` | `openhands` env | Mount por slug, RO donde se pueda, o red `agent-net` + bind explícito. |
| P6 | `MURRAY_HITL_BYPASS=code,clone` (default compose) | `murray-agent` env | Default vacío. Clone/código vuelven a teclado Aprobar. **Push/delete/ops no se bypassearon.** |
| P7 | `MURRAY_TELEGRAM_QUIET=1` (default compose) silencia **progreso**; pausa/tranca/fin sí suenan | `telegram.mjs` `terminal` | Default `0`. El inbound de n8n (`/chat` → Responder Murray) sigue vivo. |
| P8 | `MAX_ITERATIONS=80` | `openhands` env | Volver a 30 si el presupuesto de tokens duele. |
| P10 | `OH_AGENT_SERVER_ENV` inyecta `OPENAI_API_KEY` / `LITELLM_PROXY_API_KEY` en el sandbox | `openhands` env | OpenHands 1.36 solo auto-forward `LLM_*`. Sin esto el SDK pide `OPENAI_API_KEY` y muere. |
| P11 | Relajo de nombres de secreto: `OPENAI_API_KEY` en body + env del sandbox | `openhands.mjs` + compose | El SDK `openai/` ignora `LLM_API_KEY`. `secrets.LLM_*` está **vedado** (reserved prefix). Hardening: meter sandbox en `agent-net` y dejar de pasar la master por `secrets`. |
| P12 | Inspect auto-ops **sin HITL**: `retry_stuck`, `heal_openhands`, `restart`/`recreate` (allowlist, **nunca** `postgres_db`) cuando el JSON de inspect trae finding | `inspect.mjs` / `coding.mjs` | Volver a teclado HITL para heal/restart/recreate. El chat `propose_ops` **sigue** pidiendo Aprobar. Push a main y force siguen vedados. |

## Qué NO se tocó (sigue en backlog 90)

- Bind directo de `/var/run/docker.sock` en `murray-agent` y `openhands`.
- Sin `tecnativa/docker-socket-proxy`, sin `userns-remap`.
- `GMAIL_ALLOW_SENDING=false`.
- Push a `main`/`master` y `--force` siguen vedados.
- Un bot Telegram, un webhook.

## Cómo verificar que el relajo P1–P5 es la causa (no folklore)

```bash
# 1. Contrato en YAML (sin cluster)
node --test tests/test_openhands_sandbox_llm.mjs tests/test_hitl_policy.mjs tests/test_hitl_bypass.mjs tests/test_telegram_quiet.mjs

# 2. Desde un contenedor en bridge, como el sandbox:
#    GET http://host.docker.internal:4000/health/liveliness → 200
bash tests/test_live_sandbox_llm.sh
```

Si P1 se cierra sin meter el sandbox en `agent-net`, Garfio vuelve a morir.
