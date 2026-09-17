#!/usr/bin/env bash
set -euo pipefail

echo "==> Evaluando consumo de memoria RAM del stack..."

# Solo contenedores de este compose (no todo el daemon)
docker compose stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"

# Calcular uso total aproximado en megabytes (solo la columna de uso, no el limite)
TOTAL_MEM_MB=$(docker compose stats --no-stream --format "{{.MemUsage}}" | awk '{
  usage = $1
  val = usage
  sub(/[A-Za-z]+/, "", val)
  if (usage ~ /GiB/) {
    total += val * 1024
  } else if (usage ~ /MiB/) {
    total += val
  } else if (usage ~ /KiB/ || usage ~ /kB/) {
    total += val / 1024
  }
} END { print int(total) }')

echo "Consumo total acumulado estimado: ${TOTAL_MEM_MB} MiB"

MAX_ALLOWED_MB=4608  # 4.5 GB en MiB

if [ "$TOTAL_MEM_MB" -le "$MAX_ALLOWED_MB" ]; then
  echo "OK: El consumo de memoria (${TOTAL_MEM_MB} MiB) se encuentra dentro del limite presupuestado (< 4500 MiB)."
  echo "MEMORIA_RAM_OK"
  exit 0
else
  echo "ADVERTENCIA: El consumo (${TOTAL_MEM_MB} MiB) supera el presupuesto de ${MAX_ALLOWED_MB} MiB." >&2
  exit 1
fi
