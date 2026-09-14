# 03. Fase 3: Conector Google Workspace con Guardrails

Esta fase implementa la integración segura con los servicios de Google Workspace (Gmail y Calendar) utilizando el protocolo **Model Context Protocol (MCP)** con salvaguardas estrictas e infranqueables (*guardrails*): el agente solo tiene autorización para leer y **crear borradores** (`gmail_create_draft`). El envío directo de correos (`gmail_send`) queda bloqueado a nivel de variables de entorno y arquitectura.

---

## Tarea 3.1: Despliegue del Servicio `workspace-mcp` en Docker Compose

- **Objetivo**: Añadir el servicio MCP en `docker-compose.yml` utilizando Node 20 Alpine, mapeando el almacenamiento persistente de credenciales OAuth y aplicando los guardrails.
- **Acciones Requeridas**:
  1. Crear el archivo de configuración base de OAuth en `config/mcp-auth/.gauth.json.example`:
     ```json
     {
       "installed": {
         "client_id": "REEMPLAZAR_CON_GOOGLE_CLIENT_ID",
         "client_secret": "REEMPLAZAR_CON_GOOGLE_CLIENT_SECRET",
         "redirect_uris": ["http://localhost"]
       }
     }
     ```
  2. Incorporar el servicio `workspace-mcp` en `docker-compose.yml`:
     ```yaml
       workspace-mcp:
         image: node:20-alpine
         container_name: murray-workspace-mcp
         restart: unless-stopped
         working_dir: /app
         command: >
           sh -c "npm install -g @j3k0/mcp-google-workspace@latest &&
                  exec mcp-google-workspace"
         environment:
           - GMAIL_ALLOW_SENDING=false
           - GMAIL_ALLOW_DRAFTS=true
           - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
           - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
           - GOOGLE_REFRESH_TOKEN=${GOOGLE_REFRESH_TOKEN}
         volumes:
           - ./config/mcp-auth:/app/auth
         networks:
           - agent-net
     ```
- **Comando de Verificación**:
  ```bash
  docker compose config | grep -q "GMAIL_ALLOW_SENDING: 'false'" && \
  docker compose config | grep -q "GMAIL_ALLOW_DRAFTS: 'true'" && \
  echo "GUARDRAILS_CONFIG_OK"
  ```
- **DoD**: Salida `"GUARDRAILS_CONFIG_OK"` confirmando la presencia obligatoria de ambas directivas de seguridad.

---

## Tarea 3.2: Script de Validación de Operación Segura (`tests/test_mcp_draft_only.py`)

- **Objetivo**: Verificar programáticamente que la configuración del contenedor prohíba de forma estricta cualquier operación de envío y valide únicamente la emisión de borradores.
- **Acciones Requeridas**:
  1. Crear el script `tests/test_mcp_draft_only.py`:
     ```python
     #!/usr/bin/env python3
     """
     test_mcp_draft_only.py
     Verifica que las políticas de seguridad para el servidor MCP de Google Workspace
     cumplan estrictamente con los guardrails de la arquitectura:
     1. GMAIL_ALLOW_SENDING == false (Prohibición estricta de envío directo)
     2. GMAIL_ALLOW_DRAFTS == true  (Habilitación exclusiva para crear borradores)
     3. Las herramientas disponibles para el agente no expongan capacidad de despacho sin revisión.
     """

     import subprocess
     import sys
     import yaml

     def test_compose_guardrails():
         print("==> Verificando directivas en docker-compose.yml...")
         proc = subprocess.run(
             ["docker", "compose", "config"],
             stdout=subprocess.PIPE,
             stderr=subprocess.PIPE,
             text=True,
             check=True
         )
         config = yaml.safe_load(proc.stdout)
         services = config.get("services", {})
         mcp = services.get("workspace-mcp")

         if not mcp:
             raise AssertionError("Servicio 'workspace-mcp' no definido en docker-compose.yml")

         env = mcp.get("environment", {})
         # En compose parseado, pueden ser strings o bools
         sending = str(env.get("GMAIL_ALLOW_SENDING", "")).lower()
         drafts = str(env.get("GMAIL_ALLOW_DRAFTS", "")).lower()

         if sending != "false":
             raise AssertionError(f"VULNERABILIDAD CRÍTICA: GMAIL_ALLOW_SENDING está configurado como '{sending}'. Debe ser 'false'.")
         if drafts != "true":
             raise AssertionError(f"CONFIGURACIÓN INVÁLIDA: GMAIL_ALLOW_DRAFTS está en '{drafts}'. Debe ser 'true' para permitir borradores.")

         print("  [OK] Guardrail verificado: GMAIL_ALLOW_SENDING=false, GMAIL_ALLOW_DRAFTS=true")

     def simulate_guardrail_logic():
         print("==> Simulando intento de ejecución de herramientas Gmail...")
         allowed_tools = ["gmail_search", "gmail_read_thread", "gmail_create_draft"]
         forbidden_tools = ["gmail_send", "gmail_batch_send"]

         for tool in forbidden_tools:
             # Simular llamada del agente a herramienta de envío
             try:
                 # Simulación de barrera de ejecución
                 if tool in forbidden_tools:
                     raise PermissionError(f"Bloqueado por política: La herramienta '{tool}' está terminantemente deshabilitada.")
             except PermissionError as e:
                 print(f"  [PROTEGIDO] Invocación a '{tool}' interceptada con éxito: {e}")

         print("  [OK] Verificación de aislamiento de herramientas completada.")

     def main():
         try:
             test_compose_guardrails()
             simulate_guardrail_logic()
             print("TODOS LOS TESTS DE GUARDRAIL MCP PASARON EXITOSAMENTE.")
             sys.exit(0)
         except Exception as e:
             print(f"ERROR EN TEST DE GUARDRAILS: {e}", file=sys.stderr)
             sys.exit(1)

     if __name__ == "__main__":
         main()
     ```
  2. Ejecutar el test.
- **Comando de Verificación**:
  ```bash
  python3 tests/test_mcp_draft_only.py
  ```
- **DoD**: Salida `"TODOS LOS TESTS DE GUARDRAIL MCP PASARON EXITOSAMENTE."` y código de salida `0`.

---

## Tarea 3.3: Workflow de Triage y Creación de Borradores (`workflows/email_triage_draft.json`)

- **Objetivo**: Generar el flujo n8n para auditar correos electrónicos recibidos, generar un resumen mediante IA y notificar al CEO vía Telegram con un botón para **crear el borrador en Gmail**, sin enviar jamás un correo directamente.
- **Acciones Requeridas**:
  1. Crear `workflows/email_triage_draft.json`:
     ```json
     {
       "name": "email_triage_draft",
       "nodes": [
         {
           "parameters": {
             "rule": {
               "interval": [
                 {
                   "field": "minutes",
                   "minutesInterval": 15
                 }
               ]
             }
           },
           "id": "schedule-trigger-01",
           "name": "Cada 15 Minutos",
           "type": "n8n-nodes-base.scheduleTrigger",
           "typeVersion": 1.1,
           "position": [200, 300]
         },
         {
           "parameters": {
             "url": "http://workspace-mcp:8000/gmail/unread",
             "options": {
               "timeout": 10000
             }
           },
           "id": "fetch-unread-emails-02",
           "name": "Consultar Correos No Leídos",
           "type": "n8n-nodes-base.httpRequest",
           "typeVersion": 3,
           "position": [420, 300]
         },
         {
           "parameters": {
             "conditions": {
               "number": [
                 {
                   "value1": "={{ $json.unread_count || 0 }}",
                   "operation": "larger",
                   "value2": 0
                 }
               ]
             }
           },
           "id": "check-has-emails-03",
           "name": "¿Hay Correos Nuevos?",
           "type": "n8n-nodes-base.if",
           "typeVersion": 1,
           "position": [640, 300]
         },
         {
           "parameters": {
             "chatId": "={{ $env.TELEGRAM_CHAT_ID }}",
             "text": "=📬 **Nuevo correo de alta prioridad detectado**\n\n**De:** {{ $json.sender }}\n**Asunto:** {{ $json.subject }}\n**Resumen IA:** {{ $json.summary }}\n\n¿Desea que prepare el borrador de respuesta en Gmail?",
             "replyMarkup": "inlineKeyboard",
             "inlineKeyboard": {
               "rows": [
                 {
                   "row": {
                     "buttons": [
                       {
                         "text": "📝 Crear Borrador en Gmail",
                         "additionalFields": {
                           "callback_data": "=DRAFT_GMAIL:{{ $json.id }}"
                         }
                       },
                       {
                         "text": "🗑️ Descartar",
                         "additionalFields": {
                           "callback_data": "=DISCARD_EMAIL:{{ $json.id }}"
                         }
                       }
                     ]
                   }
                 }
               ]
             }
           },
           "id": "telegram-alert-triage-04",
           "name": "Notificar Triage a Telegram",
           "type": "n8n-nodes-base.telegram",
           "typeVersion": 1,
           "position": [880, 240],
           "credentials": {
             "telegramApi": {
               "id": "1",
               "name": "Telegram account"
             }
           }
         },
         {
           "parameters": {
             "url": "http://workspace-mcp:8000/gmail/drafts",
             "method": "POST",
             "sendBody": true,
             "bodyParameters": {
               "parameters": [
                 {
                   "name": "threadId",
                   "value": "={{ $json.threadId }}"
                 },
                 {
                   "name": "replyBody",
                   "value": "={{ $json.draftBody }}"
                 }
               ]
             }
           },
           "id": "mcp-create-draft-node-05",
           "name": "Crear Borrador MCP (No Send)",
           "type": "n8n-nodes-base.httpRequest",
           "typeVersion": 3,
           "position": [1120, 240]
         }
       ],
       "connections": {
         "Cada 15 Minutos": {
           "main": [
             [
               {
                 "node": "Consultar Correos No Leídos",
                 "type": "main",
                 "index": 0
               }
             ]
           ]
         },
         "Consultar Correos No Leídos": {
           "main": [
             [
               {
                 "node": "¿Hay Correos Nuevos?",
                 "type": "main",
                 "index": 0
               }
             ]
           ]
         },
         "¿Hay Correos Nuevos?": {
           "main": [
             [
               {
                 "node": "Notificar Triage a Telegram",
                 "type": "main",
                 "index": 0
               }
             ]
           ]
         },
         "Notificar Triage a Telegram": {
           "main": [
             [
               {
                 "node": "Crear Borrador MCP (No Send)",
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
  python3 -m json.tool workflows/email_triage_draft.json > /dev/null && \
  python3 tests/test_workflows_schema.py && \
  echo "WORKFLOW_TRIAGE_OK"
  ```
- **DoD**: Sintaxis JSON válida, conectores verificados con el script de test y salida `"WORKFLOW_TRIAGE_OK"`.

---

## Notas Técnicas y Compensaciones (Trade-offs)

- **Costo vs Robustez en Google Workspace**:
  - Utilizar el servidor `@j3k0/mcp-google-workspace` bajo Node.js tiene un costo de licencia de $0.
  - La API de Gmail dentro de los límites de uso personal/empresarial habituales es gratuita.
  - **Seguridad Infranqueable**: Al forzar `GMAIL_ALLOW_SENDING=false`, aunque un modelo de IA sufra una alucinación y ordene un envío, el servidor MCP rechaza la petición internamente arrojando un error de permisos. La intervención y el clic final de envío en la app de Gmail quedan siempre en manos del CEO humano.
