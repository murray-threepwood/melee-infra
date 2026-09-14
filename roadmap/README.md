# Roadmap Maestro: Sistema de Automatización Ejecutiva ("1-Person CEO")

Este repositorio contiene la especificación de infraestructura, servicios y flujos de automatización para desplegar un entorno de "1-Person CEO" seguro, autónomo y con control humano (*Human-In-The-Loop* - HITL).

La documentación dentro de esta carpeta (`roadmap/`) está diseñada específicamente para que **agentes de IA autónomos** (como Gemini CLI, Claude Code, Cursor Composer u OpenHands) puedan implementar, validar y desplegar el sistema completo de forma determinista, paso a paso, sin ambigüedades.

---

## 1. Arquitectura del Sistema

```mermaid
flowchart TD
    subgraph Exterior [Internet / Canales Externos]
        CEO[Telegram: Administrador CEO]
        GmailExt[Google Workspace / Gmail API]
        CFTunnelEdge[Cloudflare Edge]
    end

    subgraph Host [Host Docker: murray-infra]
        subgraph Net [Red Interna: agent-net]
            CFDaemon["cloudflared (Túnel Zero Trust)"]
            N8N["n8n (Orquestador de Automatizaciones)"]
            Postgres[("postgres_db (PostgreSQL 16)")]
            MCP["workspace-mcp (Google Workspace MCP)"]
            OH["openhands (Sandbox de Ejecución IA)"]
        end

        subgraph Storage [Volúmenes Persistentes Host]
            VolPG["./postgres_data"]
            VolN8N["./config/n8n"]
            VolMCP["./config/mcp-auth"]
            VolWork["./workspace (Sandbox seguro)"]
        end
    end

    CFTunnelEdge <==>|Túnel cifrado sin puertos abiertos| CFDaemon
    CFDaemon -->|Reenvío HTTP interno| N8N
    CEO <==>|Comandos y Botones HITL| N8N
    N8N <==>|Persistencia de estado y ejecuciones| Postgres
    N8N <==>|Disparo de tareas pesadas| OH
    N8N <==>|Triage y Creación de Borradores| MCP
    MCP <==>|OAuth 2.0 con Guardrail (Draft Only)| GmailExt
    OH -.->|Acceso restringido a código| VolWork

    classDef secure fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef warning fill:#fff3e0,stroke:#f57c00,stroke-width:2px;
    classDef storage fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px;
    class MCP,N8N,OH secure;
    class VolWork,VolMCP,VolPG,VolN8N storage;
```

---

## 2. Estructura y Mapa de Dependencias de Fases

Cada fase depende estrictamente de que la anterior haya cumplido al 100% su *Definition of Done* (DoD).

| Archivo | Fase | Descripción Clave | Artefactos Principales |
| :--- | :--- | :--- | :--- |
| [00_AGENT_PROTOCOL.md](./00_AGENT_PROTOCOL.md) | **Protocolo** | Reglas de ejecución determinista, gestión de secretos, protocolo de fallas y estado. | `PROGRESS.md`, `BLOCKER.md` |
| [01_ENVIRONMENT_AND_NETWORKING.md](./01_ENVIRONMENT_AND_NETWORKING.md) | **Fase 1** | Inicialización de carpetas, `.env.example`, Postgres 16 y Cloudflared base. | `.env.example`, `docker-compose.yml`, `tests/test_postgres.sh` |
| [02_N8N_AND_TELEGRAM_HITL.md](./02_N8N_AND_TELEGRAM_HITL.md) | **Fase 2** | n8n conectado a Postgres, Bot de Telegram con filtrado estricto por `CHAT_ID` e Inline Keyboard. | `workflows/telegram_hitl_router.json`, servicio n8n |
| [03_GOOGLE_WORKSPACE_MCP_GUARDRAILS.md](./03_GOOGLE_WORKSPACE_MCP_GUARDRAILS.md) | **Fase 3** | Servidor MCP Google Workspace con guardrail *Draft-Only* y flujo de triage de correos. | `workspace-mcp`, `tests/test_mcp_draft_only.py`, `workflows/email_triage_draft.json` |
| [04_OPENHANDS_RUNTIME_SANDBOX.md](./04_OPENHANDS_RUNTIME_SANDBOX.md) | **Fase 4** | OpenHands sandbox acotado a `./workspace`, socket Docker, DeepSeek LLM y detección de loops. | `openhands`, `tests/test_openhands_api.sh` |
| [05_INTEGRATION_AND_E2E_VERIFICATION.md](./05_INTEGRATION_AND_E2E_VERIFICATION.md) | **Fase 5** | Verificación integral del stack, límite de RAM (<4.5GB), smoke tests y runbook de fallas. | `tests/test_e2e_stack.sh`, `RUNBOOK.md` |

---

## 3. Instrucción Maestra para el Agente (Prompt de Arranque)

Copia y pega este prompt exacto en el asistente de IA (Cursor, Claude Code, Gemini o similar) para iniciar la implementación:

```text
Sos un agente autónomo de ingeniería de software y DevOps trabajando en el proyecto murray-infra.

Tu objetivo es implementar toda la infraestructura, configuraciones, flujos n8n y scripts de test definidos en la carpeta "roadmap/".

Seguí este protocolo obligatorio:
1. Leé primero "roadmap/00_AGENT_PROTOCOL.md" y creá el archivo de seguimiento "PROGRESS.md" si aún no existe.
2. Ejecutá en orden estricto las fases:
   - roadmap/01_ENVIRONMENT_AND_NETWORKING.md
   - roadmap/02_N8N_AND_TELEGRAM_HITL.md
   - roadmap/03_GOOGLE_WORKSPACE_MCP_GUARDRAILS.md
   - roadmap/04_OPENHANDS_RUNTIME_SANDBOX.md
   - roadmap/05_INTEGRATION_AND_E2E_VERIFICATION.md
3. Procesá UNA SOLA TAREA a la vez. Al finalizar cada tarea:
   - Corré el comando de verificación especificado.
   - Si la verificación pasa (DoD cumplido), marcá la tarea como completada en PROGRESS.md y avanzá a la siguiente.
   - Si la verificación falla, intentá corregir hasta 2 veces. Si continúa fallando, generá BLOCKER.md y detené la ejecución según el protocolo.
4. NUNCA escribas secretos reales en repositorios o logs. Usá siempre .env y respetá los nombres de variables declarados.
```
