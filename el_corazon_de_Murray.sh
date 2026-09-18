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
    echo -e " ${BOLD}📋 ESPECIFICACIÓN & BLUEPRINT PARA IA:${RESET}"
    echo -e "  ${CYAN}${BOLD}14.${RESET} 🤖 ${BOLD}Exportar Especificación Completa para IA${RESET} ${DIM}(System Blueprint & Spec in English)${RESET}"
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
# ACCIONES: ESPECIFICACIÓN TÉCNICA & BLUEPRINT COMPLETO PARA IA (INGLÉS)
# ==============================================================================

generate_ai_specification() {
    cat <<'EOF'
# SYSTEM SPECIFICATION & ARCHITECTURAL BLUEPRINT: MURRAY INFRA (1-PERSON CEO)

> **AUTHORITATIVE DETERMINISTIC SPECIFICATION FOR AI CODING ASSISTANTS**
> **System Name**: Murray Infra (`murray-infra`)
> **Paradigm**: 1-Person Executive Autonomous Engine (1-Person CEO)
> **Target Audience**: Any autonomous AI/LLM agent tasked with reproducing, deploying, or auditing this system.
> **Language**: English (Deterministic Technical Contract)
> **Revision**: 1.0.0 (Living Architecture Contract)

---

## 1. System Identity, Mission & Governance Model

The **Murray Infra** system (`murray-infra`) is an autonomous executive engineering and operational stack designed for a **1-Person CEO**. It allows a single human operator to manage multiple software projects, execute infrastructure operations, monitor cloud communications, and direct autonomous coding agents through a unified, secure mobile interface: **Telegram**.

### Core Governance Principles

1. **Asymmetric Autonomy with Ironclad Guardrails**:
   - **Autonomous (No Approval Needed)**: Read-only diagnostics, git status/diff/log/pull/checkout, repository inspection, draft creation in Gmail, log streaming, resource monitoring, automated triage diagnosis.
   - **Guarded (Cryptographic Human-In-The-Loop Required)**: Git push to remote repositories, deletion of files/workspaces, stack container recreation/restart, email transmission, and starting autonomous code-editing sandbox sessions.
2. **Single Human Operator Verification**:
   - The entire system is bound to a single Telegram user: `TELEGRAM_CHAT_ID`. Any message, callback, or event originating from any other user identifier is dropped silently with zero side-effects.
3. **Draft-Only Communications**:
   - The system is physically incapable of sending emails. It can only triage incoming messages and stage drafts in Gmail. The final "Send" action is strictly reserved for the human CEO within the official Gmail interface.
4. **Hierarchical Agent Roles**:
   - **Executive Conductor (`murray-agent`)**: The conversational personality, strategic planner, stack sysadmin, and git gatekeeper. Operates with the persona of Murray (the demonic talking skull from Monkey Island 3: flamboyant, theatrical megalomania fused with ruthless senior engineering precision).
   - **Mechanical Worker (`openhands`)**: The code execution sandbox. Isolated inside a Docker runtime, executing edits, running test suites, and handling deep workspace modifications inside `./workspace/<slug>`.

---

## 2. Network Topology & Zero Trust Security Perimeter

All components communicate over an internal Docker bridge network named `agent-net`.

```mermaid
flowchart TD
    subgraph External [External Perimeter]
        TelegramAPI["Telegram API (Bot Client)"]
        CFEdge["Cloudflare Edge (Zero Trust)"]
        GoogleAPI["Google Gmail API v1"]
    end

    subgraph Host [Docker Host: agent-net]
        CFDaemon["cloudflared (Tunnel Ingress)"]
        N8N["n8n (Workflow Engine :5678)"]
        Postgres["postgres_db (:5432)"]
        MCP["workspace-mcp (:8000)"]
        MurrayAgent["murray-agent (:8080)"]
        OpenHands["openhands (:3000)"]
    end

    CFEdge <==>|Encrypted Tunnel (Outbound Only)| CFDaemon
    CFDaemon -->|HTTP: http://n8n:5678| N8N
    TelegramAPI <==>|Single Webhook via CF| N8N
    N8N <==>|TCP: postgres_db:5432| Postgres
    N8N <==>|HTTP: http://workspace-mcp:8000| MCP
    N8N <==>|HTTP: http://murray-agent:8080| MurrayAgent
    N8N <==>|HTTP: http://openhands:3000| OpenHands
    MurrayAgent -->|Docker Socket allowlist + HITL| HostSock["/var/run/docker.sock"]
    OpenHands -->|Docker Socket runtime spawn| HostSock
    MCP <==>|HTTPS OAuth 2.0 (Draft-Only)| GoogleAPI
```

### Network Contracts & Invariants

| Service | Container Name | Internal Port | Host Port Binding | Visibility & Security Notes |
| :--- | :--- | :--- | :--- | :--- |
| `cloudflared` | `murray-cloudflared` | N/A | None | Outbound tunnel to Cloudflare Edge. Zero inbound open ports on host. Upstream origin: `http://n8n:5678` (NEVER `localhost`). |
| `n8n` | `murray-n8n` | `5678/tcp` | `127.0.0.1:5678` | Bound exclusively to localhost loopback for local dev/admin UI. Public ingress routed solely via `cloudflared`. |
| `postgres_db` | `murray-postgres` | `5432/tcp` | None | Completely isolated in `agent-net`. Accessible only by `n8n`. Image `postgres:16-alpine`. NEVER expose to `0.0.0.0`. |
| `workspace-mcp`| `murray-workspace-mcp` | `8000/tcp` | None | Completely isolated in `agent-net`. Accessible only by `n8n` and `murray-agent`. `working_dir: /tmp`. |
| `murray-agent` | `murray-agent` | `8080/tcp` | None | Completely isolated in `agent-net`. `working_dir: /tmp`. Accessible by `n8n`. Mounts `/var/run/docker.sock` behind strict allowlist. |
| `openhands` | `murray-openhands` | `3000/tcp` | `127.0.0.1:3000` | Bound exclusively to localhost loopback for local inspection UI. Mounts `/var/run/docker.sock` to spawn runner sandboxes. |

- **Security Profile**: `security_opt: ["no-new-privileges:true"]` applied to runtime containers.
- **Secret Isolation**: Secrets reside strictly in `.env` and `config/mcp-auth/.gauth.json`. NEVER commit secrets to git, print in logs, or paste in chat.

---

## 3. Container Services & Docker Compose Blueprint

The stack is declaratively defined in `docker-compose.yml`.

### Exact Service Specifications

1. **`postgres_db`**:
   - Base image: `postgres:16-alpine` (Do NOT upgrade to Postgres 17 without manual `pg_dump`; major upgrade breaks volume).
   - Volume: `postgres_data:/var/lib/postgresql/data`.
   - Healthcheck: `CMD-SHELL pg_isready -U ${POSTGRES_USER:-n8n_admin} -d ${POSTGRES_DB:-n8n_database}` (interval: 10s, timeout: 5s, retries: 5).
2. **`cloudflared`**:
   - Base image: `cloudflare/cloudflared:latest`.
   - Command: `tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}`.
   - Restarts: `unless-stopped`.
3. **`n8n`**:
   - Base image: `n8nio/n8n:latest`.
   - Critical environment variables:
     - `DB_TYPE=postgresdb`, `DB_POSTGRESDB_HOST=postgres_db`, `DB_POSTGRESDB_PORT=5432`.
     - `N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}` (Critical: loss of key corrupts encrypted credentials).
     - `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (Mandatory: required in n8n 2.x for `$env.TELEGRAM_CHAT_ID` expression evaluation).
     - `TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}`.
     - `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168` (Prunes DB executions older than 7 days).
     - `WEBHOOK_URL=https://${SUBDOMINIO_PUBLICO}/`.
   - Volumes: `n8n_data:/home/node/.n8n`, `./workflows:/opt/workflows:ro`.
   - Depends on: `postgres_db` (condition: `service_healthy`).
   - Healthcheck: `CMD-SHELL wget -q -O - http://127.0.0.1:5678/healthz || exit 1`.
4. **`workspace-mcp`**:
   - Base image: `node:20-alpine`.
   - Working Directory: `/tmp` (**CRITICAL INVARIANT**: If `working_dir` is `/opt/mcp` on a read-only bind mount `:ro`, Docker Desktop on macOS fails healthcheck/exec with exit code -1).
   - Command: `["node", "/opt/mcp/server.mjs"]`.
   - Mounts: `./config/workspace-mcp:/opt/mcp:ro`, `./config/mcp-auth:/app/auth`.
   - Environment: `GMAIL_ALLOW_SENDING=false`, `GMAIL_ALLOW_DRAFTS=true`, Google OAuth keys.
   - Healthcheck: Node fetch probe to `http://127.0.0.1:8000/healthz`.
5. **`murray-agent`**:
   - Build context: `./config/murray-agent` (Dockerfile with Node 20 + Git CLI installed).
   - Working Directory: `/tmp`.
   - Command: `["node", "/opt/agent/server.mjs"]`.
   - Security Opt: `no-new-privileges:true`.
   - Mounts:
     - `./config/murray-agent:/opt/agent:ro`
     - `./docker-compose.yml:/opt/stack/docker-compose.yml:ro`
     - `./.env:/opt/stack/.env:ro`
     - `./workspace:/opt/workspace`
     - `./RUNBOOK.md:/opt/docs/RUNBOOK.md:ro`
     - `./architecture_spec.md:/opt/docs/architecture_spec.md:ro`
     - `/var/run/docker.sock:/var/run/docker.sock`
     - `murray_agent_data:/var/lib/murray-agent`
   - Healthcheck: Node fetch probe to `http://127.0.0.1:8080/healthz`.
6. **`openhands`**:
   - Base image: `ghcr.io/openhands/openhands:latest` (Registry `docker.all-hands.dev` is obsolete/NXDOMAIN).
   - Runtime image env: `SANDBOX_RUNTIME_CONTAINER_IMAGE=ghcr.io/openhands/runtime:latest`.
   - Workspace Mount: `WORKSPACE_MOUNT_PATH=./workspace` mounted at container path `/opt/workspace_base`.
   - Mounts: `/var/run/docker.sock:/var/run/docker.sock`, `~/.openhands-state:/.openhands-state`.
   - Environment: `LLM_MODEL=deepseek/deepseek-chat`, `LLM_BASE_URL=https://api.deepseek.com/v1`, `MAX_ITERATIONS=30`.

---

## 4. Google Workspace Gateway (`workspace-mcp`): Draft-Only Guardrail

The `workspace-mcp` service is a custom lightweight Node.js HTTP server implementing strict Gmail API mediation.

### Immutable Safety Guardrails
- `GMAIL_ALLOW_SENDING=false` and `GMAIL_ALLOW_DRAFTS=true` are hardcoded invariants.
- Send Blocker: Any HTTP request directed to `/gmail/send`, `/gmail/batch-send`, or `/gmail/messages/send` is intercepted and immediately rejected with HTTP `403` and JSON `{ "error": "gmail_send_blocked" }`.
- Zero Send Implementation: `gmail-client.mjs` contains no `send()` method. The code to send email literally does not exist in the codebase.
- The human CEO must open the draft in the official Gmail client and click "Send".

### HTTP REST Contracts

1. `GET /healthz`:
   - Returns HTTP 200: `{ "status": "ok", "service": "workspace-mcp", "gmail_allow_sending": false, "gmail_allow_drafts": true, "gmail_mode": "live" | "unconfigured" }`.
2. `GET /gmail/unread`:
   - Executes query `q=is:unread`, capped at 15 messages.
   - HTTP 200: `{ "status": "ok", "unread_count": N, "messages": [{ "id", "threadId", "sender", "subject", "summary", "senderHtml", "subjectHtml", "summaryHtml", "date", "inReplyTo" }] }`.
   - HTTP 503 `gmail_oauth_missing`: Missing `GOOGLE_CLIENT_ID` or `GOOGLE_REFRESH_TOKEN`.
   - HTTP 503 `gmail_oauth_client_mismatch`: Refresh token was generated by another Client ID (e.g. Desktop client instead of Web client).
   - HTTP 503 `gmail_oauth_failed`: Token refresh failed (e.g. expired 7-day token in Testing app status).
   - **Crucial Invariant**: An empty inbox (`unread_count: 0`) with `status: ok` is a legitimate response from the live Gmail API, NOT a stub.
3. `POST /gmail/drafts`:
   - Payload: `{ "messageId"?, "threadId"?, "to"?, "subject"?, "replyBody"?, "body"?, "inReplyTo"? }`.
   - Creates a draft message via Gmail API (`users.drafts.create`). Encodes RFC 2822 email in base64url.
   - HTTP 200: `{ "ok": true, "draft": true, "sent": false, "id": "<draft_id>", "messageId": "...", "threadId": "...", "status": "created" }`.

### Google Cloud OAuth Configuration Rules
- Client Type: **Web Application** (NOT Desktop App).
- Authorized Redirect URI: `https://developers.google.com/oauthplayground`.
- Scopes: `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.compose`.
- API Enabled: **Gmail API** in Google Cloud Console (NEVER search for non-existent "Gmail MCP API").

---

## 5. Executive Conductor & Safety Orchestrator (`murray-agent`)

The `murray-agent` microservice coordinates user interaction, stack observability, and git operations within `./workspace`.

### Architecture & Persona
- **LLM Provider**: DeepSeek Chat (`deepseek-chat`) via `https://api.deepseek.com/v1`.
- **System Persona**: Murray, the talking demon skull from Monkey Island 3.
  - Tone: Pomposity, theatrical megalomania, humorous contempt for mortal flaws, paired with surgical, production-grade systems engineering excellence.
  - Language: Rioplatense Spanish with sandwich structure (theatrical hook -> dense technical facts -> ominous closure).
  - Strict Rule: Murray does NOT hallucinate changes. Murray does NOT edit `murray-infra` files. Code modifications occur exclusively in `./workspace/<slug>`.

### Deterministic Interceptors (Bypassing LLM)
To guarantee determinism, low latency, and zero token waste, key intents are intercepted in code before invoking the LLM:
- **Slash Commands**: `/status`, `/health`, `/repo`, `/workspace`, `/jobs`, `/jobs <id>`, `/triage` execute local functions directly.
- **Coding Missions**: When an active repository exists and a test command is detected (`Test: ...` or `Comando: ...`), the request immediately bypasses the LLM and issues an HITL proposal with `kind=code`.
- **Confirmation Words**: `si`, `dale`, `ok` automatically confirm the previous pending plan from session memory and generate the HITL keyboard.
- **Hallucination Suppression**: If DeepSeek responds with prose instructing the user to "Touch Approve" without issuing a formal tool call, the agent suppresses the response and outputs a structured syntax recipe (`Comando: ...`).

### Human-In-The-Loop (HITL) Protocol & State Machine
- **Callback Data Limit**: Telegram limits inline keyboard `callback_data` to **64 bytes**.
- **Token Format**: 16-character hexadecimal token (`crypto.randomBytes(8).toString('hex')`).
- **Token Format Strings**:
  - `APPROVE_OPS:<hex>` / `REJECT_OPS:<hex>` (TTL: 15 min, single-use).
  - `APPROVE_CLONE:<hex>` (Enqueues git clone job).
  - `APPROVE_CODE:<hex>` (Enqueues OpenHands coding session).
  - `APPROVE_DELETE:<hex>` (Enqueues scoped path deletion).
  - `APPROVE_PUSH:<hex>` (Enqueues git push to feature branch).
  - `STUCK_RETRY:<hex>`, `STUCK_STOP:<hex>`, `STUCK_LOGS:<hex>`, `STUCK_CHG:<hex>`.

### Docker Socket Whitelist (`ops.mjs`)
`murray-agent` mounts `/var/run/docker.sock` to control the stack, but enforces strict allowlists via `assertSafeComposeArgs`:
- **Allowed**: `ps`, `logs --tail<=80`, `restart <service>`, `up -d --force-recreate --no-deps <service>`, and `heal_openhands`.
- **Forbidden**: `down -v`, `exec`, arbitrary `kill`, arbitrary `rm`.
- **`heal_openhands` Implementation**:
  1. Inspects running containers: `docker ps -a --filter "name=oh-agent-server" --format "{{.ID}}\t{{.Names}}"`.
  2. Filters strictly for names matching `^oh-agent-server-`.
  3. Executes `docker rm -f` strictly against those container IDs.
  4. Restarts OpenHands: `docker compose restart openhands`.

### Workspace Jail & Git Constraints
- **Root Directory**: `./workspace` (`/opt/workspace` in container).
- **Symlink Jail Check**: Evaluates canonical realpaths (`fs.realpathSync`) to prevent path traversal and avoid macOS `/var` vs `/private/var` symlink bugs.
- **Autonomous Git (No HITL Required)**: `status`, `diff`, `log`, `commit`, `pull`, `checkout`.
- **Guarded Git (HITL Required)**:
  - `clone`: Shallow clone (`--depth 1 --single-branch`). Unshallows automatically on subsequent branch fetches. Token passed via HTTP auth header, NEVER exposed in URLs or logs.
  - `push`: Requires explicit HITL approval. **PUSH TO `main` OR `master` IS FORBIDDEN**. Force push (`--force`) is FORBIDDEN.
  - `delete`: Requires explicit HITL approval. Scope strictly confined to `./workspace`.

### Async Job Queue (`jobs.json`)
- Persistent asynchronous state machine:
  - States: `queued` -> `running` -> `done` | `failed` | `stuck` | `paused`.
  - Mutex Kick Guarantee: `jobs.mjs` prevents concurrent execution kicks on the same job promise, preventing duplicate sandbox spawns.
  - Timestamp Invariant: Job age and duration are computed strictly from `createdAt` (America/Montevideo timezone).

---

## 6. Autonomous Code Execution Sandbox (`openhands`)

OpenHands runs as an isolated mechanical worker container to modify code in `./workspace/<slug>`.

### OpenHands 1.11+ API Contracts
- **Health**: `GET /health` returns HTTP 200 `"OK"` (Do NOT query `/api/health` - returns the SPA HTML document).
- **Create Conversation (Start Task)**: `POST /api/v1/app-conversations` with `{ "task": "<mission_text>" }` (Do NOT query `POST /api/conversations` - returns HTTP 405 Method Not Allowed).
- **Send Follow-up Message**: `POST /api/v1/app-conversations/{id}/send-message`.
- **Search Events**: `GET /api/v1/conversation/{id}/events/search`.

### Child Sandbox Management & OOM Exit 137 Prevention
- OpenHands spins up ephemeral Docker containers named `oh-agent-server-<uuid>` using the image `ghcr.io/openhands/runtime:latest`.
- **Double Start Issue**: Triggering concurrent task creation creates duplicate `oh-agent-server` containers, rapidly exhausting host memory and triggering Docker OOM (Exit 137). The single-kick promise mutex in `murray-agent` eliminates this.
- **Zombie Cleanup**: `el_corazon_de_Murray.sh` Option 3/13 and `/triage` `heal_openhands` safely terminate orphaned `oh-agent-server-*` containers without touching core infrastructure.

### Execution State Machine Handling
- `PAUSED` with dirty working tree -> Job marked as `paused`. Notifies CEO to review git diff and commit.
- `PAUSED` with clean working tree -> Job marked as `stuck` (`sandbox_paused`). Sends HITL keyboard (Retry/Stop/Change).
- `finished` with 0 git changes and clean tree -> Job marked as `stuck` (`empty_finish`). Prevents falsely reporting completion when the agent did not touch code.
- Poll Errors: 3 consecutive network poll failures trigger `stuck` (`poll_error`).

---

## 7. Telegram HITL Router & n8n Workflows

n8n serves as the external event router and periodic cron manager.

### The Single Webhook Rule
Telegram bots can register exactly ONE webhook URL.
- **Canonical Webhook URL**: `https://ceo.threepwood.uy/webhook/4dae132d-912c-40e0-b048-c00b42e03250/webhook`.
- **Trigger Invariant**: The trigger node must explicitly specify `webhookId: "4dae132d-912c-40e0-b048-c00b42e03250"`. Pointing the webhook to the node name causes HTTP 404/500 errors in n8n 2.x.

### Telegram HTML Parse Mode Invariant
- **CRITICAL**: Every Telegram send or edit node in n8n MUST have `additionalFields.parse_mode = "HTML"`.
- Reason: The default n8n Markdown parser treats underscores (`_`) as formatting delimiters. Callback data like `APPROVE_OPS:1a2b` or `REJECT_TASK` fails with Telegram HTTP 400 (`Bad Request: can't parse entities`).

### Workflow 1: Telegram HITL Router (`workflows/telegram_hitl_router.json`)
- **Published ID**: `20uYWal9fr2bWwVV`.
- **Routing Logic**:
  1. Ingress Webhook validates sender ID == `TELEGRAM_CHAT_ID`. Drops invalid users.
  2. Freeform text messages -> `POST http://murray-agent:8080/chat`.
  3. `/oh ...` or `sandbox: ...` -> OpenHands raw keyboard dispatch.
  4. Callback `APPROVE_OPS` -> `POST http://murray-agent:8080/ops/execute`.
  5. Callback `REJECT_OPS` -> `POST http://murray-agent:8080/ops/reject`.
  6. Callbacks `_CLONE:`, `_CODE:`, `_DELETE:`, `_PUSH:`, `STUCK_` -> `POST http://murray-agent:8080/workspace/hitl`.
  7. Keyboard Construction: Reads `hitl.approve_data` and `hitl.reject_data` directly from agent responses.

### Workflow 2: Email Triage Draft (`workflows/email_triage_draft.json`)
- **Published ID**: `Z8f9K2mP1qRt5vWx`.
- **Trigger**: Cron Schedule (every 15 minutes).
- **Execution Flow**:
  1. Calls `GET http://workspace-mcp:8000/gmail/unread`.
  2. If `unread_count > 0`, splits messages.
  3. Deduplicates message IDs using workflow static data:
     ```javascript
     const staticData = $getWorkflowStaticData('global');
     staticData.processedIds = staticData.processedIds || [];
     const newMessages = items.filter(i => !staticData.processedIds.includes(i.json.id));
     ```
  4. Calls `POST http://workspace-mcp:8000/gmail/drafts` to generate drafts.
  5. Sends HTML alert to the CEO on Telegram.
  6. **Invariant**: Contains NO Telegram trigger to prevent webhook hijacking.

---

## 8. Resource Quotas & Operational Limits

- **RAM Budget Ceiling**: Total cumulative RAM across all 6 core containers MUST remain **< 4.5 GB (4608 MiB)**.
- **Normal Idle Footprint**: ~1140 MiB - 1230 MiB.
- **Memory Measurement Invariant**:
  - `docker compose stats --no-stream` outputs memory in format: `12.5MiB / 3.8GiB`.
  - When parsing with scripts, parse ONLY the first token (actual usage). Parsing `GiB` globally mistakenly parses the host limit (3.8GiB), inflating the reported usage to tens of gigabytes.
- **Database Housekeeping**:
  - n8n execution data is pruned automatically: `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=168` (hours).

---

## 9. Incident Triage Matrix & Lessons Learned

| Incident | Root Cause | Diagnostic Signature | Permanent Architectural Fix |
| :--- | :--- | :--- | :--- |
| **A: Webhook Dead** | Cloudflare tunnel dropped or misconfigured. | `cloudflared` logs show connection errors. | Ensure tunnel token matches Cloudflare Zero Trust; upstream target is `http://n8n:5678`. |
| **B: Credential Decrypt Fail** | `N8N_ENCRYPTION_KEY` changed or missing. | n8n logs show encryption failure. | Restore original key in `.env`. |
| **C: OpenHands Runaway RAM** | Orphaned `oh-agent-server-*` containers. | High RAM in `docker stats`. | Run `el_corazon` Option 13 or `/triage` `heal_openhands`. |
| **D: Gmail OAuth Mismatch** | Refresh token from Desktop client vs Web client ID. | HTTP 503 `gmail_oauth_client_mismatch`. | Re-authorize in Google OAuth Playground using Web Client ID and immediate offline exchange. |
| **E: Tunnel Connect Fail** | Tunnel using placeholder token from `.env.example`. | `cloudflared` logs `Failed to get tunnel`. | Set real token in `.env` and recreate container. |
| **G: 405 on HITL Button** | Workflow calling OpenHands SPA route `/api/conversations`. | `AxiosError 405` in n8n logs. | Use API route: `POST /api/v1/app-conversations`. |
| **H: Postgres 17 Warning** | n8n warning about Postgres major version. | Log warning `Upgrade to Postgres 17`. | Invariant: Stay on `postgres:16-alpine`. Do NOT destroy volume. |
| **I: Bot Silent (No Reply)** | Telegram webhook pointing to node name. | HTTP 404 / 500 on webhook. | Register webhook using canonical `webhookId`: `4dae132d-912c-40e0-b048-c00b42e03250`. |
| **J: Reject Button 400** | Telegram node using default Markdown parser. | Telegram API error `can't parse entities`. | Enforce `additionalFields.parse_mode = "HTML"`. |
| **K: Fake 0 Unread Mails** | Historical stub returning 0 unread on missing OAuth. | `status: awaiting_oauth` in stub. | Real API returns 503 on missing OAuth; 0 unread with `status: ok` is real empty inbox. |
| **L: MCP Unhealthy** | Container `working_dir` set to `:ro` bind mount. | `docker inspect` shows exit=-1 on healthcheck. | Set `working_dir: /tmp` in `docker-compose.yml`. |
| **M: Workflow Import Fail** | Root workflow JSON missing `"id"` attribute. | Postgres error: `null value in column "id"`. | Ensure `"id"` is hardcoded at workflow root. |
| **N: Bot Sends HITL on Chat**| Router routing all text to OpenHands keyboard. | Keyboard on greeting messages. | Free text routes to `murray-agent /chat`. |
| **O: Murray 403 on Ops** | Ops executed without valid single-use token. | HTTP 403 `ops_approval_denied`. | Require valid 16-hex approval token issued within 15 min. |
| **P: Clone/Code No Action** | Router missing `/workspace/hitl` dispatch node. | Button acknowledged but no job queued. | Route `_CLONE:`, `_CODE:`, etc. to `/workspace/hitl`. |
| **R: Prosa "Tocá Aprobar"** | LLM emitted prose instead of structured tool. | Text received without inline buttons. | Interceptor recipes; enforce test command syntax. |
| **S: PAUSED Falsely Done** | Polling treated PAUSED state as completed mission. | Premature notification with incomplete code. | PAUSED checks git tree; flags stuck or requests commit. |
| **T: Sandbox OOM 137** | Duplicate job kicks spawned multiple sandboxes. | Exit code 137 in Docker logs. | Single-kick mutex in `jobs.mjs`. |

---

## 10. Step-by-Step Deterministic Recreation Recipe

Any AI assistant can recreate this exact system by executing this sequential runbook:

### Step 1: Directory Scaffolding
Create the directory structure:
```bash
mkdir -p config/murray-agent config/workspace-mcp config/mcp-auth config/cloudflared workflows workspace tests
```

### Step 2: Environment Configuration (`.env.example`)
Create `.env.example` with:
- `POSTGRES_USER=n8n_admin`
- `POSTGRES_PASSWORD=cambiar_password_seguro`
- `POSTGRES_DB=n8n_database`
- `N8N_ENCRYPTION_KEY=<random_32_hex>`
- `SUBDOMINIO_PUBLICO=ceo.threepwood.uy`
- `CLOUDFLARE_TUNNEL_TOKEN=<token>`
- `TELEGRAM_BOT_TOKEN=<token>`
- `TELEGRAM_CHAT_ID=<numeric_id>`
- `GOOGLE_CLIENT_ID=<client_id>`
- `GOOGLE_CLIENT_SECRET=<client_secret>`
- `GOOGLE_REFRESH_TOKEN=<refresh_token>`
- `DEEPSEEK_API_KEY=<deepseek_key>`

### Step 3: Implement Google Workspace MCP (`config/workspace-mcp/`)
1. Create `gmail-client.mjs`: Implements OAuth token refresh and Gmail API calls (`messages.list`, `messages.get`, `drafts.create`). Ensure NO `send()` method exists.
2. Create `server.mjs`: Exposes `GET /healthz`, `GET /gmail/unread`, `POST /gmail/drafts`. Block `/gmail/send` with HTTP 403. Set process working directory to `/tmp`.

### Step 4: Implement Murray Agent (`config/murray-agent/`)
1. Create `Dockerfile`: Based on `node:20-alpine`, installs `git`, `docker-cli`, `python3`.
2. Create `persona.md`: System prompt defining Murray (Monkey Island talking skull persona, senior sysadmin rigor, rioplatense Spanish).
3. Create `ops.mjs`: Docker Compose wrapper with strict allowlist (`ps`, `logs`, `restart`, `recreate`, `heal_openhands`).
4. Create `openhands.mjs`: REST client for OpenHands 1.11 API (`/health`, `/api/v1/app-conversations`, `/events/search`).
5. Create `workspace.mjs`: Git execution wrapper inside `./workspace/<slug>`. Enforce realpath jail. Block push to `main`/`master`.
6. Create `jobs.mjs`: Asynchronous job store (`jobs.json`) with single-kick execution mutex.
7. Create `chat.mjs`: Conversation engine integrating DeepSeek LLM, memory store (20 turns), and deterministic slash command interceptors (`/status`, `/jobs`, `/triage`).
8. Create `server.mjs`: HTTP router exposing `/healthz`, `/chat`, `/ops/execute`, `/ops/reject`, `/workspace/hitl`.

### Step 5: Declare Docker Compose (`docker-compose.yml`)
Write the Docker Compose file matching Section 3:
- Network: `agent-net` (bridge).
- Services: `postgres_db`, `cloudflared`, `n8n`, `workspace-mcp`, `murray-agent`, `openhands`.
- Enforce `working_dir: /tmp` for `workspace-mcp` and `murray-agent`.
- Mount `/var/run/docker.sock` to `murray-agent` and `openhands`.
- Mount `./workspace` to `murray-agent` (`/opt/workspace`) and `openhands` (`/opt/workspace_base`).

### Step 6: Define and Import n8n Workflows (`workflows/`)
1. Create `workflows/telegram_hitl_router.json` with ID `20uYWal9fr2bWwVV`, canonical webhook ID `4dae132d-912c-40e0-b048-c00b42e03250`, and `parse_mode: "HTML"` on all Telegram nodes.
2. Create `workflows/email_triage_draft.json` with ID `Z8f9K2mP1qRt5vWx`, 15-minute cron schedule, and static data deduplication.
3. Import into n8n via CLI:
   ```bash
   docker compose exec n8n n8n import:workflow --input=/opt/workflows/telegram_hitl_router.json --projectId=<project_id>
   docker compose exec n8n n8n publish:workflow --id=20uYWal9fr2bWwVV
   ```

### Step 7: Build Observability & Control Panel (`el_corazon_de_Murray.sh`)
Implement the single-file bash dashboard with:
- Healthcheck probes for all 6 containers.
- Layer 1 Agent Observability (`memory.json`, `session.json`, `jobs.json`).
- Layer 2 Infrastructure Observability (colored live log streaming, RAM monitor).
- Layer 3 Workflow Observability (Postgres execution history, RUNBOOK incident auto-scanner).
- Option 14: Deterministic AI blueprint export (`generate_ai_specification`).

### Step 8: Verification & Automated Testing
Execute validation suites:
- `bash tests/test_e2e_stack.sh`: Verifies Postgres, schema constraints, guardrails, and circuit breakers.
- `bash tests/check_memory_budget.sh`: Verifies total RAM footprint is strictly under 4.5 GB.
- `node --test tests/*.mjs`: Unit tests with mocked providers (no live API calls in CI).

---
*End of Authoritative Technical Blueprint — Murray Infra (1-Person CEO)*
EOF
}

export_ai_specification() {
    echo -e "\n${CYAN}${BOLD}==================================================================${RESET}"
    echo -e "${CYAN}${BOLD}📋 ESPECIFICACIÓN TÉCNICA Y BLUEPRINT PARA IA (INGLÉS)${RESET}"
    echo -e "${CYAN}${BOLD}==================================================================${RESET}"
    echo -e "Esta opción contiene todos los datos, contratos e invariantes"
    echo -e "para que otra IA recree este stack de forma 100% determinista.\n"
    echo -e "Elige cómo deseas exportar la especificación:"
    echo -e "  ${GREEN}1)${RESET} Ver en pantalla interactiva (usando el paginador del sistema)"
    echo -e "  ${GREEN}2)${RESET} Guardar en archivo local: ${BOLD}MURRAY_SYSTEM_BLUEPRINT_FOR_AI.md${RESET}"
    if command -v pbcopy &>/dev/null; then
        echo -e "  ${GREEN}3)${RESET} Copiar directamente al portapapeles de macOS ${DIM}(pbcopy)${RESET}"
    else
        echo -e "  ${DIM}3) Copiar al portapapeles (no disponible en este sistema)${RESET}"
    fi
    echo -e "  ${GREEN}4)${RESET} Imprimir completa en terminal (volcado directo)"
    echo -e "  ${DIM}0) Volver al menú principal${RESET}"
    read -p "Opción [0-4]: " spec_opt

    case "$spec_opt" in
        1)
            if command -v less &>/dev/null; then
                generate_ai_specification | less -R
            else
                generate_ai_specification
            fi
            ;;
        2)
            local out_file="MURRAY_SYSTEM_BLUEPRINT_FOR_AI.md"
            generate_ai_specification > "$out_file"
            echo -e "\n  ${GREEN}✓ Especificación exportada exitosamente a:${RESET} ${BOLD}${out_file}${RESET} ($(wc -l < "$out_file" | tr -d ' ') líneas)"
            ;;
        3)
            if command -v pbcopy &>/dev/null; then
                generate_ai_specification | pbcopy
                echo -e "\n  ${GREEN}✓ ¡Especificación completa copiada al portapapeles!${RESET} Lista para pegar en otra IA."
            else
                echo -e "\n  ${YELLOW}⚠️ 'pbcopy' no está disponible en este entorno.${RESET}"
            fi
            ;;
        4)
            generate_ai_specification
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
    # Manejo de flags directos por CLI (scriptable / pipes)
    if [ "$#" -gt 0 ]; then
        case "$1" in
            --export-spec|--spec|--ai-spec|--ai-blueprint|14|spec)
                generate_ai_specification
                exit 0
                ;;
            --help|-h)
                echo "Uso: $0 [OPCIÓN]"
                echo "Panel de control y observabilidad de Murray Infra."
                echo ""
                echo "Opciones CLI:"
                echo "  --export-spec, --spec, --ai-spec    Vuelca la especificación técnica completa en inglés a stdout"
                echo "  --help, -h                          Muestra esta ayuda"
                echo ""
                echo "Sin argumentos: Inicia el panel interactivo en consola."
                exit 0
                ;;
        esac
    fi

    check_prerequisites || {
        echo -e "${RED}❌ Faltan requisitos críticos para ejecutar el panel.${RESET}"
        exit 1
    }

    while true; do
        PANEL_PHASE="menu"
        show_menu
        echo -ne "${BOLD}Selecciona una opción [0-14]: ${RESET}"
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
            14) export_ai_specification ;;
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
