#!/usr/bin/env bash
# ==============================================================================
# 🤖 EL CORAZÓN DE MURRAY — CONTROL PANEL & OBSERVABILIDAD LOCAL
# ==============================================================================
# Sistema 1-Person CEO (murray-infra)
# Operaciones, diagnóstico y observabilidad integral en consola (Capas 1, 2 y 3).
# ==============================================================================

set -u

# --- ANSI Color Palette ---
RESET="\033[0m"
BOLD="\033[1m"
CYAN="\033[1;36m"
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
BLUE="\033[1;34m"
MAGENTA="\033[1;35m"
RED="\033[1;31m"
DIM="\033[2m"

# Constantes del Stack
COMPOSE_FILE="docker-compose.yml"
MAX_ALLOWED_MB=4608 # 4.5 GB límite presupuestado en architecture_spec.md
SUPPORTED_OS_LABEL="macOS Darwin (arm64/x86_64)"

# Manejo de fases para señales (Ctrl+C nunca mata los servicios de Docker)
PANEL_PHASE="menu"

exit_panel_keep_services() {
    echo -e "\n${CYAN}${BOLD}👋 ¡Hasta luego! Los servicios continúan ejecutándose en segundo plano.${RESET}"
    echo -e "${DIM}   (Usa la opción 2 del menú si deseas detenerlos formalmente).${RESET}\n"
    exit 0
}

handle_sigint() {
    case "$PANEL_PHASE" in
        logs)
            echo -e "\n${YELLOW}${BOLD}⏸ Streaming de logs pausado. Los servicios siguen activos.${RESET}"
            PANEL_PHASE="confirm"
            ;;
        confirm)
            exit_panel_keep_services
            ;;
        *)
            exit_panel_keep_services
            ;;
    esac
}

trap 'handle_sigint' INT

# --- Verificaciones de Entorno y Prerrequisitos ---
check_prerequisites() {
    local missing=0
    if ! command -v docker &>/dev/null; then
        echo -e "${RED}❌ Error: 'docker' no está instalado o no se encuentra en el PATH.${RESET}"
        missing=1
    fi
    if ! docker compose version &>/dev/null; then
        echo -e "${RED}❌ Error: 'docker compose' (plugin v2) no está disponible.${RESET}"
        missing=1
    fi
    if [ ! -f "$COMPOSE_FILE" ]; then
        echo -e "${RED}❌ Error: No se encontró '$COMPOSE_FILE' en $(pwd).${RESET}"
        missing=1
    fi
    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            echo -e "${YELLOW}⚠️ Advertencia: No existe .env. Creando a partir de .env.example...${RESET}"
            cp .env.example .env
            echo -e "  ${GREEN}✓ .env creado. Revisa los valores antes de operar.${RESET}"
        else
            echo -e "${RED}❌ Error: Falta el archivo .env.${RESET}"
            missing=1
        fi
    fi
    return "$missing"
}

# --- Sondeo de Servicios (Idempotent Service Probes) ---
# Estados posibles: healthy | sick | down
probe_container() {
    local cname="$1"
    local running health

    running="$(docker inspect -f '{{.State.Running}}' "$cname" 2>/dev/null || echo "false")"
    if [ "$running" != "true" ]; then
        echo "down"
        return 0
    fi

    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}' "$cname" 2>/dev/null || echo "unknown")"
    if [ "$health" = "healthy" ] || [ "$health" = "running" ]; then
        echo "healthy"
    elif [ "$health" = "unhealthy" ] || [ "$health" = "starting" ]; then
        echo "sick"
    else
        echo "down"
    fi
}

describe_service_line() {
    local display_name="$1"
    local cname="$2"
    local desc="$3"
    local status
    status="$(probe_container "$cname")"

    case "$status" in
        healthy)
            echo -e "  ${GREEN}✓ ${display_name}${RESET} : ${GREEN}healthy${RESET} ${DIM}(${desc})${RESET}"
            ;;
        sick)
            echo -e "  ${YELLOW}⚠ ${display_name}${RESET} : ${YELLOW}${BOLD}sick / starting${RESET} ${DIM}(${desc})${RESET}"
            ;;
        down)
            echo -e "  ${RED}✗ ${display_name}${RESET} : ${RED}down${RESET} ${DIM}(${desc})${RESET}"
            ;;
        *)
            echo -e "  ${DIM}· ${display_name}${RESET} : ${status} ${DIM}(${desc})${RESET}"
            ;;
    esac
}

show_stack_status_header() {
    echo -e "${CYAN}${BOLD}📡 ESTADO DE SALUD DEL STACK:${RESET}"
    describe_service_line "murray-postgres     " "murray-postgres" "PostgreSQL 16 · Puerto 5432"
    describe_service_line "murray-cloudflared  " "murray-cloudflared" "Túnel Cloudflare Zero Trust"
    describe_service_line "murray-n8n          " "murray-n8n" "Orquestador n8n · 127.0.0.1:5678"
    describe_service_line "murray-workspace-mcp" "murray-workspace-mcp" "Gmail Draft-Only · 8000"
    describe_service_line "murray-agent        " "murray-agent" "DeepSeek LLM + Ops HITL · 8080"
    describe_service_line "murray-openhands    " "murray-openhands" "Sandbox Autónomo · 127.0.0.1:3000"
}

is_stack_healthy() {
    local s
    for s in murray-postgres murray-cloudflared murray-n8n murray-workspace-mcp murray-agent murray-openhands; do
        if [ "$(probe_container "$s")" != "healthy" ]; then
            return 1
        fi
    done
    return 0
}

# --- Menú Principal ---
show_menu() {
    clear
    echo -e "${CYAN}${BOLD}==================================================================${RESET}"
    echo -e "${CYAN}${BOLD}            🤖 EL CORAZÓN DE MURRAY — CONTROL PANEL               ${RESET}"
    echo -e "${CYAN}${BOLD}==================================================================${RESET}"
    show_stack_status_header
    echo -e "${CYAN}${BOLD}------------------------------------------------------------------${RESET}"
    echo -e " ${BOLD}🚀 GESTIÓN DEL STACK:${RESET}"
    echo -e "  ${GREEN}${BOLD}1.${RESET}  🚀 ${BOLD}Desplegar / Iniciar Stack${RESET} ${DIM}(Idempotente: verifica salud antes)${RESET}"
    echo -e "  ${RED}${BOLD}2.${RESET}  🛑 ${BOLD}Detener Stack${RESET} ${DIM}(docker compose stop)${RESET}"
    echo ""
    echo -e " ${BOLD}🧠 CAPA 1: OBSERVABILIDAD DEL AGENTE (MURRAY & OPENHANDS):${RESET}"
    echo -e "  ${BLUE}${BOLD}3.${RESET}  💬 ${BOLD}Inspeccionar Memoria y Conversación Reciente${RESET} ${DIM}(memory.json)${RESET}"
    echo -e "  ${BLUE}${BOLD}4.${RESET}  📁 ${BOLD}Inspeccionar Sesión Activa y Repositorios${RESET} ${DIM}(session.json / workspace)${RESET}"
    echo -e "  ${BLUE}${BOLD}5.${RESET}  ⏳ ${BOLD}Inspeccionar Cola de Trabajos (Jobs)${RESET} ${DIM}(jobs.json: clones, estados)${RESET}"
    echo -e "  ${BLUE}${BOLD}6.${RESET}  🩺 ${BOLD}Diagnóstico / Ping Interactivo a Murray${RESET} ${DIM}(/status, /health, /repo)${RESET}"
    echo -e "  ${BLUE}${BOLD}7.${RESET}  🤖 ${BOLD}Inspeccionar Estado de OpenHands${RESET} ${DIM}(/health y sandboxes activos)${RESET}"
    echo ""
    echo -e " ${BOLD}🖥️  CAPA 2 & 3: INFRAESTRUCTURA, WORKFLOWS Y LOGS:${RESET}"
    echo -e "  ${MAGENTA}${BOLD}8.${RESET}  📜 ${BOLD}Streaming de Logs en Vivo${RESET} ${DIM}(Coloreado: todo o selectivo)${RESET}"
    echo -e "  ${MAGENTA}${BOLD}9.${RESET}  📊 ${BOLD}Monitor de Recursos y Presupuesto de RAM${RESET} ${DIM}(<4.5GB & docker stats)${RESET}"
    echo -e "  ${YELLOW}${BOLD}10.${RESET} ⚡ ${BOLD}Triage Automático de Incidentes${RESET} ${DIM}(Scanner de RUNBOOK: 405, OAuth, binds)${RESET}"
    echo -e "  ${MAGENTA}${BOLD}11.${RESET} 🔄 ${BOLD}Inspeccionar Ejecuciones de n8n${RESET} ${DIM}(Historial en PostgreSQL)${RESET}"
    echo ""
    echo -e " ${BOLD}🧪 PRUEBAS & VERIFICACIÓN:${RESET}"
    echo -e "  ${CYAN}${BOLD}12.${RESET} 🧪 ${BOLD}Ejecutar Suites de Tests${RESET} ${DIM}(E2E completo, unitarios, memoria)${RESET}"
    echo ""
    echo -e " ${BOLD}🧹 MANTENIMIENTO Y LIMPIEZAS:${RESET}"
    echo -e "  ${YELLOW}${BOLD}13.${RESET} 🧹 ${BOLD}Menú de Limpieza Granular y Rearmado${RESET} ${DIM}(Workspace, memoria, rebuild)${RESET}"
    echo ""
    echo -e "  ${DIM}0.  🚪 Salir del Panel (Servicios continúan activos en segundo plano)${RESET}"
    echo -e "${CYAN}${BOLD}==================================================================${RESET}"
}

# ==============================================================================
# ACCIONES: CAPA 1 — OBSERVABILIDAD DEL AGENTE
# ==============================================================================

view_agent_memory() {
    echo -e "\n${BLUE}${BOLD}==================================================================${RESET}"
    echo -e "${BLUE}${BOLD}💬 CAPA 1: MEMORIA DE CONVERSACIÓN DE MURRAY (memory.json)${RESET}"
    echo -e "${BLUE}${BOLD}==================================================================${RESET}"

    if [ "$(probe_container "murray-agent")" != "healthy" ]; then
        echo -e "${RED}❌ El contenedor 'murray-agent' no está corriendo.${RESET}"
        read -p "Presiona Enter para volver..."
        return
    fi

    local raw_json
    raw_json="$(docker compose exec -T -w /tmp murray-agent cat /var/lib/murray-agent/memory.json 2>/dev/null || echo "{}")"

    python3 - "$raw_json" <<'PY'
import sys, json

try:
    data = json.loads(sys.argv[1])
except Exception as e:
    print(f"\033[1;31mError al parsear memory.json: {e}\033[0m")
    sys.exit(0)

if not data:
    print("\033[2mNo hay registros en memory.json aún.\033[0m")
    sys.exit(0)

print(f"\033[1;36mChats registrados en memoria: {len(data)}\033[0m\n")
for chat_id, turns in data.items():
    print(f"\033[1;33m📌 Chat ID: {chat_id} (Total turnos: {len(turns)})\033[0m")
    # Mostrar últimos 8 turnos
    recent = turns[-8:] if len(turns) > 8 else turns
    for idx, t in enumerate(recent, 1):
        role = t.get("role", "unknown")
        text = (t.get("content") or t.get("text") or "").strip()
        ts = t.get("timestamp", "")
        # Formato de rol
        if role == "user":
            prefix = "\033[1;32m👤 Humano:\033[0m"
        else:
            prefix = "\033[1;34m🤖 Murray:\033[0m"
        snippet = text if len(text) <= 300 else text[:297] + "..."
        # limpiar saltos de línea largos
        snippet = snippet.replace("\n", " ")
        print(f"   [{idx}] {prefix} {snippet}")
    print()
PY

    echo -e "${DIM}Nota: Murray retiene hasta 20 turnos por sesión según architecture_spec.md.${RESET}"
    read -p "Presiona Enter para volver..."
}

view_agent_session() {
    echo -e "\n${BLUE}${BOLD}==================================================================${RESET}"
    echo -e "${BLUE}${BOLD}📁 CAPA 1: SESIÓN DE CÓDIGO ACTIVA & WORKSPACE (session.json)${RESET}"
    echo -e "${BLUE}${BOLD}==================================================================${RESET}"

    if [ "$(probe_container "murray-agent")" = "healthy" ]; then
        local raw_json
        raw_json="$(docker compose exec -T -w /tmp murray-agent cat /var/lib/murray-agent/session.json 2>/dev/null || echo "{}")"

        echo -e "${CYAN}${BOLD}Estado de Sesiones en murray-agent:${RESET}"
        python3 - "$raw_json" <<'PY'
import sys, json

try:
    data = json.loads(sys.argv[1])
except Exception as e:
    data = {}

if not data:
    print("  \033[2mNo hay sesiones de coding activas registradas.\033[0m")
else:
    for chat_id, sess in data.items():
        print(f"  \033[1;33mChat ID:\033[0m {chat_id}")
        print(f"    \033[1;36mRepo Slug:\033[0m          {sess.get('slug', '—')}")
        print(f"    \033[1;36mURL Remota:\033[0m         {sess.get('url', '—')}")
        print(f"    \033[1;36mOpenHands Conv ID:\033[0m  {sess.get('conversationId', '—')}")
        print(f"    \033[1;36mÚltimo Test:\033[0m        {sess.get('lastTestCommand', '—')}")
        print(f"    \033[1;36mÚltima Misión:\033[0m      {sess.get('lastMission', '—')}")
        print(f"    \033[1;36mÚltimo Job ID:\033[0m      {sess.get('lastJobId', '—')}")
        print(f"    \033[1;36mAwaiting Inst:\033[0m      {sess.get('awaiting_instruction', False)}")
        print()
PY
    else
        echo -e "${YELLOW}⚠️  murray-agent no disponible para leer session.json.${RESET}"
    fi

    echo -e "\n${CYAN}${BOLD}Contenido del directorio local ./workspace:${RESET}"
    if [ -d "workspace" ]; then
        local items
        items="$(find workspace -maxdepth 1 -mindepth 1 -type d)"
        if [ -z "$items" ]; then
            echo -e "  ${DIM}Directorio ./workspace vacío (sin repos clonados actualmente).${RESET}"
        else
            for d in $items; do
                local size
                size="$(du -sh "$d" 2>/dev/null | cut -f1)"
                echo -e "  📁 ${GREEN}$(basename "$d")${RESET} (${size})"
                if [ -d "$d/.git" ]; then
                    local branch commit
                    branch="$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
                    commit="$(git -C "$d" log -1 --format="%h - %s (%cr)" 2>/dev/null || echo "sin commits")"
                    echo -e "     ${DIM}Rama: ${branch} | Último commit: ${commit}${RESET}"
                fi
            done
        fi
    else
        echo -e "  ${RED}Directorio ./workspace no existe.${RESET}"
    fi

    echo ""
    read -p "Presiona Enter para volver..."
}

view_agent_jobs() {
    echo -e "\n${BLUE}${BOLD}==================================================================${RESET}"
    echo -e "${BLUE}${BOLD}⏳ CAPA 1: COLA DE TRABAJOS Y ESTADOS (jobs.json)${RESET}"
    echo -e "${BLUE}${BOLD}==================================================================${RESET}"

    if [ "$(probe_container "murray-agent")" != "healthy" ]; then
        echo -e "${RED}❌ El contenedor 'murray-agent' no está disponible.${RESET}"
        read -p "Presiona Enter para volver..."
        return
    fi

    local raw_json
    raw_json="$(docker compose exec -T -w /tmp murray-agent cat /var/lib/murray-agent/jobs.json 2>/dev/null || echo "{}")"

    python3 - "$raw_json" <<'PY'
import sys, json, time

try:
    data = json.loads(sys.argv[1])
except Exception as e:
    data = {}

if not data:
    print("  \033[2mNo hay trabajos registrados en la cola.\033[0m")
    sys.exit(0)

print(f"\033[1;36mTotal de jobs registrados: {len(data)}\033[0m\n")
print(f"  {'ID':<18} {'TIPO':<10} {'ESTADO':<10} {'CHAT ID':<12} {'ACTUALIZADO'}")
print("  " + "-" * 70)

for job_id, j in sorted(data.items(), key=lambda x: x[1].get("createdAt", 0), reverse=True):
    jtype = j.get("type", "—")
    st = j.get("status", "—")
    cid = str(j.get("chatId", "—"))
    up_ts = j.get("updatedAt", 0)
    up_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(up_ts / 1000)) if up_ts else "—"

    if st == "done":
        st_color = f"\033[1;32m{st:<10}\033[0m"
    elif st == "failed":
        st_color = f"\033[1;31m{st:<10}\033[0m"
    elif st == "running":
        st_color = f"\033[1;33m{st:<10}\033[0m"
    else:
        st_color = f"{st:<10}"

    print(f"  {job_id:<18} {jtype:<10} {st_color} {cid:<12} {up_str}")
    if j.get("error"):
        print(f"    \033[1;31m↳ Error: {j.get('error')}\033[0m")
    payload = j.get("payload")
    if payload:
        p_slug = payload.get("slug") or payload.get("url") or ""
        if p_slug:
            print(f"    \033[2m↳ Detalle: {p_slug}\033[0m")
print()
PY

    read -p "Presiona Enter para volver..."
}

ping_murray_interactive() {
    echo -e "\n${BLUE}${BOLD}==================================================================${RESET}"
    echo -e "${BLUE}${BOLD}🩺 CAPA 1: DIAGNÓSTICO / PING INTERACTIVO A MURRAY (/chat)${RESET}"
    echo -e "${BLUE}${BOLD}==================================================================${RESET}"

    if [ "$(probe_container "murray-agent")" != "healthy" ]; then
        echo -e "${RED}❌ 'murray-agent' no está healthy.${RESET}"
        read -p "Presiona Enter para volver..."
        return
    fi

    echo -e "Elige un comando rápido o escribe un mensaje personalizado:"
    echo -e "  ${CYAN}1)${RESET} /status  ${DIM}(Estado interno, deepseek, jobs y workspace)${RESET}"
    echo -e "  ${CYAN}2)${RESET} /health  ${DIM}(Chequeo de salud del agente)${RESET}"
    echo -e "  ${CYAN}3)${RESET} /repo    ${DIM}(Información del repositorio activo)${RESET}"
    echo -e "  ${CYAN}4)${RESET} Mensaje libre"
    read -p "Opción [1-4]: " pchoice

    local query=""
    case "$pchoice" in
        1) query="/status" ;;
        2) query="/health" ;;
        3) query="/repo" ;;
        4)
            read -p "Escribe el prompt para Murray: " query
            ;;
        *)
            echo -e "${RED}Opción inválida.${RESET}"
            read -p "Presiona Enter..."
            return
            ;;
    esac

    if [ -z "$query" ]; then
        echo -e "${YELLOW}Consulta vacía.${RESET}"
        read -p "Presiona Enter..."
        return
    fi

    echo -e "\n${DIM}▶ Enviando a http://murray-agent:8080/chat...${RESET}"
    local payload
    payload="$(python3 -c "import json, sys; print(json.dumps({'chat_id': 'console_local', 'text': sys.argv[1]}))" "$query")"

    local resp
    resp="$(docker compose exec -T -w /tmp murray-agent node -e '
      const body = process.argv[1];
      fetch("http://127.0.0.1:8080/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      })
      .then(r => r.json())
      .then(data => console.log(JSON.stringify(data)))
      .catch(err => {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      });
    ' "$payload" 2>/dev/null || echo '{"error": "fallo conexion"}')"

    echo -e "\n${GREEN}${BOLD}Respuesta de Murray:${RESET}"
    python3 - "$resp" <<'PY'
import sys, json

try:
    data = json.loads(sys.argv[1])
except Exception:
    print(sys.argv[1])
    sys.exit(0)

if "error" in data:
    print(f"\033[1;31m❌ Error: {data.get('error')} — {data.get('message', '')}\033[0m")
else:
    reply = data.get("reply", "")
    print(reply)
    if data.get("needs_hitl"):
        print(f"\n\033[1;33m⚠️ Requiere aprobación HITL (approval_id={data.get('hitl',{}).get('approval_id')})\033[0m")
PY

    echo ""
    read -p "Presiona Enter para volver..."
}

inspect_openhands() {
    echo -e "\n${BLUE}${BOLD}==================================================================${RESET}"
    echo -e "${BLUE}${BOLD}🤖 CAPA 1: ESTADO DE OPENHANDS & SANDBOXES${RESET}"
    echo -e "${BLUE}${BOLD}==================================================================${RESET}"

    local status
    status="$(probe_container "murray-openhands")"
    echo -e "Estado del contenedor 'murray-openhands': ${status}"

    if [ "$status" = "healthy" ]; then
        echo -e "\n${CYAN}Consultando endpoint local http://127.0.0.1:3000/health...${RESET}"
        local health_res
        health_res="$(curl -sf --max-time 3 http://127.0.0.1:3000/health 2>/dev/null || echo "FAIL")"
        if [ "$health_res" = "OK" ] || [[ "$health_res" == *"OK"* ]]; then
            echo -e "  ${GREEN}✓ Healthcheck API respondió: ${health_res}${RESET}"
        else
            echo -e "  ${YELLOW}⚠️ Respuesta no estándar: ${health_res}${RESET}"
        fi
    fi

    echo -e "\n${CYAN}Contenedores sandbox activos de OpenHands en Docker:${RESET}"
    local sandboxes
    sandboxes="$(docker ps --filter "name=oh-agent-server" --format "table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}" 2>/dev/null)"
    if [ -n "$sandboxes" ] && [ "$(echo "$sandboxes" | wc -l)" -gt 1 ]; then
        echo "$sandboxes"
    else
        echo -e "  ${DIM}No hay contenedores runtime sandbox en ejecución en este momento.${RESET}"
    fi

    read -p "Presiona Enter para volver..."
}

# ==============================================================================
# ACCIONES: CAPA 2 & 3 — INFRAESTRUCTURA, WORKFLOWS Y LOGS
# ==============================================================================

follow_docker_logs() {
    echo -e "\n${MAGENTA}${BOLD}==================================================================${RESET}"
    echo -e "${MAGENTA}${BOLD}📜 CAPA 2: STREAMING DE LOGS EN VIVO${RESET}"
    echo -e "${MAGENTA}${BOLD}==================================================================${RESET}"
    echo -e "Elige qué servicio deseas monitorizar:"
    echo -e "  ${CYAN}1)${RESET} Stack Completo (Todos los contenedores juntos)"
    echo -e "  ${CYAN}2)${RESET} murray-agent  ${DIM}(DeepSeek, Chat & Ops)${RESET}"
    echo -e "  ${CYAN}3)${RESET} murray-n8n    ${DIM}(Workflows & Webhooks Telegram)${RESET}"
    echo -e "  ${CYAN}4)${RESET} workspace-mcp ${DIM}(Gmail draft-only)${RESET}"
    echo -e "  ${CYAN}5)${RESET} openhands     ${DIM}(Sandbox autónomo)${RESET}"
    echo -e "  ${CYAN}6)${RESET} cloudflared   ${DIM}(Túnel Cloudflare)${RESET}"
    echo -e "  ${CYAN}7)${RESET} postgres_db   ${DIM}(Base de datos PostgreSQL)${RESET}"
    read -p "Opción [1-7]: " log_opt

    local target_svc=""
    case "$log_opt" in
        1) target_svc="" ;;
        2) target_svc="murray-agent" ;;
        3) target_svc="n8n" ;;
        4) target_svc="workspace-mcp" ;;
        5) target_svc="openhands" ;;
        6) target_svc="cloudflared" ;;
        7) target_svc="postgres_db" ;;
        *)
            echo -e "${RED}Opción inválida.${RESET}"
            read -p "Presiona Enter..."
            return
            ;;
    esac

    echo -e "\n${DIM}Iniciando tail de logs... Presiona Ctrl+C para pausar y volver al menú.${RESET}\n"
    PANEL_PHASE="logs"

    # Streaming coloreado con sed
    # shellcheck disable=SC2086
    docker compose logs -f --tail=50 $target_svc 2>/dev/null | sed \
        -e "s/INFO/${GREEN}INFO${RESET}/g" \
        -e "s/WARNING/${YELLOW}WARNING${RESET}/g" \
        -e "s/WARN/${YELLOW}WARN${RESET}/g" \
        -e "s/ERROR/${RED}ERROR${RESET}/g" \
        -e "s/200 OK/${GREEN}200 OK${RESET}/g" \
        -e "s/\" 200 /\" ${GREEN}200${RESET} /g" \
        -e "s/\" 403 /\" ${RED}403${RESET} /g" \
        -e "s/\" 405 /\" ${RED}405${RESET} /g" \
        -e "s/\" 500 /\" ${RED}500${RESET} /g" \
        -e "s/\" 502 /\" ${RED}502${RESET} /g" \
        -e "s/\" 503 /\" ${RED}503${RESET} /g" \
        || true

    PANEL_PHASE="confirm"
    echo -e "\n${YELLOW}${BOLD}Presiona Enter para regresar al menú principal...${RESET}"
    read -r _
    PANEL_PHASE="menu"
}

show_resource_budget() {
    echo -e "\n${MAGENTA}${BOLD}==================================================================${RESET}"
    echo -e "${MAGENTA}${BOLD}📊 CAPA 2: MONITOR DE RECURSOS Y PRESUPUESTO DE RAM${RESET}"
    echo -e "${MAGENTA}${BOLD}==================================================================${RESET}"
    echo -e "${DIM}Presupuesto máximo estipulado en architecture_spec.md: < ${MAX_ALLOWED_MB} MiB (4.5 GB)${RESET}\n"

    # Mostrar tabla docker stats
    docker compose stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}" 2>/dev/null

    # Cálculo acumulado
    local total_mb
    total_mb=$(docker compose stats --no-stream --format "{{.MemUsage}}" 2>/dev/null | awk '{
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

    total_mb=${total_mb:-0}
    local pct=$(( total_mb * 100 / MAX_ALLOWED_MB ))
    local filled=$(( pct * 28 / 100 ))
    [ "$filled" -gt 28 ] && filled=28
    local empty=$(( 28 - filled ))

    local bar
    bar="$(printf '█%.0s' $(seq 1 "$filled") 2>/dev/null)$(printf '░%.0s' $(seq 1 "$empty") 2>/dev/null)"

    echo -e "\n${BOLD}Consumo Total Acumulado:${RESET}"
    if [ "$total_mb" -le "$MAX_ALLOWED_MB" ]; then
        echo -e "  [${GREEN}${bar}${RESET}]  ${GREEN}${BOLD}${pct}%${RESET}  (${total_mb} MiB / ${MAX_ALLOWED_MB} MiB)  ${GREEN}✓ DENTRO DEL PRESUPUESTO${RESET}"
    else
        echo -e "  [${RED}${bar}${RESET}]  ${RED}${BOLD}${pct}%${RESET}  (${total_mb} MiB / ${MAX_ALLOWED_MB} MiB)  ${RED}⚠️ EXCEDE PRESUPUESTO${RESET}"
    fi

    echo ""
    read -p "Presiona Enter para volver..."
}

triage_auto_scanner() {
    echo -e "\n${YELLOW}${BOLD}==================================================================${RESET}"
    echo -e "${YELLOW}${BOLD}⚡ CAPA 3: TRIAGE AUTOMÁTICO DE INCIDENTES (RUNBOOK SCANNER)${RESET}"
    echo -e "${YELLOW}${BOLD}==================================================================${RESET}"
    echo -e "${DIM}Verificando síntomas de incidentes conocidos documentados en RUNBOOK.md...${RESET}\n"

    local issues_found=0

    # 1. Incidente G: 405 en n8n
    echo -ne "  [1/4] Verificando llamadas 405 / AxiosError en n8n... "
    local n8n_405
    n8n_405="$(docker compose logs --tail=100 n8n 2>&1 | grep "status code 405" | wc -l | tr -d ' ')"
    n8n_405="${n8n_405:-0}"
    if [ "$n8n_405" -gt 0 ]; then
        echo -e "${RED}⚠️ DETECTADO${RESET} (${n8n_405} apariciones de error 405 en últimos logs)"
        echo -e "        ${DIM}Causa probable: flujo publicado llamando a ruta SPA de OpenHands en vez de API.${RESET}"
        issues_found=$((issues_found + 1))
    else
        echo -e "${GREEN}✓ OK (Sin 405 recientes)${RESET}"
    fi

    # 2. Incidente D & K: OAuth en workspace-mcp
    echo -ne "  [2/4] Verificando salud y modo OAuth en workspace-mcp... "
    local mcp_health
    mcp_health="$(docker compose exec -T -w /tmp murray-agent node -e '
      fetch("http://workspace-mcp:8000/healthz")
        .then(r => r.json())
        .then(b => console.log(b.gmail_mode || "ok"))
        .catch(() => console.log("unreachable"));
    ' 2>/dev/null || echo "unreachable")"

    if [ "$mcp_health" = "live" ]; then
        echo -e "${GREEN}✓ OK (Gmail mode: live)${RESET}"
    elif [ "$mcp_health" = "unconfigured" ]; then
        echo -e "${YELLOW}⚠️ Advertencia: Gmail en modo 'unconfigured' (Falta OAuth refresh_token)${RESET}"
        issues_found=$((issues_found + 1))
    else
        echo -e "${RED}❌ Error al contactar workspace-mcp (/healthz: ${mcp_health})${RESET}"
        issues_found=$((issues_found + 1))
    fi

    # 3. Incidente L: working_dir en /tmp para evitar bug Docker Desktop
    echo -ne "  [3/4] Verificando working_dir seguro (/tmp) en contenedores bind :ro... "
    local mcp_wdir agent_wdir
    mcp_wdir="$(docker inspect -f '{{.Config.WorkingDir}}' murray-workspace-mcp 2>/dev/null || echo "")"
    agent_wdir="$(docker inspect -f '{{.Config.WorkingDir}}' murray-agent 2>/dev/null || echo "")"

    if [ "$mcp_wdir" = "/tmp" ] && [ "$agent_wdir" = "/tmp" ]; then
        echo -e "${GREEN}✓ OK (/tmp configurado)${RESET}"
    else
        echo -e "${RED}⚠️ RIESGO DETECTADO${RESET} (mcp: '$mcp_wdir', agent: '$agent_wdir')"
        echo -e "        ${DIM}working_dir sobre bind :ro puede causar salida -1 en healthcheck de Docker Desktop.${RESET}"
        issues_found=$((issues_found + 1))
    fi

    # 4. Incidente C: Sandboxes huérfanos de OpenHands
    echo -ne "  [4/4] Verificando contenedores huérfanos de OpenHands... "
    local oh_count
    oh_count="$(docker ps -a --filter "name=oh-agent-server" --format "{{.ID}}" 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$oh_count" -gt 3 ]; then
        echo -e "${YELLOW}⚠️ Advertencia: Hay ${oh_count} sandboxes registrados en Docker.${RESET}"
        echo -e "        ${DIM}Usa la opción 13 del menú para purgar contenedores temporales.${RESET}"
        issues_found=$((issues_found + 1))
    else
        echo -e "${GREEN}✓ OK (${oh_count} sandboxes)${RESET}"
    fi

    echo ""
    if [ "$issues_found" -eq 0 ]; then
        echo -e "${GREEN}${BOLD}🎉 Diagnóstico completado: No se encontraron anomalías activas.${RESET}"
    else
        echo -e "${YELLOW}${BOLD}⚠️ Se detectaron ${issues_found} posibles observaciones. Revisa RUNBOOK.md si persisten.${RESET}"
    fi

    echo ""
    read -p "Presiona Enter para volver..."
}

show_n8n_executions() {
    echo -e "\n${MAGENTA}${BOLD}==================================================================${RESET}"
    echo -e "${MAGENTA}${BOLD}🔄 CAPA 3: HISTORIAL DE EJECUCIONES DE N8N (POSTGRES)${RESET}"
    echo -e "${MAGENTA}${BOLD}==================================================================${RESET}"

    if [ "$(probe_container "murray-postgres")" != "healthy" ]; then
        echo -e "${RED}❌ 'murray-postgres' no está disponible para consultar la base de datos.${RESET}"
        read -p "Presiona Enter para volver..."
        return
    fi

    # Cargar credenciales desde .env
    local pg_user pg_db
    pg_user="$(grep -E '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2- || echo "n8n_admin")"
    pg_db="$(grep -E '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2- || echo "n8n_database")"

    echo -e "${CYAN}Consultando últimas 10 ejecuciones en PostgreSQL...${RESET}\n"
    docker compose exec -T postgres_db psql -U "$pg_user" -d "$pg_db" -c \
        "SELECT id, status, mode, \"startedAt\", \"stoppedAt\" FROM execution_entity ORDER BY id DESC LIMIT 10;" 2>/dev/null \
        || echo -e "${RED}Fallo al consultar execution_entity en Postgres.${RESET}"

    echo ""
    read -p "Presiona Enter para volver..."
}

# ==============================================================================
# ACCIONES: DESPLIEGUE, PRUEBAS Y LIMPIEZAS
# ==============================================================================

deploy_stack() {
    echo -e "\n${CYAN}${BOLD}==================================================================${RESET}"
    echo -e "${CYAN}${BOLD}🚀 DESPLEGAR / INICIAR STACK DE MURRAY${RESET}"
    echo -e "${CYAN}${BOLD}==================================================================${RESET}"

    if is_stack_healthy; then
        echo -e "  ${GREEN}${BOLD}✓ Todos los servicios ya están activos y 'healthy'.${RESET}"
        echo -e "  ${DIM}No se requieren reinicios.${RESET}\n"
        read -p "Presiona Enter para volver..."
        return
    fi

    echo -e "${YELLOW}Iniciando o sincronizando contenedores con docker compose up -d...${RESET}"
    docker compose up -d

    echo -e "\n${CYAN}Esperando a que los healthchecks alcancen estado 'healthy' (hasta 30s)...${RESET}"
    local i
    for i in {1..30}; do
        if is_stack_healthy; then
            echo -e "\n  ${GREEN}${BOLD}🎉 ¡Stack completamente operativo y saludable!${RESET}\n"
            read -p "Presiona Enter para volver..."
            return
        fi
        echo -ne "."
        sleep 1
    done

    echo -e "\n  ${YELLOW}⚠️ Algunos servicios aún se encuentran en fase de arranque o inicio.${RESET}"
    read -p "Presiona Enter para volver..."
}

stop_stack() {
    echo -e "\n${RED}${BOLD}==================================================================${RESET}"
    echo -e "${RED}${BOLD}🛑 DETENER STACK DE SERVICIOS${RESET}"
    echo -e "${RED}${BOLD}==================================================================${RESET}"
    echo -e "Elige el método de detención:"
    echo -e "  ${GREEN}1)${RESET} docker compose stop  ${DIM}(Pausa los contenedores preservando todo el estado)${RESET}"
    echo -e "  ${YELLOW}2)${RESET} docker compose down  ${DIM}(Detiene y remueve contenedores y redes temporales)${RESET}"
    echo -e "  ${DIM}0) Cancelar${RESET}"
    read -p "Opción [0-2]: " sopt

    case "$sopt" in
        1)
            echo -e "${YELLOW}Deteniendo contenedores con 'docker compose stop'...${RESET}"
            docker compose stop
            echo -e "${GREEN}✓ Servicios detenidos.${RESET}"
            ;;
        2)
            echo -e "${YELLOW}Ejecutando 'docker compose down'...${RESET}"
            docker compose down
            echo -e "${GREEN}✓ Contenedores y red removidos.${RESET}"
            ;;
        *)
            echo -e "${DIM}Operación cancelada.${RESET}"
            ;;
    esac
    read -p "Presiona Enter para volver..."
}

run_tests_menu() {
    echo -e "\n${CYAN}${BOLD}==================================================================${RESET}"
    echo -e "${CYAN}${BOLD}🧪 SUITE DE PRUEBAS DEL SISTEMA${RESET}"
    echo -e "${CYAN}${BOLD}==================================================================${RESET}"
    echo -e "  ${GREEN}1)${RESET} Ejecutar Suite Completa End-to-End ${DIM}(tests/test_e2e_stack.sh)${RESET}"
    echo -e "  ${GREEN}2)${RESET} Pruebas Unitarias Node (Mock fetch: Gmail, MCP, Agent)"
    echo -e "  ${GREEN}3)${RESET} Pruebas de Contratos HITL y Workflows n8n"
    echo -e "  ${GREEN}4)${RESET} Prueba de Presupuesto de Memoria RAM"
    echo -e "  ${DIM}0) Volver al menú principal${RESET}"
    read -p "Opción [0-4]: " topt

    case "$topt" in
        1)
            echo -e "\n${CYAN}▶ Ejecutando test_e2e_stack.sh...${RESET}\n"
            bash tests/test_e2e_stack.sh
            ;;
        2)
            echo -e "\n${CYAN}▶ Ejecutando unit tests en Node...${RESET}\n"
            node --test tests/test_gmail_client.mjs tests/test_workspace_mcp_http.mjs tests/test_murray_agent_http.mjs tests/test_workspace.mjs tests/test_coding_session.mjs tests/test_jobs.mjs
            ;;
        3)
            echo -e "\n${CYAN}▶ Verificando esquemas y contratos HITL...${RESET}\n"
            python3 tests/test_workflows_schema.py
            python3 tests/test_hitl_dispatch.py
            python3 tests/test_email_triage_draft.py
            ;;
        4)
            echo -e "\n${CYAN}▶ Evaluando consumo de memoria...${RESET}\n"
            bash tests/check_memory_budget.sh
            ;;
        *)
            return
            ;;
    esac

    echo ""
    read -p "Presiona Enter para volver..."
}

clean_menu() {
    echo -e "\n${YELLOW}${BOLD}==================================================================${RESET}"
    echo -e "${YELLOW}${BOLD}🧹 MENÚ DE LIMPIEZA GRANULAR Y REARMADO${RESET}"
    echo -e "${YELLOW}${BOLD}==================================================================${RESET}"
    echo -e "Elige qué componente deseas limpiar o rearmar:"
    echo -e "  ${GREEN}1)${RESET} 📁 Limpiar repositorios clonados en ./workspace"
    echo -e "  ${GREEN}2)${RESET} 🧠 Reiniciar memoria, sesión y tareas de Murray (memory, session, jobs)"
    echo -e "  ${GREEN}3)${RESET} 🤖 Purgar contenedores sandbox huérfanos de OpenHands"
    echo -e "  ${CYAN}4)${RESET} 🔨 Reconstruir imagen de murray-agent (build --no-cache)"
    echo -e "  ${CYAN}5)${RESET} 🔄 Recrear todo el stack completo (up -d --build --force-recreate)"
    echo -e "  ${RED}6)${RESET} ⚠️  RESET TOTAL (Detiene todo y borra volúmenes n8n, postgres, agent)"
    echo -e "  ${DIM}0) Volver al menú principal${RESET}"
    read -p "Opción [0-6]: " copt

    case "$copt" in
        1)
            echo -e "\n${YELLOW}Limpiando repositorios en ./workspace...${RESET}"
            if [ -d "workspace" ]; then
                find workspace -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} +
                echo -e "  ${GREEN}✓ Repositorios en ./workspace eliminados.${RESET}"
            fi
            ;;
        2)
            echo -e "\n${YELLOW}Reiniciando archivos de estado en murray_agent_data...${RESET}"
            if [ "$(probe_container "murray-agent")" = "healthy" ]; then
                docker compose exec -T -w /tmp murray-agent sh -c '
                  echo "{}" > /var/lib/murray-agent/memory.json
                  echo "{}" > /var/lib/murray-agent/session.json
                  echo "{}" > /var/lib/murray-agent/jobs.json
                '
                echo -e "  ${GREEN}✓ Memoria, sesión y cola de jobs reiniciadas a {}.${RESET}"
            else
                echo -e "  ${RED}murray-agent no está corriendo. Inícialo antes de limpiar.${RESET}"
            fi
            ;;
        3)
            echo -e "\n${YELLOW}Buscando y purgando sandboxes huérfanos de OpenHands...${RESET}"
            local orphans
            orphans="$(docker ps -a --filter "name=oh-agent-server" -q)"
            if [ -n "$orphans" ]; then
                # shellcheck disable=SC2086
                docker rm -f $orphans
                echo -e "  ${GREEN}✓ Sandboxes huérfanos eliminados.${RESET}"
            else
                echo -e "  ${DIM}No se encontraron sandboxes huérfanos.${RESET}"
            fi
            ;;
        4)
            echo -e "\n${CYAN}Reconstruyendo imagen murray-agent sin caché...${RESET}"
            docker compose build --no-cache murray-agent
            docker compose up -d --force-recreate murray-agent
            echo -e "  ${GREEN}✓ murray-agent actualizado y recreado.${RESET}"
            ;;
        5)
            echo -e "\n${CYAN}Reconstruyendo y recreando todo el stack...${RESET}"
            docker compose up -d --build --force-recreate
            echo -e "  ${GREEN}✓ Stack recreado completamente.${RESET}"
            ;;
        6)
            echo -e "\n${RED}${BOLD}⚠️  ALERTA CRÍTICA: RESET TOTAL DE VOLÚMENES Y DATOS${RESET}"
            echo -e "${RED}Esta acción detendrá el stack y borrará permanentemente:${RESET}"
            echo -e "  - Base de datos PostgreSQL (n8n_database)"
            echo -e "  - Configuraciones y claves de n8n (n8n_data)"
            echo -e "  - Memoria y jobs de Murray (murray_agent_data)"
            echo -e "  - Repositorios clonados en ./workspace"
            echo ""
            read -p "Para confirmar, escribe 'CONFIRMAR' exactamente: " confirm_input
            if [ "$confirm_input" = "CONFIRMAR" ]; then
                echo -e "\n${YELLOW}Deteniendo stack y destruyendo volúmenes...${RESET}"
                docker compose down -v
                find workspace -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} + 2>/dev/null || true
                echo -e "  ${GREEN}✓ Volúmenes y workspace purgados por completo.${RESET}"
                echo -e "  ${CYAN}Usa la opción 1 para desplegar un stack limpio desde cero.${RESET}"
            else
                echo -e "  ${DIM}Operación cancelada.${RESET}"
            fi
            ;;
        *)
            return
            ;;
    esac

    echo ""
    read -p "Presiona Enter para volver..."
}

# ==============================================================================
# BUCLE PRINCIPAL DEL PANEL
# ==============================================================================

main() {
    check_prerequisites || {
        echo -e "${RED}❌ Faltan requisitos críticos para ejecutar el panel.${RESET}"
        exit 1
    }

    while true; do
        PANEL_PHASE="menu"
        show_menu
        echo -ne "${BOLD}Selecciona una opción [0-13]: ${RESET}"
        read -r choice
        case "$choice" in
            1) deploy_stack ;;
            2) stop_stack ;;
            3) view_agent_memory ;;
            4) view_agent_session ;;
            5) view_agent_jobs ;;
            6) ping_murray_interactive ;;
            7) inspect_openhands ;;
            8) follow_docker_logs ;;
            9) show_resource_budget ;;
            10) triage_auto_scanner ;;
            11) show_n8n_executions ;;
            12) run_tests_menu ;;
            13) clean_menu ;;
            0) exit_panel_keep_services ;;
            *)
                echo -e "${RED}Opción no válida.${RESET}"
                sleep 1
                ;;
        esac
    done
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
