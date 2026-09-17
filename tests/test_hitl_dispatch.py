#!/usr/bin/env python3
"""Regression: HITL must not POST every callback to the dead OpenHands SPA route."""

import json
import sys
from pathlib import Path

WORKFLOW = Path("workflows/telegram_hitl_router.json")
OLD_DEAD_ROUTE = "http://openhands:3000/api/conversations"
NEW_ROUTE = "http://openhands:3000/api/v1/app-conversations"


def load_workflow():
    return json.loads(WORKFLOW.read_text(encoding="utf-8"))


def test_trigger_has_stable_webhook_id():
    data = load_workflow()
    trigger = next(n for n in data["nodes"] if n["name"] == "Telegram Trigger")
    webhook_id = trigger.get("webhookId")
    if not webhook_id:
        raise AssertionError(
            "Telegram Trigger sin webhookId: n8n registra un UUID huérfano y el POST explota con reading 'node'."
        )
    if webhook_id != "4dae132d-912c-40e0-b048-c00b42e03250":
        raise AssertionError(f"webhookId inesperado: {webhook_id}")


def test_openhands_uses_v1_route():
    data = load_workflow()
    dispatch = next(n for n in data["nodes"] if n["name"] == "Delegar a OpenHands")
    url = dispatch["parameters"].get("url", "")
    if OLD_DEAD_ROUTE in url and "/api/v1/" not in url:
        raise AssertionError(f"Ruta SPA muerta (405): {url}. Debe ser {NEW_ROUTE}")
    if NEW_ROUTE not in url:
        raise AssertionError(f"Delegar a OpenHands no apunta a {NEW_ROUTE}: {url}")


def test_reject_skips_openhands():
    data = load_workflow()
    names = {n["name"] for n in data["nodes"]}
    if "¿Aprobar OpenHands?" not in names:
        raise AssertionError(
            "Falta el IF ¿Aprobar OpenHands? (Rechazar/Pausar iban a OpenHands)."
        )

    approve_conns = data["connections"]["¿Aprobar OpenHands?"]["main"]
    true_targets = {t["node"] for t in approve_conns[0]}
    false_targets = {t["node"] for t in approve_conns[1]}
    if "Delegar a OpenHands" not in true_targets:
        raise AssertionError("Aprobar no conecta a Delegar a OpenHands.")
    if "Notificar Resolución HITL" not in false_targets:
        raise AssertionError("Rechazar/Pausar no conecta directo a notificar.")
    if "Delegar a OpenHands" in false_targets:
        raise AssertionError("Rechazar/Pausar no debe llamar a OpenHands.")


def test_callback_no_longer_dispatches_all():
    data = load_workflow()
    callback_true = {
        t["node"] for t in data["connections"]["¿Es Callback de Botón?"]["main"][0]
    }
    if "Delegar a OpenHands" in callback_true:
        raise AssertionError(
            "El callback true no debe ir directo a OpenHands; primero ¿Aprobar OpenHands?"
        )
    if "¿Aprobar OpenHands?" not in callback_true:
        raise AssertionError("El callback true debe ir a ¿Aprobar OpenHands?")


def test_telegram_send_uses_html_not_default_markdown():
    data = load_workflow()
    for name in ("Notificar Resolución HITL", "Enviar Teclado HITL"):
        node = next(n for n in data["nodes"] if n["name"] == name)
        parse_mode = (
            node.get("parameters", {}).get("additionalFields", {}).get("parse_mode")
        )
        if parse_mode != "HTML":
            raise AssertionError(
                f"{name} parse_mode={parse_mode!r}. n8n default is Markdown; "
                "REJECT_TASK con _ explota Telegram 400 (can't parse entities)."
            )


def main():
    tests = [
        test_trigger_has_stable_webhook_id,
        test_openhands_uses_v1_route,
        test_reject_skips_openhands,
        test_callback_no_longer_dispatches_all,
        test_telegram_send_uses_html_not_default_markdown,
    ]
    for test in tests:
        test()
        print(f"  [OK] {test.__name__}")
    print("HITL_DISPATCH_CONTRACT_OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
