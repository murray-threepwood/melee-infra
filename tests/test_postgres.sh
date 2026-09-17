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
