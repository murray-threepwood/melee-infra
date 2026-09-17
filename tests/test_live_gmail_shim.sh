#!/usr/bin/env bash
set -euo pipefail

echo "==> workspace-mcp Gmail live (sin imprimir asuntos ni remitentes)..."

eval_json() {
  docker compose exec -T workspace-mcp node -e "$1"
}

HEALTH="$(eval_json 'fetch("http://127.0.0.1:8000/healthz").then(async(r)=>{const b=await r.json(); if(!r.ok) process.exit(1); if(b.gmail_allow_sending!==false) process.exit(2); console.log(b.gmail_mode||"missing");})')"
if [[ "$HEALTH" != "live" && "$HEALTH" != "unconfigured" ]]; then
  echo "LIVE_GMAIL_BAD_HEALTH mode=${HEALTH}" >&2
  exit 1
fi
echo "  [OK] healthz gmail_mode=${HEALTH}"

eval_json 'fetch("http://127.0.0.1:8000/gmail/send",{method:"POST"}).then(async(r)=>{const b=await r.json(); if(r.status!==403 || b.error!=="gmail_send_blocked") process.exit(1); console.log("GMAIL_SEND_BLOCKED_OK");})'

UNREAD_JSON="$(eval_json 'fetch("http://127.0.0.1:8000/gmail/unread").then(async(r)=>{const b=await r.json(); console.log(JSON.stringify({http:r.status,error:b.error||"",status:b.status||"",count:b.unread_count}));})')"
python3 - "$UNREAD_JSON" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
if data.get("error") == "gmail_oauth_client_mismatch":
    raise SystemExit("LIVE_GMAIL_CLIENT_MISMATCH")
if data.get("error") in {"gmail_oauth_missing", "gmail_oauth_failed"}:
    raise SystemExit(f"LIVE_GMAIL_{data['error'].upper()}")
if data.get("http") != 200 or data.get("status") != "ok":
    raise SystemExit(f"LIVE_GMAIL_UNREAD_FAIL {data}")
if data.get("status") in {"awaiting_oauth", "stub_until_oauth"}:
    raise SystemExit("LIVE_GMAIL_STILL_STUB")
print(f"  [OK] unread live ok count={data.get('count')}")
PY
echo "LIVE_GMAIL_SHIM_OK"
