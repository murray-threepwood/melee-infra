#!/usr/bin/env bash
set -euo pipefail

echo "==> murray-agent live (sin secretos ni asuntos)..."

eval_json() {
  docker compose exec -T -w /tmp murray-agent node -e "$1"
}

DOCKER_HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' murray-agent)"
if [[ "$DOCKER_HEALTH" != "healthy" ]]; then
  echo "LIVE_MURRAY_DOCKER_UNHEALTHY status=${DOCKER_HEALTH}" >&2
  exit 1
fi
echo "  [OK] docker health=${DOCKER_HEALTH}"

eval_json 'fetch("http://127.0.0.1:8080/healthz").then(async(r)=>{const b=await r.json(); if(!r.ok || b.service!=="murray-agent") process.exit(1); console.log("LIVE_MURRAY_HEALTHZ_OK");})'

eval_json 'fetch("http://127.0.0.1:8080/ops/execute",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then(async(r)=>{const b=await r.json(); if(r.status!==403 || b.error!=="ops_approval_denied") process.exit(1); console.log("LIVE_MURRAY_OPS_DENIED_OK");})'

eval_json 'fetch("http://127.0.0.1:8080/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:"live",text:"/status"})}).then(async(r)=>{const b=await r.json(); if(!r.ok || b.needs_hitl!==false || !b.reply) process.exit(1); console.log("LIVE_MURRAY_STATUS_OK");})'

echo "LIVE_MURRAY_AGENT_OK"
