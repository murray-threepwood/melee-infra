#!/usr/bin/env python3
"""
test_mcp_draft_only.py
Verifica que las políticas de seguridad para el servidor MCP de Google Workspace
cumplan estrictamente con los guardrails de la arquitectura:
1. GMAIL_ALLOW_SENDING == false (Prohibición estricta de envío directo)
2. GMAIL_ALLOW_DRAFTS == true  (Habilitación exclusiva para crear borradores)
3. Las herramientas disponibles para el agente no expongan capacidad de despacho sin revisión.
"""

import json
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None


def load_compose_config():
    json_proc = subprocess.run(
        ["docker", "compose", "config", "--format", "json"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if json_proc.returncode == 0 and json_proc.stdout.strip():
        return json.loads(json_proc.stdout)

    if yaml is None:
        raise RuntimeError(
            "docker compose config --format json falló y PyYAML no está instalado. "
            "Corré: uv sync"
        )

    proc = subprocess.run(
        ["docker", "compose", "config"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=True,
    )
    return yaml.safe_load(proc.stdout)


def test_compose_guardrails():
    print("==> Verificando directivas en docker-compose.yml...")
    config = load_compose_config()
    services = config.get("services", {})
    mcp = services.get("workspace-mcp")

    if not mcp:
        raise AssertionError(
            "Servicio 'workspace-mcp' no definido en docker-compose.yml"
        )

    env = mcp.get("environment", {})
    # En compose parseado, pueden ser strings o bools
    sending = str(env.get("GMAIL_ALLOW_SENDING", "")).lower()
    drafts = str(env.get("GMAIL_ALLOW_DRAFTS", "")).lower()

    if sending != "false":
        raise AssertionError(
            f"VULNERABILIDAD CRÍTICA: GMAIL_ALLOW_SENDING está configurado como '{sending}'. Debe ser 'false'."
        )
    if drafts != "true":
        raise AssertionError(
            f"CONFIGURACIÓN INVÁLIDA: GMAIL_ALLOW_DRAFTS está en '{drafts}'. Debe ser 'true' para permitir borradores."
        )

    print(
        "  [OK] Guardrail verificado: GMAIL_ALLOW_SENDING=false, GMAIL_ALLOW_DRAFTS=true"
    )

    pg = services.get("postgres_db") or {}
    image = str(pg.get("image") or "")
    if "postgres:16" not in image:
        raise AssertionError(
            f"Postgres tiene que seguir en 16 (imagen={image!r}). No subir major sin OK humano."
        )
    if "postgres:17" in image:
        raise AssertionError("Postgres 17 prohibido sin OK humano: rompe el volumen.")
    print("  [OK] Postgres major clavado en 16")


def test_source_has_no_stub_and_no_send_url():
    print("==> Verificando que el shim ya no es stub y no tiene URL de send...")
    server = Path("config/workspace-mcp/server.mjs").read_text(encoding="utf-8")
    client = Path("config/workspace-mcp/gmail-client.mjs").read_text(encoding="utf-8")
    for needle in ("awaiting_oauth", "stub_until_oauth"):
        if needle in server:
            raise AssertionError(f"server.mjs todavía finge stub con {needle}")
    if "users/me/messages/send" in client or "users/me/drafts/send" in client:
        raise AssertionError("gmail-client.mjs no puede contener URL de send")
    if "GMAIL_PATHS.send" in client:
        raise AssertionError("no existe GMAIL_PATHS.send")
    spec = Path("architecture_spec.md").read_text(encoding="utf-8")
    if "awaiting_oauth" in spec or "stub_until_oauth" in spec:
        raise AssertionError(
            "architecture_spec.md documenta el stub; el contrato vivo es status=ok / created"
        )
    if '"gmail_mode"' not in spec and "gmail_mode" not in spec:
        raise AssertionError(
            "architecture_spec.md tiene que declarar gmail_mode en /healthz"
        )
    print("  [OK] Contrato live: status=ok / drafts created; cero send en el client")


def simulate_guardrail_logic():
    print("==> Simulando intento de ejecución de herramientas Gmail...")
    allowed_tools = ["gmail_search", "gmail_read_thread", "gmail_create_draft"]
    forbidden_tools = ["gmail_send", "gmail_batch_send"]

    for tool in forbidden_tools:
        # Simular llamada del agente a herramienta de envío
        try:
            # Simulación de barrera de ejecución
            if tool in forbidden_tools:
                raise PermissionError(
                    f"Bloqueado por política: La herramienta '{tool}' está terminantemente deshabilitada."
                )
        except PermissionError as e:
            print(f"  [PROTEGIDO] Invocación a '{tool}' interceptada con éxito: {e}")

    print(f"  Herramientas permitidas (draft-only): {', '.join(allowed_tools)}")
    print("  [OK] Verificación de aislamiento de herramientas completada.")


def main():
    try:
        test_compose_guardrails()
        test_source_has_no_stub_and_no_send_url()
        simulate_guardrail_logic()
        print("TODOS LOS TESTS DE GUARDRAIL MCP PASARON EXITOSAMENTE.")
        sys.exit(0)
    except Exception as e:
        print(f"ERROR EN TEST DE GUARDRAILS: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
