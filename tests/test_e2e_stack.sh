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
