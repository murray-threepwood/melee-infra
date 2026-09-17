#!/usr/bin/env bash
set -euo pipefail

echo "==> Exportando workflow HITL publicado en n8n..."

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

docker compose exec -T n8n n8n export:workflow \
  --id=20uYWal9fr2bWwVV \
  --published \
  --pretty \
  -o /tmp/hitl-published-export.json

docker compose cp n8n:/tmp/hitl-published-export.json "${WORKDIR}/hitl-live.json"

python3 - "${WORKDIR}/hitl-live.json" << 'PY'
import json
import sys
from pathlib import Path

raw = Path(sys.argv[1]).read_text(encoding="utf-8")
payload = json.loads(raw)
if isinstance(payload, list):
    if len(payload) != 1:
        raise SystemExit(f"export inesperado: {len(payload)} workflows")
    wf = payload[0]
else:
    wf = payload

names = [node.get("name") for node in wf.get("nodes", [])]
urls = [
    node.get("parameters", {}).get("url", "")
    for node in wf.get("nodes", [])
]
joined_urls = " ".join(urls)

if "http://openhands:3000/api/conversations" in joined_urls and "api/v1/app-conversations" not in joined_urls:
    raise SystemExit("LIVE_HITL_STALE: el workflow publicado aún pega a /api/conversations (405).")
if "¿Aprobar OpenHands?" not in names:
    raise SystemExit(f"LIVE_HITL_STALE: falta el IF ¿Aprobar OpenHands?. Nodos={names}")
if "Consultar Murray" not in names:
    raise SystemExit(f"LIVE_HITL_STALE: falta Consultar Murray. Nodos={names}")
if "http://openhands:3000/api/v1/app-conversations" not in joined_urls:
    raise SystemExit(f"LIVE_HITL_STALE: falta POST v1. urls={urls}")
if "http://murray-agent:8080/chat" not in joined_urls:
    raise SystemExit("LIVE_HITL_STALE: el publicado no pega a murray-agent /chat")
if "http://murray-agent:8080/ops/execute" not in joined_urls:
    raise SystemExit("LIVE_HITL_STALE: falta POST /ops/execute")
if "http://murray-agent:8080/workspace/hitl" not in joined_urls:
    raise SystemExit("LIVE_HITL_STALE: falta POST /workspace/hitl (clone/code HITL)")
if "¿Callback Workspace?" not in names:
    raise SystemExit("LIVE_HITL_STALE: falta ¿Callback Workspace?")
blob = json.dumps(wf)
if "DELETE" not in blob or "PUSH" not in blob:
    raise SystemExit("LIVE_HITL_STALE: el clasificador no rutea APPROVE_DELETE/PUSH")
if "_(CLONE|CODE|DELETE|PUSH):" not in blob:
    raise SystemExit("LIVE_HITL_STALE: falta regex CLONE|CODE|DELETE|PUSH en el clasificador")


trigger = next(n for n in wf.get("nodes", []) if n.get("name") == "Telegram Trigger")
webhook_id = trigger.get("webhookId")
if webhook_id != "4dae132d-912c-40e0-b048-c00b42e03250":
    raise SystemExit(f"LIVE_HITL_STALE: Telegram Trigger webhookId={webhook_id!r}")

notify = next(n for n in wf.get("nodes", []) if n.get("name") == "Notificar Resolución HITL")
parse_mode = notify.get("parameters", {}).get("additionalFields", {}).get("parse_mode")
if parse_mode != "HTML":
    raise SystemExit(f"LIVE_HITL_STALE: notify parse_mode={parse_mode!r} (Markdown rompe REJECT_TASK)")

print("LIVE_HITL_DISPATCH_OK")
print("nodes", ", ".join(names))
print("webhookId", webhook_id)
PY

echo "==> Chequeando Axios 405 vivos (desde el último start de n8n, no el tail fósil)..."
N8N_STARTED_AT="$(docker inspect -f '{{.State.StartedAt}}' murray-n8n)"
HITL_405_SINCE_RESTART="$(
  docker compose logs --since "$N8N_STARTED_AT" n8n 2>/dev/null \
    | grep -c 'AxiosError: Request failed with status code 405' \
    || true
)"
if [ "${HITL_405_SINCE_RESTART}" -gt 0 ]; then
  echo "LIVE_HITL_405_SINCE_RESTART count=${HITL_405_SINCE_RESTART}" >&2
  exit 1
fi
echo "LIVE_HITL_NO_405_SINCE_RESTART"
