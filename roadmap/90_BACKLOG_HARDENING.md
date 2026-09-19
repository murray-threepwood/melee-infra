# 90. Backlog: endurecimiento del socket Docker

> **NO EJECUTAR.** Este archivo no es una fase viva.
> Un agente programador **no** lo toma aunque esté “cerrado” por el arquitecto.
> Se retoma solo cuando el operador humano pida explícitamente la etapa de hardenizado.
> Ley vigente del socket **hoy**: bind directo `/var/run/docker.sock` en `murray-agent` y `openhands` + allowlist en `config/murray-agent/ops.mjs`.
> Fuente: [`archive/2026-09-18_architect_hardening.md`](./archive/2026-09-18_architect_hardening.md).

## Qué es este paquete (decisión, no trabajo)

El arquitecto eligió **Opción A**, sin DinD:

1. Doble `tecnativa/docker-socket-proxy` en `agent-net` (`socket-proxy-murray` + `socket-proxy-openhands`).
2. `VOLUMES=0` en el proxy de OpenHands (apaga `/volumes`; **no** strippea `HostConfig.Binds`).
3. `userns-remap` en el daemon del host (`/etc/docker/daemon.json`). En Docker Desktop macOS puede dejar inaccesibles `postgres_data`, `n8n_data` y `murray_agent_data`.

Hasta que el operador lo pida, **prohibido**:

- Agregar `tecnativa/docker-socket-proxy` o un segundo proxy.
- Sacar `/var/run/docker.sock` de `murray-agent` u `openhands`.
- Poner `DOCKER_HOST=tcp://…proxy…`.
- Quitar `recreate` de `propose_ops` “porque POST=0”.
- Tocar `daemon.json` / `userns-remap`.
- Inventar un filtro de `HostConfig.Binds` “de yapa”.

Las fases 07–10 (SQLite, mails, LiteLLM, TTL) **no** dependen de este archivo.

## Notas para cuando se abra (no son tareas ahora)

- Proxy Murray: `CONTAINERS=1`, `POST=0`, `RESTART=1`, `INFO=1`; resto en 0. `propose_ops recreate` dejaría de funcionar (create = POST). Recreate pasaría al host.
- Proxy OpenHands: `CONTAINERS=1`, `POST=1`, `VOLUMES=0`, más `IMAGES` / `NETWORKS` / `EXEC` si el obrero no nace. Si no nace, el arreglo **no** es remontar el socket en OpenHands sin el proxy: se ajusta el allowlist del proxy.
- `VOLUMES=0` no es un test de “create con `-v` falla”. OpenHands necesita el bind de `./workspace`.
- `userns-remap` es paso **humano de host**, no de compose. Backup de volúmenes antes. Preferible VPS Linux, no el Mac de desarrollo.
- Heal `docker rm -f` de `oh-agent-server-*` es DELETE; `POST=0` no tiene por qué bloquearlo.
- Los proxies no entran en `ALLOWED_SERVICES` (reiniciar el proxy de Murray corta a Murray).

Cuando el operador pida hardenizado, se redacta una fase viva nueva (11+) con prompt, tareas y DoD. Hasta entonces, este archivo se ignora.
