# 01. Fase 1: Inicialización de Entorno y Red Segura

Esta fase establece los cimientos de infraestructura, seguridad de red y persistencia de datos. Al finalizar esta fase, el repositorio tendrá la estructura de carpetas estandarizada, las plantillas de configuración de secretos y los servicios base (`postgres_db` y `cloudflared`) operativos en una red privada aislada.

---

## Tarea 1.1: Inicialización de la Estructura de Directorios

- **Objetivo**: Crear la jerarquía completa de carpetas del proyecto para alojar configuraciones, volúmenes locales, flujos de n8n y scripts de validación.
- **Acciones Requeridas**:
  1. Crear los directorios:
     - `config/cloudflared`: Configuraciones opcionales o credenciales del túnel.
     - `config/n8n`: Persistencia local para hooks o extensiones de n8n.
     - `config/mcp-auth`: Almacenamiento seguro de tokens y credenciales OAuth de Google Workspace (`.gauth.json`, `.accounts.json`).
     - `workflows`: Archivos JSON de los flujos de automatización n8n.
     - `tests`: Scripts de pruebas unitarias, de integración y smoke tests.
     - `workspace`: Espacio de trabajo seguro aislado para proyectos manipulados por OpenHands.
- **Comando de Verificación**:
  ```bash
  test -d config/cloudflared && test -d config/n8n && test -d config/mcp-auth && test -d workflows && test -d tests && test -d workspace && echo "DIRECTORIOS_OK"
  ```
- **Definition of Done (DoD)**: El comando imprime `"DIRECTORIOS_OK"` y todos los directorios existen con permisos de lectura/escritura (`755`).

---

## Tarea 1.2: Plantilla de Variables de Entorno (`.env.example`)

- **Objetivo**: Proveer una plantilla exhaustiva con todas las variables necesarias para el funcionamiento del stack, con documentación en comentarios y sin exponer secretos reales.
- **Acciones Requeridas**:
  1. Crear el archivo `.env.example` en la raíz con el siguiente contenido exacto:
     ```bash
     # ==============================================================================
     # CONFIGURACIÓN DEL SISTEMA "1-PERSON CEO" (murray-infra)
     # Copiar este archivo a .env y completar los valores reales antes de levantar
     # ==============================================================================

     # ------------------------------------------------------------------------------
     # 1. Cloudflare Zero Trust Tunnel
     # ------------------------------------------------------------------------------
     CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoiZXhhbXBsZXRva2VuIn0=
     SUBDOMINIO_PUBLICO=ceo-automation.midominio.com

     # ------------------------------------------------------------------------------
     # 2. Persistencia PostgreSQL para n8n
     # ------------------------------------------------------------------------------
     POSTGRES_USER=n8n_admin
     POSTGRES_PASSWORD=CAMBIAR_POR_PASSWORD_SEGURO_PG_12345!
     POSTGRES_DB=n8n_database
     POSTGRES_PORT=5432

     # ------------------------------------------------------------------------------
     # 3. Orquestador n8n
     # ------------------------------------------------------------------------------
     # Clave de 32+ caracteres para cifrar credenciales en la base de datos (OBLIGATORIA)
     N8N_ENCRYPTION_KEY=clave_aleatoria_segura_de_32_caracteres_minimo_hex
     N8N_PORT=5678

     # ------------------------------------------------------------------------------
     # 4. Canal de Control Humano (Telegram Bot HITL)
     # ------------------------------------------------------------------------------
     TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz123456789
     TELEGRAM_CHAT_ID=987654321

     # ------------------------------------------------------------------------------
     # 5. Motor LLM (DeepSeek / LiteLLM)
     # ------------------------------------------------------------------------------
     DEEPSEEK_API_KEY=sk-deepseek-api-key-aqui

     # ------------------------------------------------------------------------------
     # 6. Conector Google Workspace MCP
     # ------------------------------------------------------------------------------
     GOOGLE_CLIENT_ID=ejemplo-client-id.apps.googleusercontent.com
     GOOGLE_CLIENT_SECRET=GOCSPX-ejemploSecretGoogle12345
     GOOGLE_REFRESH_TOKEN=1//ejemploRefreshTokenConScopeGmailDraft

     # ------------------------------------------------------------------------------
     # 7. Runtime OpenHands Sandbox
     # ------------------------------------------------------------------------------
     OPENHANDS_PORT=3000
     WORKSPACE_BASE=./workspace
     ```
  2. Si el archivo `.env` no existe en la raíz, copiar `.env.example` a `.env` para que el entorno local cuente con los placeholders iniciales.
- **Comando de Verificación**:
  ```bash
  test -f .env.example && grep -q "N8N_ENCRYPTION_KEY" .env.example && grep -q "POSTGRES_PASSWORD" .env.example && grep -q "TELEGRAM_CHAT_ID" .env.example && echo "ENV_TEMPLATE_OK"
  ```
- **DoD**: Salida `"ENV_TEMPLATE_OK"` y presencia obligatoria de todas las claves requeridas.

---

## Tarea 1.3: Docker Compose Base (Postgres y Cloudflared)

- **Objetivo**: Configurar el archivo `docker-compose.yml` con la red interna privada `agent-net`, persistencia de volumen para PostgreSQL y el cliente del túnel Cloudflare.
- **Acciones Requeridas**:
  1. Crear o inicializar `docker-compose.yml` en la raíz:
     ```yaml
     services:
       postgres_db:
         image: postgres:16-alpine
         container_name: murray-postgres
         restart: unless-stopped
         environment:
           POSTGRES_USER: ${POSTGRES_USER:-n8n_admin}
           POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-cambiar_password_seguro}
           POSTGRES_DB: ${POSTGRES_DB:-n8n_database}
         volumes:
           - postgres_data:/var/lib/postgresql/data
         healthcheck:
           test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-n8n_admin} -d ${POSTGRES_DB:-n8n_database}"]
           interval: 10s
           timeout: 5s
           retries: 5
           start_period: 5s
         networks:
           - agent-net

       cloudflared:
         image: cloudflare/cloudflared:latest
         container_name: murray-cloudflared
         restart: unless-stopped
         command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
         environment:
           CLOUDFLARE_TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
         networks:
           - agent-net

     networks:
       agent-net:
         driver: bridge

     volumes:
       postgres_data:
         driver: local
     ```
- **Comando de Verificación**:
  ```bash
  docker compose config --services | grep -q "postgres_db" && docker compose config --services | grep -q "cloudflared" && echo "COMPOSE_BASE_OK"
  ```
- **DoD**: `docker compose config` valida sintaxis sin errores e imprime `"COMPOSE_BASE_OK"`.

---

## Tarea 1.4: Script de Validación de PostgreSQL (`tests/test_postgres.sh`)

- **Objetivo**: Proporcionar un script ejecutable determinista que levante `postgres_db` si no está corriendo, espere su estado saludable (`healthy`) y ejecute una consulta SQL básica de verificación.
- **Acciones Requeridas**:
  1. Crear el script `tests/test_postgres.sh`:
     ```bash
     #!/usr/bin/env bash
     set -euo pipefail

     echo "==> [TEST] Verificando servicio PostgreSQL..."

     # Cargar variables de .env si existe
     if [ -f .env ]; then
       export $(grep -v '^#' .env | xargs)
     fi

     USER="${POSTGRES_USER:-n8n_admin}"
     DB="${POSTGRES_DB:-n8n_database}"

     # Asegurar que el contenedor está arriba
     docker compose up -d postgres_db

     # Esperar hasta 30 segundos a que pg_isready responda
     RETRIES=15
     until docker compose exec -T postgres_db pg_isready -U "$USER" -d "$DB" > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
       echo "Esperando a que PostgreSQL esté listo... ($RETRIES restantes)"
       RETRIES=$((RETRIES-1))
       sleep 2
     done

     if [ $RETRIES -eq 0 ]; then
       echo "ERROR: PostgreSQL no respondió a tiempo." >&2
       exit 1
     fi

     # Test de consulta SQL directa
     QUERY_RESULT=$(docker compose exec -T postgres_db psql -U "$USER" -d "$DB" -t -c "SELECT 1;" | tr -d '[:space:]')

     if [ "$QUERY_RESULT" = "1" ]; then
       echo "OK: PostgreSQL está listo y aceptando conexiones."
       exit 0
     else
       echo "ERROR: Consulta de verificación falló con resultado '$QUERY_RESULT'." >&2
       exit 1
     fi
     ```
  2. Otorgar permisos de ejecución: `chmod +x tests/test_postgres.sh`.
- **Comando de Verificación**:
  ```bash
  bash tests/test_postgres.sh
  ```
- **DoD**: Salida `"OK: PostgreSQL está listo y aceptando conexiones."` y código de salida `0`.

---

## Notas Técnicas y Compensaciones (Trade-offs)

- **Robustez vs Costo**:
  - `postgres:16-alpine`: Utiliza ~25 MB de imagen y ~20-30 MB de RAM. Es la opción más liviana y robusta para persistencia transaccional de n8n. Costo: $0.
  - `cloudflared`: Evita la necesidad de contratar una IP pública fija, abrir puertos en el router o configurar certificados SSL manualmente con Let's Encrypt / Certbot. Todo el tráfico entrante llega cifrado directo al contenedor. Costo: $0 (Cloudflare Free Tier).
- **Limitación documentada**:
  - El volumen `postgres_data` es local al host Docker. En un entorno de producción multinodo se recomendaría un backup periódico automatizado vía cron (`pg_dump`) hacia almacenamiento seguro (ej. S3 / R2). Para este stack mononodo local, el volumen con nombre es la solución estándar y eficiente.
