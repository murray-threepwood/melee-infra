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

## Relajos y Estado de Hardening (Reversión Completada)

| ID | Qué se relajó | Archivo | Estado / Resolución |
| :--- | :--- | :--- | :--- |
| P1 | LiteLLM publicado en `127.0.0.1:4000` | `docker-compose.yml` `ports` de `litellm` | **Revertido**. Sin `ports`. Confinado exclusivamente a `agent-net`. |
| P2 | `LLM_BASE_URL` = `http://host.docker.internal:4000` | `openhands` env | **Revertido**. Apunta a `http://litellm:4000` resolviendo en `agent-net`. |
| P3 | `OPENAI_API_KEY` duplicada en OpenHands | `openhands` env | **Revertido**. Variables superfluas eliminadas del contenedor. |
| P4 | `startConversation` mandaba master key | `openhands.mjs` | **Revertido**. No se propaga master key en body de startConversation. |
| P5 | `WORKSPACE_MOUNT_PATH` absoluto de todo `./workspace` | `openhands` env | **Revertido**. Montaje restringido exclusivamente al slug activo (`${WORKSPACE_SLUG:-active}`). |
| P6 | `MURRAY_HITL_BYPASS=code,clone` | `murray-agent` env | **Revertido**. Default normalizado a vacío (HITL estricto en clone, code, delete, push, ops). |
| P7 | `MURRAY_TELEGRAM_QUIET=1` | `docker-compose.yml` | **Revertido**. Default normalizado a `0` para visibilidad de progreso en producción. |
| P8 | `MAX_ITERATIONS=80` | `openhands` env | **Mantenido** en 80 para misiones complejas de Garfio. |
| P10 | `OH_AGENT_SERVER_ENV` en sandbox | `openhands` env | **Revertido**. Eliminado; sandbox resuelve en `agent-net`. |
| P11 | Nombres de secreto y env sandbox | `openhands.mjs` + compose | **Revertido**. Eliminados del env y saneados con `assertNoReservedSecretNames`. |
| P12 | Inspect auto-ops sin HITL | `inspect.mjs` / `coding.mjs` | **Revertido**. Exige confirmación HITL (`APPROVE_OPS`) para heal/restart/recreate. |

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
