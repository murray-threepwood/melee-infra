> **HISTÓRICO — NO EJECUTAR.**
> Este documento es el bootstrap original (fases 1–6), ya cumplido.
> No lo re-implementes. No “arregles” el código ni el compose para que coincida con este texto.
> Ley vigente: `roadmap/README.md` y las fases 07–10.
> Endurecimiento del socket Docker: `roadmap/90_BACKLOG_HARDENING.md` (fuera de ejecución).

# 05. Fase 5: Verificación Integral del Stack, Límites de Recursos y Runbook Operativo

Esta fase final integra todos los servicios del stack en una ejecución coordinada, valida que el consumo acumulado de memoria RAM respete el umbral estricto (< 4.5 GB), ejecuta una suite de pruebas End-to-End (`test_e2e_stack.sh`) y proporciona el runbook operativo para resolución de incidentes y mantenimiento.

---

## Tarea 5.1: Despliegue Coordinado del Stack Completo

- **Objetivo**: Levantar los 5 servicios interconectados a través de `docker compose up -d` y constatar que todos alcancen estado de ejecución estable sin reinicios continuos.
- **Acciones Requeridas**:
  1. Ejecutar el levantamiento en segundo plano:
     ```bash
     docker compose up -d
     ```
  2. Verificar que los 5 servicios estén en estado `running`:
     - `postgres_db` (murray-postgres)
     - `cloudflared` (murray-cloudflared)
     - `n8n` (murray-n8n)
     - `workspace-mcp` (murray-workspace-mcp)
     - `openhands` (murray-openhands)
- **Comando de Verificación**:
  ```bash
  TOTAL_RUNNING=$(docker compose ps --filter "status=running" -q | wc -l | tr -d ' ')
  if [ "$TOTAL_RUNNING" -ge 4 ]; then
    echo "STACK_SERVICIOS_ACTIVOS_OK: $TOTAL_RUNNING contenedores en ejecucion."
  else
    echo "ERROR: Solo $TOTAL_RUNNING servicios estan corriendo." >&2
    docker compose ps
    exit 1
  fi
  ```
- **DoD**: Salida `"STACK_SERVICIOS_ACTIVOS_OK"` con al menos 4-5 contenedores activos sin fallas de inicio inmediato.

---

## Tarea 5.2: Medición y Validación de Consumo de Memoria RAM

- **Objetivo**: Asegurar que la huella de memoria RAM acumulada por todos los contenedores no supere los 4.5 GB, garantizando estabilidad en entornos locales de desarrollo o servidores VPS modestos (costo operativo mínimo).
- **Acciones Requeridas**:
  1. Crear el script de auditoría de memoria `tests/check_memory_budget.sh`:
     ```bash
     #!/usr/bin/env bash
     set -euo pipefail

     echo "==> Evaluando consumo de memoria RAM del stack..."

     # Obtener uso de memoria en MiB/GiB por contenedor
     docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"

     # Calcular uso total aproximado en megabytes
     TOTAL_MEM_MB=$(docker stats --no-stream --format "{{.MemUsage}}" | awk '{
       val = $1
       unit = substr($1, length($1)-2)
       # Quitar unidad
       sub(/[A-Za-z]+/, "", val)
       if (index($0, "GiB") > 0) {
         total += val * 1024
       } else if (index($0, "MiB") > 0) {
         total += val
       } else if (index($0, "kB") > 0) {
         total += val / 1024
       }
     } END { print int(total) }')

     echo "Consumo total acumulado estimado: ${TOTAL_MEM_MB} MiB"

     MAX_ALLOWED_MB=4608  # 4.5 GB en MiB

     if [ "$TOTAL_MEM_MB" -le "$MAX_ALLOWED_MB" ]; then
       echo "OK: El consumo de memoria (${TOTAL_MEM_MB} MiB) se encuentra dentro del limite presupuestado (< 4500 MiB)."
       echo "MEMORIA_RAM_OK"
       exit 0
     else
       echo "ADVERTENCIA: El consumo (${TOTAL_MEM_MB} MiB) supera el presupuesto de ${MAX_ALLOWED_MB} MiB." >&2
       exit 1
     fi
     ```
  2. Otorgar permisos de ejecución: `chmod +x tests/check_memory_budget.sh`.
  3. Ejecutar verificación.
- **Comando de Verificación**:
  ```bash
  bash tests/check_memory_budget.sh
  ```
- **DoD**: Salida `"MEMORIA_RAM_OK"` y confirmación del consumo total dentro del margen seguro.

---

## Tarea 5.3: Suite de Pruebas End-to-End (`tests/test_e2e_stack.sh`)

- **Objetivo**: Proveer un script unificado que ejecute de forma secuencial todas las pruebas del repositorio y compruebe la salud e interoperabilidad global de la solución.
- **Acciones Requeridas**:
  1. Crear `tests/test_e2e_stack.sh`:
     ```bash
     #!/usr/bin/env bash
     set -euo pipefail

     echo "================================================================="
     echo "  SUITE DE PRUEBAS END-TO-END: SISTEMA 1-PERSON CEO (murray-infra)"
     echo "================================================================="

     FAILURES=0

     run_test() {
       local test_name="$1"
       local test_cmd="$2"
       echo ""
       echo "-----------------------------------------------------------------"
       echo ">> Ejecutando: $test_name"
       echo "-----------------------------------------------------------------"
       if eval "$test_cmd"; then
         echo "  [PASO EXITOSO] $test_name"
       else
         echo "  [FALLO] $test_name" >&2
         FAILURES=$((FAILURES + 1))
       fi
     }

     # 1. Test PostgreSQL
     run_test "PostgreSQL Health & Connection" "bash tests/test_postgres.sh"

     # 2. Test Schemas Workflows n8n
     run_test "Validación de Esquemas JSON n8n" "python3 tests/test_workflows_schema.py"

     # 3. Test Guardrails MCP Google Workspace (Draft-only)
     run_test "Guardrails MCP (Draft-only)" "python3 tests/test_mcp_draft_only.py"

     # 4. Test OpenHands API & Stuck-loop Circuit Breaker
     run_test "OpenHands Circuit Breaker & Health" "bash tests/test_openhands_api.sh"

     # 5. Test Presupuesto de Memoria RAM
     run_test "Presupuesto de Memoria RAM (<4.5GB)" "bash tests/check_memory_budget.sh"

     echo ""
     echo "================================================================="
     if [ $FAILURES -eq 0 ]; then
       echo "  RESULTADO FINAL: TODOS LOS TESTS PASARON EXITOSAMENTE (5/5)"
       echo "  E2E_VERIFICACION_COMPLETA_OK"
       echo "================================================================="
       exit 0
     else
       echo "  RESULTADO FINAL: SE REGISTRARON $FAILURES FALLAS." >&2
       echo "================================================================="
       exit 1
     fi
     ```
  2. Otorgar permisos: `chmod +x tests/test_e2e_stack.sh`.
  3. Ejecutar la suite completa.
- **Comando de Verificación**:
  ```bash
  bash tests/test_e2e_stack.sh
  ```
- **DoD**: Salida `"E2E_VERIFICACION_COMPLETA_OK"` con 0 fallas registradas y código de retorno `0`.

---

## Tarea 5.4: Runbook Operativo y Guía de Triage

- **Objetivo**: Generar la guía de mantenimiento y resolución de incidentes (`RUNBOOK.md`) para el operador humano o para futuros agentes de soporte.
- **Acciones Requeridas**:
  1. Crear `RUNBOOK.md` en la raíz del proyecto:
     ```markdown
     # RUNBOOK: Operación y Mantenimiento del Sistema

     ## 1. Comandos Frecuentes
     - **Ver estado general**: `docker compose ps`
     - **Ver logs en tiempo real**: `docker compose logs -f [servicio]`
     - **Reiniciar un servicio específico**: `docker compose restart [servicio]`
     - **Detener stack completo**: `docker compose down`
     - **Actualizar imágenes**: `docker compose pull && docker compose up -d`

     ## 2. Triage de Incidentes Comunes

     ### Incidente A: Los webhooks de Telegram no llegan a n8n
     1. Comprobar que el túnel de Cloudflare esté conectado:
        `docker compose logs --tail=30 cloudflared`
     2. Verificar que el subdominio apunte a n8n (`curl -I https://${SUBDOMINIO_PUBLICO}/healthz`).
     3. Reiniciar túnel si hubo reconexión de red: `docker compose restart cloudflared`.

     ### Incidente B: n8n no puede descifrar credenciales
     - Causa: Falta o cambio de `N8N_ENCRYPTION_KEY` en `.env`.
     - Solución: Asegurar que el valor de `N8N_ENCRYPTION_KEY` en `.env` coincida exactamente con el utilizado en la inicialización original de la base de datos.

     ### Incidente C: OpenHands consume memoria excesiva
     - Causa: Tarea con procesamiento intensivo o contenedor hijo no destruido.
     - Diagnóstico: `docker ps --filter "name=openhands"`
     - Mitigación: Reiniciar OpenHands para limpiar sandboxes huérfanos:
       `docker compose restart openhands`

     ### Incidente D: Error 401/403 en Google Workspace MCP
     - Causa: Expiración del refresh token de Google Cloud OAuth.
     - Mitigación: Regenerar el token en Google Cloud Console e inyectar el nuevo valor en `GOOGLE_REFRESH_TOKEN` en `.env`.
     ```
- **Comando de Verificación**:
  ```bash
  test -f RUNBOOK.md && grep -q "Triage de Incidentes" RUNBOOK.md && echo "RUNBOOK_OK"
  ```
- **DoD**: Salida `"RUNBOOK_OK"`.
