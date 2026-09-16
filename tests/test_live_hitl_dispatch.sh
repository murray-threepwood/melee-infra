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
if "http://openhands:3000/api/v1/app-conversations" not in joined_urls:
    raise SystemExit(f"LIVE_HITL_STALE: falta POST v1. urls={urls}")
print("LIVE_HITL_DISPATCH_OK")
print("nodes", ", ".join(names))
PY
