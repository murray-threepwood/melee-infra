#!/usr/bin/env bash
set -euo pipefail

# Live: el sandbox de OpenHands vive en Docker bridge, no en agent-net.
# Este script simula esa red y exige que LiteLLM conteste por host.docker.internal.
# No imprime keys.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PORT="${LITELLM_PORT:-4000}"
BASE="http://127.0.0.1:${PORT}"

echo "==> [TEST] LiteLLM publicado en loopback :${PORT}"
CODE="$(curl -sS -o /tmp/litellm-live-health.txt -w "%{http_code}" -m 5 "${BASE}/health/liveliness" || true)"
if [[ "$CODE" != "200" ]]; then
  echo "ERROR: GET ${BASE}/health/liveliness → ${CODE} (se esperaba 200). ¿Compose tiene ports 127.0.0.1:${PORT}:4000?" >&2
  exit 1
fi
echo "  [OK] host loopback liveliness 200"

echo "==> [TEST] Un contenedor en bridge alcanza host.docker.internal:${PORT} (como oh-agent-server)"
BRIDGE_CODE="$(docker run --rm --add-host=host.docker.internal:host-gateway node:20-alpine \
  node -e "fetch('http://host.docker.internal:${PORT}/health/liveliness').then(r=>{console.log(r.status); if(!r.ok) process.exit(1)}).catch(e=>{console.error(String(e)); process.exit(1)})" \
  2>/tmp/bridge-llm.err || true)"
if [[ "$BRIDGE_CODE" != "200" ]]; then
  echo "ERROR: sandbox-simulado → host.docker.internal:${PORT} = ${BRIDGE_CODE}" >&2
  cat /tmp/bridge-llm.err >&2 || true
  exit 1
fi
echo "  [OK] bridge→host.docker.internal liveliness 200"

if [[ -z "${LITELLM_MASTER_KEY:-}" ]]; then
  echo "ERROR: LITELLM_MASTER_KEY vacío; no puedo probar /v1/chat/completions." >&2
  exit 1
fi

echo "==> [TEST] chat completions openai/garfio-worker vía proxy"
COMP_CODE="$(curl -sS -o /tmp/litellm-live-chat.json -w "%{http_code}" -m 45 \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/garfio-worker","messages":[{"role":"user","content":"pong"}],"max_tokens":8}' \
  "${BASE}/v1/chat/completions" || true)"
if [[ "$COMP_CODE" != "200" ]]; then
  echo "ERROR: POST /v1/chat/completions openai/garfio-worker → ${COMP_CODE}" >&2
  python3 -c 'import json; d=json.load(open("/tmp/litellm-live-chat.json")); print(d.get("error") or d)' 2>/dev/null || true
  exit 1
fi
python3 - <<'PY'
import json
d=json.load(open("/tmp/litellm-live-chat.json"))
choice=(d.get("choices") or [{}])[0]
msg=(choice.get("message") or {}).get("content") or ""
if not str(msg).strip():
    raise SystemExit("ERROR: completion vacía")
print("  [OK] completion no vacía")
PY

echo "==> [TEST] chat completions openai/deepseek-chat (cerebro transplantado)"
COMP2="$(curl -sS -o /tmp/litellm-live-chat2.json -w "%{http_code}" -m 45 \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/deepseek-chat","messages":[{"role":"user","content":"pong"}],"max_tokens":8}' \
  "${BASE}/v1/chat/completions" || true)"
if [[ "$COMP2" != "200" ]]; then
  echo "ERROR: POST /v1/chat/completions openai/deepseek-chat → ${COMP2}" >&2
  python3 -c 'import json; d=json.load(open("/tmp/litellm-live-chat2.json")); print(d.get("error") or d)' 2>/dev/null || true
  exit 1
fi
echo "  [OK] openai/deepseek-chat 200"
echo "SANDBOX_LLM_LIVE_OK"
