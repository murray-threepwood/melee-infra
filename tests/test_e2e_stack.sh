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

# 2b. Contrato HITL en el JSON del repo
run_test "Contrato HITL OpenHands v1" "python3 tests/test_hitl_dispatch.py"

# 2c. Contrato email triage (draft-only, sin Telegram Trigger)
run_test "Contrato email triage draft-only" "python3 tests/test_email_triage_draft.py"

# 2d. Gmail client + HTTP shim con fetch mockeado (cero Google vivo)
run_test "Gmail API unit (mock fetch)" "node --test tests/test_gmail_client.mjs tests/test_workspace_mcp_http.mjs tests/test_murray_agent_http.mjs tests/test_workspace.mjs tests/test_coding_session.mjs"

# 2e. Workflow publicado en n8n (requiere stack arriba)
run_test "HITL publicado en n8n" "bash tests/test_live_hitl_dispatch.sh"

# 3. Test Guardrails MCP Google Workspace (Draft-only)
run_test "Guardrails MCP (Draft-only)" "python3 tests/test_mcp_draft_only.py"

# 3b. Shim Gmail live: unread real, send 403
run_test "Gmail shim live draft-only" "bash tests/test_live_gmail_shim.sh"

# 3c. Murray Telegram agent live (healthz, /status, ops 403)
run_test "Murray agent live" "bash tests/test_live_murray_agent.sh"

# 3d. Coding session: clarify clone/repo, HITL workspace 403
run_test "Murray workspace session live" "bash tests/test_live_workspace_clone.sh"

# 4. Test OpenHands API & Stuck-loop Circuit Breaker
run_test "OpenHands Circuit Breaker & Health" "bash tests/test_openhands_api.sh"

# 5. Test Presupuesto de Memoria RAM
run_test "Presupuesto de Memoria RAM (<4.5GB)" "bash tests/check_memory_budget.sh"

echo ""
echo "================================================================="
if [ $FAILURES -eq 0 ]; then
  echo "  RESULTADO FINAL: TODOS LOS TESTS PASARON EXITOSAMENTE"
  echo "  E2E_VERIFICACION_COMPLETA_OK"
  echo "================================================================="
  exit 0
else
  echo "  RESULTADO FINAL: SE REGISTRARON $FAILURES FALLAS." >&2
  echo "================================================================="
  exit 1
fi
