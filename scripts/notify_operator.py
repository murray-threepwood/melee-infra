#!/usr/bin/env python3
"""Avisar al operador por Telegram. No imprime secretos."""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def main() -> int:
    message = sys.argv[1] if len(sys.argv) > 1 else ""
    if not message:
        print("USAGE: notify_operator.py <text>", file=sys.stderr)
        return 2
    env = load_env(Path(".env"))
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = env.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        print("TELEGRAM_NOTIFY_SKIP missing_env", file=sys.stderr)
        return 1
    payload = urllib.parse.urlencode(
        {
            "chat_id": chat_id,
            "text": message,
            "disable_web_page_preview": "true",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        print(f"TELEGRAM_NOTIFY_FAIL {exc.__class__.__name__}", file=sys.stderr)
        return 1
    print("TELEGRAM_NOTIFY_OK" if body.get("ok") else "TELEGRAM_NOTIFY_FAIL")
    return 0 if body.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
