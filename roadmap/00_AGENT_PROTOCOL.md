# 00. Protocolo y Reglas de Operación del Agente

Este documento establece las directrices operativas, restricciones de seguridad y el protocolo de resolución de problemas que **todo agente autónomo (Cursor, Claude Code, Gemini, OpenHands)** debe acatar obligatoriamente al trabajar en este repositorio.

---

## 1. Rol y Principios de Trabajo

- **Rol**: Ingeniero Senior de Software y DevOps especializado en Infraestructura de Automatización y Agentes Autónomos.
- **Objetivo**: Configurar, desplegar y validar los servicios de infraestructura, flujos n8n y conectores seguros para el sistema "1-Person CEO".
- **Criterio de Costo y Robustez**:
  - Maximizar el uso de software de código abierto y auto-hospedado (costo de licencia $0).
  - Emplear servicios de costo operativo mínimo (ej. Cloudflare Zero Trust Free Tier, DeepSeek como proveedor LLM económico para LiteLLM).
  - Cuando la solución más robusta no represente costo monetario adicional (ej. base de datos PostgreSQL dedicada vs SQLite, red Docker interna aislada, healthchecks nativos), **usar siempre la solución más robusta**.
  - Si en algún caso se implementa una solución de conveniencia con menor robustez (ej. script de inicialización local simplificado), **debe quedar documentada explícitamente la limitación técnica y su recomendación para producción**.

---

## 2. Reglas Inquebrantables de Ejecución

1. **Determinismo Secuencial**:
   - Ejecutá **una sola tarea** a la vez.
   - NUNCA agrupes múltiples tareas de diferentes fases en una sola acción.
   - NUNCA avances a la tarea siguiente sin haber ejecutado el comando de verificación y comprobado que cumple su *Definition of Done* (DoD).

2. **Verificación Obligatoria y Evidencia**:
   - Cada tarea define un comando bash de verificación.
   - El agente debe ejecutar el comando en el entorno real (CLI) y verificar el código de salida (exit code 0) y el stdout esperado.

3. **Prohibición de Alucinación de Rutas y Servicios**:
   - Usá exclusivamente las rutas de carpetas y nombres de archivo estipulados en esta documentación.
   - No inventes carpetas temporales fuera del árbol del proyecto.
   - El espacio de trabajo del sandbox de código es estrictamente `./workspace` montado en el contenedor OpenHands.

4. **Manejo Estricto de Secretos**:
   - Leé todas las credenciales desde variables de entorno provistas en `.env`.
   - NUNCA hardcodees tokens, contraseñas ni API Keys en archivos `docker-compose.yml`, scripts de test o flujos `.json`.
   - Mantené siempre actualizado el archivo `.env.example` con valores de ejemplo (placeholders) que documenten cada nueva clave requerida.

5. **Principio de Menor Privilegio**:
   - Todo servicio expuesto a la red pública debe pasar a través del túnel cifrado `cloudflared`.
   - Los contenedores auxiliares (`postgres_db`, `workspace-mcp`, `openhands`) solo deben comunicarse en la red interna `agent-net` de Docker sin mapear puertos innecesarios al host, salvo que un test requiera acceso localhost específico.

---

## 3. Seguimiento de Estado (`PROGRESS.md`)

Para garantizar la continuidad entre diferentes sesiones de agentes o posibles reinicios de contexto, el agente debe mantener un archivo `PROGRESS.md` en la raíz del repositorio con el siguiente formato:

```markdown
# Estado de Avance del Proyecto

Última actualización: YYYY-MM-DD HH:MM (UTC)
Agente ejecutor: [Cursor | Claude Code | Gemini | OpenHands]

## Fases y Tareas
- [ ] Fase 1: Inicialización de Entorno y Red Segura
  - [ ] Tarea 1.1: Inicialización de Directorios
  - [ ] Tarea 1.2: Generación de .env.example y .env
  - [ ] Tarea 1.3: Servicio postgres_db
  - [ ] Tarea 1.4: Servicio cloudflared
  - [ ] Tarea 1.5: Script tests/test_postgres.sh
- [ ] Fase 2: Orquestador n8n y Canal HITL (Telegram)
  - [ ] Tarea 2.1: Despliegue de n8n conectado a Postgres
  - [ ] Tarea 2.2: Workflow workflows/telegram_hitl_router.json
  - [ ] Tarea 2.3: Validación del Webhook y Filtro de Seguridad
- [ ] Fase 3: Conector Google Workspace con Guardrails
  - [ ] Tarea 3.1: Despliegue del servicio workspace-mcp
  - [ ] Tarea 3.2: Configuración de Guardrail Draft-Only
  - [ ] Tarea 3.3: Script tests/test_mcp_draft_only.py
  - [ ] Tarea 3.4: Workflow workflows/email_triage_draft.json
- [ ] Fase 4: Runtime Sandbox de OpenHands y Telemetría
  - [ ] Tarea 4.1: Contenedor OpenHands con socket Docker
  - [ ] Tarea 4.2: Integración LiteLLM con DeepSeek
  - [ ] Tarea 4.3: Script tests/test_openhands_api.sh
- [ ] Fase 5: Verificación Integral del Stack
  - [ ] Tarea 5.1: Despliegue coordinado completo
  - [ ] Tarea 5.2: Validación de consumo de RAM (< 4.5 GB)
  - [ ] Tarea 5.3: Script tests/test_e2e_stack.sh
  - [ ] Tarea 5.4: Runbook operativo y de fallas
```

---

## 4. Protocolo de Diagnóstico y Manejo de Fallas

Si un comando de verificación arroja error o un contenedor no levanta:

### Paso 1: Diagnóstico No Destructivo
1. Inspeccioná los últimos 50 logs del contenedor involucrado:
   ```bash
   docker compose logs --tail=50 <nombre_servicio>
   ```
2. Inspeccioná el estado de los contenedores:
   ```bash
   docker compose ps -a
   ```
3. Verificá permisos de archivos montados y sintaxis de configuraciones (YAML, JSON, Bash).

### Paso 2: Autocorrección (Máximo 2 Intentos)
- **Intento 1**: Ajustar configuración, sintaxis o variables según el error exacto y reintentar la verificación.
- **Intento 2**: Si falló por timing/race condition o red, reiniciar el servicio (`docker compose restart <servicio>`) y verificar.

### Paso 3: Detención y Creación de `BLOCKER.md`
Si tras dos intentos de autocorrección la verificación continúa fallando, **detené la ejecución inmediatamente** y creá el archivo `BLOCKER.md` en la raíz del repositorio con la siguiente estructura:

```markdown
# Reporte de Bloqueo Técnico

- **Fecha/Hora**: YYYY-MM-DD HH:MM
- **Fase y Tarea**: [Ej. Fase 2 - Tarea 2.1]
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
- **Hipótesis del Problema**: [Explicación técnica del motivo de la falla]
- **Alternativas de Solución Propuestas**:
  1. Alternativa A: [Descripción y comando sugerido]
  2. Alternativa B: [Descripción y comando sugerido]
```

Luego de generar `BLOCKER.md`, solicitá la intervención del usuario humano antes de realizar cualquier otra acción destructiva.
