#!/usr/bin/env python3
"""Contrato del workflow email_triage_draft: Gmail draft-only, un solo webhook Telegram."""

import json
import sys
from pathlib import Path

WORKFLOW = Path("workflows/email_triage_draft.json")
TELEGRAM_CRED_ID = "9IhWvhoAHuzho5J5"


def load():
    return json.loads(WORKFLOW.read_text(encoding="utf-8"))


def nodes_by_name(data):
    return {node["name"]: node for node in data["nodes"]}


def test_no_telegram_trigger():
    data = load()
    for node in data["nodes"]:
        ntype = node.get("type", "")
        if ntype.endswith("telegramTrigger"):
            raise AssertionError(
                "email_triage no puede tener Telegram Trigger: un bot = un webhook "
                "(el HITL router ya lo posee)."
            )


def test_html_parse_mode():
    node = nodes_by_name(load())["Notificar Triage a Telegram"]
    parse_mode = (
        node.get("parameters", {}).get("additionalFields", {}).get("parse_mode")
    )
    if parse_mode != "HTML":
        raise AssertionError(
            f"Triage parse_mode={parse_mode!r}. n8n default Markdown rompe texto con _."
        )


def test_telegram_credential():
    node = nodes_by_name(load())["Notificar Triage a Telegram"]
    cred = node.get("credentials", {}).get("telegramApi", {})
    if cred.get("name") != "Telegram account":
        raise AssertionError(f"Credencial Telegram inesperada: {cred}")
    if cred.get("id") not in {"1", TELEGRAM_CRED_ID}:
        raise AssertionError(f"telegram credential id inesperado: {cred.get('id')}")


def test_draft_not_send():
    data = load()
    blob = json.dumps(data)
    if "/gmail/send" in blob:
        raise AssertionError("el workflow de triage no puede pegarle a /gmail/send")
    draft = nodes_by_name(data)["Crear Borrador MCP (No Send)"]
    url = draft.get("parameters", {}).get("url", "")
    if url != "http://workspace-mcp:8000/gmail/drafts":
        raise AssertionError(f"draft URL inesperada: {url}")
    method = draft.get("parameters", {}).get("method", "")
    if method != "POST":
        raise AssertionError(f"draft method inesperado: {method}")


def test_dedup_before_draft():
    data = load()
    blob = json.dumps(data)
    if "staticData" in blob or "getWorkflowStaticData" in blob:
        raise AssertionError("el triage ya no puede usar static data para vistos")
    names = nodes_by_name(data)
    if "Filtrar IDs en Murray" not in names or "Marcar Visto en Murray" not in names:
        raise AssertionError("Faltan POST /triage/filter o /triage/mark-seen.")
    conns = data["connections"]
    if_targets = {t["node"] for t in conns["¿Hay Correos Nuevos?"]["main"][0]}
    if "Filtrar IDs en Murray" not in if_targets:
        raise AssertionError("El IF de unread tiene que ir a Filtrar IDs en Murray.")
    split_targets = {t["node"] for t in conns["Separar Mensajes"]["main"][0]}
    if "Crear Borrador MCP (No Send)" not in split_targets:
        raise AssertionError("Separar Mensajes debe ir a Crear Borrador.")
    draft_targets = {
        t["node"] for t in conns["Crear Borrador MCP (No Send)"]["main"][0]
    }
    if "Marcar Visto en Murray" not in draft_targets:
        raise AssertionError("mark-seen solo después del POST /gmail/drafts.")
    notify_sources = [
        src
        for src, branches in conns.items()
        for branch in branches.get("main", [])
        for target in branch
        if target["node"] == "Notificar Triage a Telegram"
    ]
    if "Marcar Visto en Murray" not in notify_sources:
        raise AssertionError("Notificar tiene que ir después de mark-seen.")
    if "Notificar Triage a Telegram" in conns:
        raise AssertionError("Notificar no debe encadenar otro POST (loop de drafts).")


def test_unread_endpoint():
    fetch = nodes_by_name(load())["Consultar Correos No Leídos"]
    url = fetch.get("parameters", {}).get("url", "")
    if url != "http://workspace-mcp:8000/gmail/unread":
        raise AssertionError(f"unread URL inesperada: {url}")


def main():
    tests = [
        test_no_telegram_trigger,
        test_html_parse_mode,
        test_telegram_credential,
        test_draft_not_send,
        test_dedup_before_draft,
        test_unread_endpoint,
    ]
    for test in tests:
        test()
        print(f"  [OK] {test.__name__}")
    print("EMAIL_TRIAGE_CONTRACT_OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
