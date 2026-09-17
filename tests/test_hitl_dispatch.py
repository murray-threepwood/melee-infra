#!/usr/bin/env python3
"""Contrato Telegram router: un webhook, chat Murray, HITL sandbox/ops."""

import json
import sys
from pathlib import Path

WORKFLOW = Path("workflows/telegram_hitl_router.json")
OLD_DEAD_ROUTE = "http://openhands:3000/api/conversations"
NEW_ROUTE = "http://openhands:3000/api/v1/app-conversations"
MURRAY_CHAT = "http://murray-agent:8080/chat"
MURRAY_OPS = "http://murray-agent:8080/ops/execute"


def load_workflow():
    return json.loads(WORKFLOW.read_text(encoding="utf-8"))


def nodes_by_name(data):
    return {node["name"]: node for node in data["nodes"]}


def targets(data, source, branch):
    return {t["node"] for t in data["connections"][source]["main"][branch]}


def test_trigger_has_stable_webhook_id():
    data = load_workflow()
    triggers = [
        n for n in data["nodes"] if n.get("type", "").endswith("telegramTrigger")
    ]
    if len(triggers) != 1:
        raise AssertionError(f"un bot = un telegramTrigger, hay {len(triggers)}")
    trigger = triggers[0]
    webhook_id = trigger.get("webhookId")
    if webhook_id != "4dae132d-912c-40e0-b048-c00b42e03250":
        raise AssertionError(f"webhookId inesperado: {webhook_id}")
    if data.get("id") != "20uYWal9fr2bWwVV":
        raise AssertionError("el JSON CLI necesita id raíz 20uYWal9fr2bWwVV")


def test_openhands_uses_v1_route():
    data = load_workflow()
    dispatch = nodes_by_name(data)["Delegar a OpenHands"]
    url = dispatch["parameters"].get("url", "")
    if OLD_DEAD_ROUTE in url and "/api/v1/" not in url:
        raise AssertionError(f"Ruta SPA muerta (405): {url}. Debe ser {NEW_ROUTE}")
    if NEW_ROUTE not in url:
        raise AssertionError(f"Delegar a OpenHands no apunta a {NEW_ROUTE}: {url}")
    body = dispatch["parameters"].get("jsonBody", "")
    if "mission_text" not in body:
        raise AssertionError(
            "Delegar a OpenHands tiene que mandar mission_text, no solo APPROVE_TASK:id"
        )


def test_reject_skips_openhands():
    data = load_workflow()
    names = set(nodes_by_name(data))
    if "¿Aprobar OpenHands?" not in names:
        raise AssertionError("Falta el IF ¿Aprobar OpenHands?.")

    true_targets = targets(data, "¿Aprobar OpenHands?", 0)
    false_targets = targets(data, "¿Aprobar OpenHands?", 1)
    if (
        "Recuperar Texto Misión" not in true_targets
        and "Delegar a OpenHands" not in true_targets
    ):
        raise AssertionError("Aprobar no conecta a Recuperar/Delegar OpenHands.")
    if "Delegar a OpenHands" in false_targets:
        raise AssertionError("Rechazar/Pausar no debe llamar a OpenHands.")
    if "Notificar Resolución HITL" not in false_targets:
        raise AssertionError("Rechazar/Pausar no conecta directo a notificar.")


def test_callback_ops_before_openhands():
    data = load_workflow()
    callback_true = targets(data, "¿Es Callback de Botón?", 0)
    if "Delegar a OpenHands" in callback_true:
        raise AssertionError("El callback true no debe ir directo a OpenHands.")
    if "Enviar Teclado HITL" in callback_true:
        raise AssertionError("El callback no es el teclado HITL.")
    if "¿Callback Ops?" not in callback_true:
        raise AssertionError("El callback true debe ir a ¿Callback Ops?.")


def test_approve_ops_does_not_hit_openhands():
    data = load_workflow()
    true_targets = targets(data, "¿Aprobar Ops?", 0)
    false_targets = targets(data, "¿Aprobar Ops?", 1)
    if "Ejecutar Ops" not in true_targets:
        raise AssertionError("Aprobar ops debe pegar a Ejecutar Ops.")
    if "Rechazar Ops" not in false_targets:
        raise AssertionError("Rechazar ops debe pegar a Rechazar Ops.")
    if "Delegar a OpenHands" in true_targets or "Delegar a OpenHands" in false_targets:
        raise AssertionError("APPROVE_OPS/REJECT_OPS no pueden pegar a OpenHands.")
    execute = nodes_by_name(data)["Ejecutar Ops"]
    if MURRAY_OPS not in execute["parameters"].get("url", ""):
        raise AssertionError("Ejecutar Ops debe POST murray-agent /ops/execute")


def test_free_text_goes_to_murray_not_hitl_keyboard():
    data = load_workflow()
    callback_false = targets(data, "¿Es Callback de Botón?", 1)
    if "Enviar Teclado HITL" in callback_false:
        raise AssertionError(
            "Texto libre no puede ir al teclado OpenHands (eso era el bug de anoche)."
        )
    if "Clasificar mensaje" not in callback_false:
        raise AssertionError("Texto libre debe clasificarse (/oh vs chat).")
    sandbox_false = targets(data, "¿Misión sandbox?", 1)
    if "Consultar Murray" not in sandbox_false:
        raise AssertionError("Texto libre (no sandbox) debe ir a Consultar Murray.")
    if "Enviar Teclado HITL" in sandbox_false:
        raise AssertionError("Chat Murray no manda teclado OpenHands.")
    chat = nodes_by_name(data)["Consultar Murray"]
    if MURRAY_CHAT not in chat["parameters"].get("url", ""):
        raise AssertionError("Consultar Murray debe POST /chat")


def test_sandbox_prefix_goes_to_hitl():
    data = load_workflow()
    classify = nodes_by_name(data)["Clasificar mensaje"]
    code = classify["parameters"].get("jsCode", "")
    if "/oh" not in code or "sandbox:" not in code:
        raise AssertionError("Clasificar mensaje tiene que detectar /oh y sandbox:")
    sandbox_true = targets(data, "¿Misión sandbox?", 0)
    if (
        "Guardar Texto Misión" not in sandbox_true
        and "Enviar Teclado HITL" not in sandbox_true
    ):
        raise AssertionError("/oh|sandbox: debe ir al teclado OpenHands.")
    save = nodes_by_name(data)["Guardar Texto Misión"]
    if "missions" not in save["parameters"].get("jsCode", ""):
        raise AssertionError(
            "Guardar Texto Misión tiene que persistir staticData.missions"
        )


def test_telegram_send_uses_html_not_default_markdown():
    data = load_workflow()
    names = (
        "Notificar Resolución HITL",
        "Enviar Teclado HITL",
        "Enviar Teclado Ops",
        "Responder Murray",
    )
    for name in names:
        node = nodes_by_name(data)[name]
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
        test_callback_ops_before_openhands,
        test_approve_ops_does_not_hit_openhands,
        test_free_text_goes_to_murray_not_hitl_keyboard,
        test_sandbox_prefix_goes_to_hitl,
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
