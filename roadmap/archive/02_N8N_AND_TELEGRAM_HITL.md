> **HISTÓRICO — NO EJECUTAR.**
> Este documento es el bootstrap original (fases 1–6), ya cumplido.
> No lo re-implementes. No “arregles” el código ni el compose para que coincida con este texto.
> Ley vigente: `roadmap/README.md` y las fases 07–10.
> Endurecimiento del socket Docker: `roadmap/90_BACKLOG_HARDENING.md` (fuera de ejecución).

# 02. Fase 2: Orquestador n8n y Canal HITL (Telegram)

Esta fase integra el motor de orquestación de flujos de trabajo **n8n** respaldado por PostgreSQL y despliega el canal de comunicación bidireccional y control humano (*Human-In-The-Loop*) mediante un bot de Telegram con filtrado estricto de identidad.

---

## Tarea 2.1: Despliegue del Servicio n8n Conectado a Postgres

- **Objetivo**: Incorporar `n8n` al archivo `docker-compose.yml`, vinculándolo a la base de datos `postgres_db` creada en la Fase 1, inyectando la clave de cifrado obligatoria y exponiendo su salud vía endpoint `/healthz`.
- **Acciones Requeridas**:
  1. Actualizar `docker-compose.yml` para incorporar el servicio `n8n` y el volumen persistente `n8n_data`:
     ```yaml
       n8n:
         image: n8nio/n8n:latest
         container_name: murray-n8n
         restart: unless-stopped
         ports:
           - "127.0.0.1:${N8N_PORT:-5678}:5678"
         environment:
           - DB_TYPE=postgresdb
           - DB_POSTGRESDB_HOST=postgres_db
           - DB_POSTGRESDB_PORT=5432
           - DB_POSTGRESDB_DATABASE=${POSTGRES_DB:-n8n_database}
           - DB_POSTGRESDB_USER=${POSTGRES_USER:-n8n_admin}
           - DB_POSTGRESDB_PASSWORD=${POSTGRES_PASSWORD:-cambiar_password_seguro}
           - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
           - WEBHOOK_URL=https://${SUBDOMINIO_PUBLICO}/
           - N8N_HOST=0.0.0.0
           - N8N_PORT=5678
           - GENERIC_TIMEZONE=UTC
           - EXECUTIONS_DATA_PRUNE=true
           - EXECUTIONS_DATA_MAX_AGE=168
         volumes:
           - n8n_data:/home/node/.n8n
           - ./workflows:/opt/workflows:ro
         depends_on:
           postgres_db:
             condition: service_healthy
         healthcheck:
           test: ["CMD-SHELL", "wget -q -O - http://127.0.0.1:5678/healthz || exit 1"]
           interval: 10s
           timeout: 5s
           retries: 6
           start_period: 15s
         networks:
           - agent-net
     ```
  2. Agregar el volumen `n8n_data` a la sección `volumes` de `docker-compose.yml`:
     ```yaml
     volumes:
       postgres_data:
         driver: local
       n8n_data:
         driver: local
     ```
  3. Levantar el servicio y esperar la inicialización de migraciones de n8n:
     ```bash
     docker compose up -d n8n
     ```
- **Comando de Verificación**:
  ```bash
  RETRIES=15
  until docker compose exec -T n8n wget -q -O - http://127.0.0.1:5678/healthz > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
    sleep 2
    RETRIES=$((RETRIES-1))
  done
  docker compose exec -T n8n wget -q -O - http://127.0.0.1:5678/healthz | grep -q "status" && echo "N8N_HEALTH_OK"
  ```
- **DoD**: Salida `"N8N_HEALTH_OK"` y endpoint `/healthz` respondiendo estado saludable.

---

## Tarea 2.2: Generación del Flujo HITL (`workflows/telegram_hitl_router.json`)

- **Objetivo**: Crear un flujo n8n completamente válido e importable que capture eventos de Telegram (mensajes y botones interactivos), aplique un filtro de seguridad por `TELEGRAM_CHAT_ID` y permita al CEO aprobar, rechazar o pausar la ejecución de tareas.
- **Acciones Requeridas**:
  1. Crear el archivo `workflows/telegram_hitl_router.json` con el siguiente contenido JSON estructurado y normalizado para n8n:
     ```json
     {
       "name": "telegram_hitl_router",
       "nodes": [
         {
           "parameters": {
             "updates": [
               "message",
               "callback_query"
             ],
             "additionalFields": {}
           },
           "id": "telegram-trigger-01",
           "name": "Telegram Trigger",
           "type": "n8n-nodes-base.telegramTrigger",
           "typeVersion": 1,
           "position": [240, 300],
           "credentials": {
             "telegramApi": {
               "id": "1",
               "name": "Telegram account"
             }
           }
         },
         {
           "parameters": {
             "conditions": {
               "string": [
                 {
                   "value1": "={{ $json.message ? String($json.message.chat.id) : String($json.callback_query.from.id) }}",
                   "operation": "equal",
                   "value2": "={{ $env.TELEGRAM_CHAT_ID }}"
                 }
               ]
             }
           },
           "id": "filter-admin-02",
           "name": "Filtro Seguridad ChatID",
           "type": "n8n-nodes-base.if",
           "typeVersion": 1,
           "position": [460, 300]
         },
         {
           "parameters": {
             "conditions": {
               "boolean": [
                 {
                   "value1": "={{ !!$json.callback_query }}",
                   "value2": true
                 }
               ]
             }
           },
           "id": "switch-msg-type-03",
           "name": "¿Es Callback de Botón?",
           "type": "n8n-nodes-base.if",
           "typeVersion": 1,
           "position": [680, 240]
         },
         {
           "parameters": {
             "chatId": "={{ $json.message.chat.id }}",
             "text": "=⚡ Solicitud recibida: \"{{ $json.message.text }}\"\n¿Desea autorizar la ejecución en el sandbox de OpenHands?",
             "replyMarkup": "inlineKeyboard",
             "inlineKeyboard": {
               "rows": [
                 {
                   "row": {
                     "buttons": [
                       {
                         "text": "✅ Aprobar",
                         "additionalFields": {
                           "callback_data": "=APPROVE_TASK:{{ $json.message.message_id }}"
                         }
                       },
                       {
                         "text": "❌ Rechazar",
                         "additionalFields": {
                           "callback_data": "=REJECT_TASK:{{ $json.message.message_id }}"
                         }
                       },
                       {
                         "text": "⏸️ Pausar",
                         "additionalFields": {
                           "callback_data": "=PAUSE_TASK:{{ $json.message.message_id }}"
                         }
                       }
                     ]
                   }
                 }
               ]
             }
           },
           "id": "telegram-send-buttons-04",
           "name": "Enviar Teclado HITL",
           "type": "n8n-nodes-base.telegram",
           "typeVersion": 1,
           "position": [920, 160],
           "credentials": {
             "telegramApi": {
               "id": "1",
               "name": "Telegram account"
             }
           }
         },
         {
           "parameters": {
             "url": "http://openhands:3000/api/conversations",
             "method": "POST",
             "sendBody": true,
             "bodyParameters": {
               "parameters": [
                 {
                   "name": "action",
                   "value": "={{ $json.callback_query.data }}"
                 },
                 {
                   "name": "authorized_by",
                   "value": "={{ $json.callback_query.from.id }}"
                 }
               ]
             },
             "options": {
               "timeout": 5000
             }
           },
           "id": "http-dispatch-openhands-05",
           "name": "Delegar a OpenHands",
           "type": "n8n-nodes-base.httpRequest",
           "typeVersion": 3,
           "position": [920, 360]
         },
         {
           "parameters": {
             "chatId": "={{ $json.callback_query.message.chat.id }}",
             "text": "=✅ Orden procesada: {{ $json.callback_query.data }}."
           },
           "id": "telegram-notify-resolution-06",
           "name": "Notificar Resolución HITL",
           "type": "n8n-nodes-base.telegram",
           "typeVersion": 1,
           "position": [1140, 360],
           "credentials": {
             "telegramApi": {
               "id": "1",
               "name": "Telegram account"
             }
           }
         }
       ],
       "connections": {
         "Telegram Trigger": {
           "main": [
             [
               {
                 "node": "Filtro Seguridad ChatID",
                 "type": "main",
                 "index": 0
               }
             ]
           ]
         },
         "Filtro Seguridad ChatID": {
           "main": [
             [
               {
                 "node": "¿Es Callback de Botón?",
                 "type": "main",
                 "index": 0
               }
             ]
           ]
         },
         "¿Es Callback de Botón?": {
           "main": [
             [
               {
                 "node": "Delegar a OpenHands",
                 "type": "main",
                 "index": 0
               }
             ],
             [
               {
                 "node": "Enviar Teclado HITL",
                 "type": "main",
                 "index": 0
               }
             ]
           ]
         },
         "Delegar a OpenHands": {
           "main": [
             [
               {
                 "node": "Notificar Resolución HITL",
                 "type": "main",
                 "index": 0
               }
             ]
           ]
         }
       },
       "active": false,
       "settings": {
         "executionOrder": "v1"
       }
     }
     ```
- **Comando de Verificación**:
  ```bash
  python3 -m json.tool workflows/telegram_hitl_router.json > /dev/null && \
  grep -q "telegramTrigger" workflows/telegram_hitl_router.json && \
  grep -q "TELEGRAM_CHAT_ID" workflows/telegram_hitl_router.json && \
  grep -q "httpRequest" workflows/telegram_hitl_router.json && \
  echo "TELEGRAM_HITL_VALIDO"
  ```
- **DoD**: Sintaxis JSON validada sin errores y presencia de todos los nodos requeridos con salida `"TELEGRAM_HITL_VALIDO"`.

---

## Tarea 2.3: Script de Validación de Sintaxis y Conexiones de Workflows

- **Objetivo**: Asegurar que todos los flujos n8n dentro de `workflows/` respeten el estándar JSON y que los nodos críticos estén conectados secuencialmente.
- **Acciones Requeridas**:
  1. Crear `tests/test_workflows_schema.py`:
     ```python
     #!/usr/bin/env python3
     import json
     import os
     import sys

     def validate_workflow(filepath):
         print(f"Validando workflow: {filepath}")
         with open(filepath, 'r', encoding='utf-8') as f:
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
                         raise ValueError(f"Conexión rota: nodo destino '{target['node']}' no existe.")

         print(f"  [OK] Estructura y conexiones íntegras.")

     def main():
         workflows_dir = "workflows"
         if not os.path.isdir(workflows_dir):
             print(f"ERROR: Directorio '{workflows_dir}' no existe.")
             sys.exit(1)

         files = [os.path.join(workflows_dir, f) for f in os.listdir(workflows_dir) if f.endswith('.json')]
         if not files:
             print("ADVERTENCIA: No se encontraron archivos JSON en workflows.")
             sys.exit(1)

         for wf in files:
             validate_workflow(wf)

         print("TODOS LOS WORKFLOWS SON VÁLIDOS.")

     if __name__ == "__main__":
         main()
     ```
  2. Ejecutar validación.
- **Comando de Verificación**:
  ```bash
  python3 tests/test_workflows_schema.py
  ```
- **DoD**: Salida `"TODOS LOS WORKFLOWS SON VÁLIDOS."` con código de salida `0`.

---

## Notas Técnicas y Compensaciones (Trade-offs)

- **Seguridad en Telegram**:
  - Un bot de Telegram recibe mensajes de cualquier usuario que conozca su alias. El nodo `Filtro Seguridad ChatID` evalúa `$env.TELEGRAM_CHAT_ID`. Si la condición es falsa, el flujo termina silenciosamente sin ejecutar acción ni revelar la existencia de comandos.
- **Cifrado de Credenciales**:
  - `N8N_ENCRYPTION_KEY`: Si n8n se reinicia sin esta variable fija, genera una clave aleatoria efímera y no puede descifrar las credenciales almacenadas previamente en PostgreSQL. Definirla en `.env` asegura recuperación tras reinicios a costo $0.
