#!/usr/bin/env python3
import json
import os
import sys


def validate_workflow(filepath):
    print(f"Validando workflow: {filepath}")
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    if "nodes" not in data or not isinstance(data["nodes"], list):
        raise ValueError(f"Falta lista de 'nodes' en {filepath}")
    if "connections" not in data or not isinstance(data["connections"], dict):
        raise ValueError(f"Falta diccionario de 'connections' en {filepath}")

    node_names = {node["name"] for node in data["nodes"] if "name" in node}
    print(f"  Nodos encontrados ({len(node_names)}): {', '.join(sorted(node_names))}")

    # Verificar conexiones válidas
    for source, conns in data["connections"].items():
        if source not in node_names:
            raise ValueError(f"Conexión huérfana: el nodo origen '{source}' no existe.")
        for branch in conns.get("main", []):
            for target in branch:
                if target["node"] not in node_names:
                    raise ValueError(
                        f"Conexión rota: nodo destino '{target['node']}' no existe."
                    )

    print("  [OK] Estructura y conexiones íntegras.")


def main():
    workflows_dir = "workflows"
    if not os.path.isdir(workflows_dir):
        print(f"ERROR: Directorio '{workflows_dir}' no existe.")
        sys.exit(1)

    files = [
        os.path.join(workflows_dir, f)
        for f in os.listdir(workflows_dir)
        if f.endswith(".json")
    ]
    if not files:
        print("ADVERTENCIA: No se encontraron archivos JSON en workflows.")
        sys.exit(1)

    for wf in files:
        validate_workflow(wf)

    print("TODOS LOS WORKFLOWS SON VÁLIDOS.")


if __name__ == "__main__":
    main()
