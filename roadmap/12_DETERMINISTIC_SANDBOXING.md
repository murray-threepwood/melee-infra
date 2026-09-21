# 12. Fase 12: Estabilización, Sandboxing y Orquestación Determinista (Murray & Garfio)

Esta fase transforma la ejecución y orquestación de *Murray & Garfio* en una plataforma de ingeniería autónoma determinista y resiliente, eliminando las fallas de contención de memoria en macOS ARM64, los secuestros de intención por regexes, las aprobaciones fantasma (Ghost Keyboards), las rupturas de Markdown en Telegram y la degradación de pruebas (*test hacking*).

**Precondición**: Fases 07–11 en DoD. **No** reabrir 07–10. **No** implementar `roadmap/90_BACKLOG_HARDENING.md` (socket-proxy).

---

## 1. Prompt de Arranque para Agentes Autónomos

```text
Sos un agente autónomo de ingeniería de software y DevOps en murray-infra.

Leé primero roadmap/00_AGENT_PROTOCOL.md, .agents/skills/dev-protocol/lessons-learned.md y SOLO roadmap/12_DETERMINISTIC_SANDBOXING.md.
Implementá UNA tarea a la vez en estricto orden secuencial.

Invariantes Sagradas:
1. Murray NO edita murray-infra ni pushea a main desde Telegram.
2. Todas las operaciones de Git (worktrees, branches, push, PRs) y auditoría AST aplican EXCLUSIVAMENTE a los repositorios de trabajo del CEO en ./workspace/<slug>.
3. El stack corre 100% en local con Docker Desktop y Git Worktrees. Si se saturan los recursos (OOM 137 o RAM > 4.2 GB), se registra el incidente y se avisa en Telegram con la solución de MicroVMs E2B.
4. Toda notificación terminal debe incluir terminal: true para MURRAY_TELEGRAM_QUIET.
5. El socket Docker (/var/run/docker.sock) permanece montado directamente; no agregar docker-socket-proxy.

Corré verificación y dejá la suite en verde (DoD) antes de dar por concluida cada tarea.
```

---

## 2. Decisiones Cerradas

1. **Gestión de Esquemas en `murray-agent`**: Se inicializa un `package.json` ligero en `config/murray-agent` con **solo `zod`** como dependencia de producción (cero dependencias anidadas de terceros). Se utiliza `z.discriminatedUnion` para hacer que los Ghost Keyboards sean sintácticamente imposibles (`needsHitl: true` exige obligatoriamente `hitlPayload`).
2. **Alcance y Delimitación de Repositorios**: La integración Git (`GIT_ASKPASS`, worktrees, commits con trailers `Co-authored-by`, push y PRs) opera **únicamente sobre repositorios de trabajo clonados bajo `./workspace/<slug>`**. `murray-infra` permanece vedado e inmutable para el bot.
3. **Ejecución Local + Sensor de Recursos (E2B Breaker)**:
   - Ejecución 100% en Docker Desktop local en macOS ARM64.
   - Si un sandbox colapsa por `exit code 137` (OOM), si la memoria total supera los 4.2 GB o si una tarea excede 20 min continuos:
     - Se guarda constancia en SQLite (`jobs`) y en `operator-inbox/RESOURCE_WARNINGS.md`.
     - Murray notifica en Telegram explicando el colapso de RAM y detallando la solución arquitectónica: delegar a MicroVMs remotas de E2B (`SANDBOX_BACKEND=e2b`).
   - Se abstrae la interfaz `SandboxRunner` (`DockerLocalRunner` activo, `E2BRunner` plug-in).
4. **Formateo Universal Telegram HTML**: Erradicación absoluta de `parse_mode=Markdown` o `MarkdownV2`. Todo mensaje saliente usa `parse_mode='HTML'` y pasa por `escapeTelegramHtml()` sanitizando únicamente `<`, `>`, `&`.
5. **Git Worktrees sobre Repositorio Bare**: Los repositorios clonados en `./git-cache/<slug>.bare` alimentan worktrees efímeros en `./workspace/<slug>` mediante `git worktree add -B feat/...`. Se eliminan los clones shallow truncados.
6. **Autenticación Git con `GIT_ASKPASS`**: Scripts efímeros en memoria protegida (permisos `0700`) que responden dinámicamente con usuario `x-access-token` y contraseña `${token}`, evitando exponer secretos en `env` global, `ps aux` o `.gitconfig`.
7. **Auditoría Estática AST Anti-Test Hacking**: Script Python (`ast.NodeVisitor`) que cuenta deterministamente funciones de test y aserciones. Bloquea parches que disminuyan aserciones o eliminen pruebas existentes.

---

## 3. Desglose de Tareas

### Fase 1: Estabilización Operativa Inmediata
- [x] **Tarea 1.1**: Sanitización Universal Telegram HTML. Implementar `escapeTelegramHtml(text)` y garantizar `parse_mode: 'HTML'` en `config/murray-agent/telegram.mjs` y en todas las emisiones de `chat.mjs` y `coding.mjs`. Tests unitarios dedicados en `tests/test_telegram_html.mjs`.
- [x] **Tarea 1.2**: Desacoplamiento de Webhooks. Garantizar que los endpoints de entrada (`/chat`, `/workspace/hitl`, `/triage`) en `server.mjs` emitan HTTP `200 OK` en <50ms tras asentar en SQLite WAL, eliminando timeouts 504 de Telegram. Tests unitarios en `tests/test_webhook_decoupling.mjs`.
- [x] **Tarea 1.3**: Janitor de Docker Fortalecido. Configurar en `sandbox-ttl.mjs` inspección cada 300s sobre `/var/run/docker.sock` con purga forzada de contenedores `oh-agent-server-*` con TTL > 30 min o estados huérfanos.
- [x] **Tarea 1.4**: Inicialización de `package.json` con `zod` en `config/murray-agent` y actualización del `Dockerfile` (`RUN npm install --omit=dev`).

### Fase 2: Modernización Git y Worktrees para Repos de Trabajo
- [x] **Tarea 2.1**: Módulo `SafeGitWorkspaceManager` en `git-worktree.mjs` para gestionar `./git-cache/<slug>.bare` y vincular worktrees en `./workspace/<slug>` con refspecs completos `remote.origin.fetch = +refs/heads/*:refs/remotes/origin/*`.
- [x] **Tarea 2.2**: Implementar mecanismo `GIT_ASKPASS` efímero en `workspace.mjs` para push y fetch seguro de repositorios del workspace sin variables globales expuestas.
- [x] **Tarea 2.3**: Unificación de red de sandboxes: asegurar inyección de `--network agent-net` y `--add-host=host.docker.internal:host-gateway` en `docker-compose.yml` y configuración de OpenHands.

### Fase 3: Determinismo, QA, Anti-Test Hacking y Sensor E2B
- [x] **Tarea 3.1**: Verificador estático AST anti-test hacking (`scripts/test_ast_auditor.py`) que audite archivos de prueba (`tests/**/test_*.py`) y aborte si se eliminan métodos o se reducen aserciones. Integrar la verificación en el hook de finalización de `coding.mjs`.
- [x] **Tarea 3.2**: Monitor de saturación de recursos locales (`resource-monitor.mjs`): intercepta código de salida 137 (OOM) o RAM > 4.2 GB, asienta en SQLite / `operator-inbox`, y despacha aviso en Telegram con el racional de migración a MicroVMs remotas E2B.
- [x] **Tarea 3.3**: Seam abstracto `SandboxRunner` (`DockerLocalRunner` activo, `E2BRunner` desacoplado) en `sandbox-runner.mjs`.
- [x] **Tarea 3.4**: Esquemas Zod con uniones discriminadas en `schemas.mjs` y migración de `intent.mjs` erradicando regexes desancladas de borrado/mutación.

### Fase 4: Observabilidad en Vivo y Simplificación de Topología
- [ ] **Tarea 4.1**: Conectar consumidor sobre `EventStream` de OpenHands en `coding.mjs` para despachar resúmenes del "Modo Mal Manager" cada 60s a Telegram.
- [ ] **Tarea 4.2**: Reducción de n8n: simplificar `telegram_hitl_router.json` como mero webhook passthrough sin decisiones ni mutaciones de texto.
- [ ] **Tarea 4.3**: Verificación completa de suite E2E (`bash tests/test_e2e_stack.sh`) y presupuesto de memoria RAM (<4.5 GB).

---

## 4. Criterios de Aceptación (DoD) de la Fase 12

1. **Telegram HTML Limpio**: Cero errores HTTP 400 por caracteres especiales en nombres de ramas o variables en los mensajes y botones de Telegram.
2. **Cero Timeouts 504**: Todo webhook responde HTTP 200 en <50ms. Tareas pesadas corren en SQLite WAL asíncrono con notificaciones terminales.
3. **Worktrees Efímeros Aislados**: El workspace opera con repositorios bare en `./git-cache` y ramas en worktrees sin duplicar almacenamiento ni romper refspecs.
4. **Protección Anti-Test Hacking**: Cualquier intento de Garfio de eliminar aserciones o mutar tests para fingir que pasan es interceptado por el AST auditor y rechazado.
5. **Sensor OOM & E2B**: Si un contenedor colapsa por memoria en Mac ARM64, Murray registra el incidente y alerta al CEO en Telegram recomendando `SANDBOX_BACKEND=e2b`.
6. **Suite 100% en Verde**: Todos los tests unitarios y de integración de `tests/` pasan exitosamente.
