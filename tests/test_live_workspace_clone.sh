#!/usr/bin/env bash
set -euo pipefail

echo "==> murray-agent workspace session live (sin clonar red ni secretos)..."

eval_json() {
  docker compose exec -T -w /tmp murray-agent node -e "$1"
}

DOCKER_HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' murray-agent)"
if [[ "$DOCKER_HEALTH" != "healthy" ]]; then
  echo "LIVE_WORKSPACE_DOCKER_UNHEALTHY status=${DOCKER_HEALTH}" >&2
  exit 1
fi

eval_json 'fetch("http://127.0.0.1:8080/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:"live-ws",text:"cloná algo"})}).then(async(r)=>{const b=await r.json(); if(!r.ok || b.needs_hitl!==false || !/URL https/i.test(b.reply||"")) process.exit(1); console.log("LIVE_WORKSPACE_CLARIFY_CLONE_OK");})'

eval_json 'fetch("http://127.0.0.1:8080/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:"live-ws",text:"mejorá el README"})}).then(async(r)=>{const b=await r.json(); if(!r.ok || b.needs_hitl!==false || !/repo activo/i.test(b.reply||"")) process.exit(1); console.log("LIVE_WORKSPACE_CLARIFY_REPO_OK");})'

eval_json 'fetch("http://127.0.0.1:8080/workspace/hitl",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({callback_data:"APPROVE_CLONE:deadbeefdeadbeef",chat_id:"live-ws"})}).then(async(r)=>{const b=await r.json(); if(r.status!==403) process.exit(1); console.log("LIVE_WORKSPACE_HITL_DENIED_OK");})'

echo "LIVE_WORKSPACE_CLONE_OK"
