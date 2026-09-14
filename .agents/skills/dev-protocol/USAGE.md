# CÓMO USAR `dev-protocol` (instalación y portabilidad)

Guía de uso de la skill: cómo encajan los archivos entre sí, cómo instalarla en Claude Code, y cómo portarla a otros IDEs/IAs (Cursor, Gemini, OpenCode, etc.) que **no** tienen el mecanismo de skills.

> ⚠️ **Distinción clave**: el **auto-trigger** y la **disclosure progresiva** (cargar un módulo solo cuando hace falta) son **nativos de Claude Code**. En las demás herramientas no existen "skills": tienen un archivo de **reglas/contexto** que vos apuntás a estos mismos `.md`. El contenido del protocolo es portable; el mecanismo de carga, no.

---

## 1. Cómo encajan las piezas (entre ellas)

```
dev-protocol/
├─ SKILL.md          ← ENTRADA. Router liviano. Se lee SIEMPRE primero.
│                      (rol, estilo, §3 entorno, §0 flujo idea→entrega, higiene, bootstrap)
├─ code-design.md    ← módulos profundos + TDD     ┐
├─ debugging.md      ← loop de 6 fases             │ se leen SOLO cuando
├─ qa-review.md      ← review de dos ejes + issues │ la tarea lo pide
├─ git-workflow.md   ← commits, pre-commit, entrega│ (referenciados desde
├─ documentation.md  ← doc-sync manifest/spec      │  SKILL.md por ruta relativa)
│                                                  ┘
├─ templates/        ← copy-to-root: .pre-commit-config.yaml, .env.example
└─ USAGE.md          ← este archivo
```

- **`SKILL.md` es el único archivo "siempre cargado".** Es un índice/router: no duplica el contenido de los módulos, los referencia. Eso es lo que ahorra tokens.
- **Los módulos son auto-contenidos** y se cruzan entre sí con rutas relativas (`./debugging.md`, etc.). No usan rutas absolutas → la carpeta funciona en cualquier repo.
- **Archivos de referencia en la raíz del repo** (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) son punteros **versionados** y finos a esta skill. Sobreviven a `git clone` y garantizan que cada agente aplique el protocolo apuntando a `.agents/skills/dev-protocol/SKILL.md` (única fuente de verdad). No duplican su contenido.

---

## 2. Claude Code (nativo — auto-trigger + disclosure progresiva)

### Cómo se invoca
- **Auto (description)**: el frontmatter dispara la skill cuando la tarea es del stack (Python/`uv` + LLM). Requiere que Claude Code la descubra → necesita el symlink en `.claude/skills/` (ver install).
- **Explícito**: `/dev-protocol` (también requiere el symlink).
- **Garantía sin symlink**: `CLAUDE.md` (versionado, siempre cargado) referencia `SKILL.md`, así el protocolo se aplica aunque el symlink no exista todavía en ese clon.
- **Frase canónica**: `Usando dev-protocol, <qué hacer / mejorar / arreglar>`.

### Instalar — opción A: per-repo (convención de este repo)
En este repo `.agents/` **está versionado** (no en `.gitignore`), así que el contenido de la skill viaja con `git clone`. Lo que **no** viaja es el symlink de descubrimiento de Claude Code, porque `.claude/skills/` está gitignored. Por eso el único paso de install por clon es recrear ese symlink:
```bash
# desde la raíz del repo, una vez por clon
mkdir -p .claude/skills
ln -sfn ../../.agents/skills/dev-protocol .claude/skills/dev-protocol
```
> El protocolo igual se aplica sin ese paso vía `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` (versionados). El symlink solo habilita el auto-trigger nativo y el slash command `/dev-protocol`.
>
> Para llevar la skill a **otro** repo desde cero: `cp -R /ruta/a/dev-protocol .agents/skills/dev-protocol` y luego el `ln -s` de arriba.

### Instalar — opción B: global (disponible en TODOS tus proyectos)
```bash
cp -R /ruta/a/dev-protocol ~/.claude/skills/dev-protocol
```

---

## 3. Otros IDEs / IAs (sin mecanismo de skills)

> **En este repo ya está hecho** para los agentes más comunes: `AGENTS.md` (Codex/OpenCode/Cursor) y `GEMINI.md` en la raíz ya apuntan a `.agents/skills/dev-protocol/SKILL.md`. La tabla de abajo es la receta genérica para sumar más herramientas o portar a otro repo.

La estrategia es siempre la misma en dos pasos:
1. **Tené la carpeta** `dev-protocol/` en el repo. En este repo vive versionada en `.agents/skills/dev-protocol/`; en otro podés ponerla donde quieras (p. ej. `docs/dev-protocol/` o `.ai/dev-protocol/`).
2. **Apuntá el archivo de reglas/contexto de la herramienta** a esa `SKILL.md` (y aclarale que lea los módulos bajo demanda).

| Herramienta | Archivo de reglas/contexto | Qué poner adentro |
| :--- | :--- | :--- |
| **Cursor** | `.cursor/rules/dev-protocol.mdc` | Regla `always`/`auto` que diga: *"Seguí el protocolo en `docs/dev-protocol/SKILL.md`; leé sus módulos referenciados solo cuando la tarea lo requiera."* |
| **Gemini CLI** | `GEMINI.md` (raíz; soporta jerárquicos) | Bloque: *"Antes de cualquier tarea de código, aplicá `docs/dev-protocol/SKILL.md`. Los módulos (`debugging.md`, etc.) se leen bajo demanda."* |
| **OpenCode** | `AGENTS.md` (o `instructions` en `opencode.json`) | Igual que Gemini: referenciá `SKILL.md` + nota de carga bajo demanda. |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Referenciá `SKILL.md`; Copilot lo inyecta como contexto en chat/edits. |
| **Windsurf** | `.windsurfrules` (o `.windsurf/rules/`) | Referenciá `SKILL.md` + módulos bajo demanda. |
| **Genérico / multi-tool** | `AGENTS.md` (estándar [agents.md](https://agents.md)) | Un solo `AGENTS.md` que muchos agentes leen (Codex, OpenCode, etc.). |

### Plantilla de regla (pegá esto en el archivo de la herramienta)
```markdown
# Protocolo de desarrollo
Para CUALQUIER tarea de implementación, bug, review o entrega en este repo,
seguí el protocolo en `docs/dev-protocol/SKILL.md`.
- Leé `SKILL.md` primero (rol, estilo, entorno, flujo idea→entrega con approval gate).
- Leé los módulos SOLO cuando la tarea lo pida:
  diseño/TDD → code-design.md · bug → debugging.md · review → qa-review.md ·
  git/entrega → git-workflow.md · docs → documentation.md.
- Regla dura: dependencias Python con `uv` (nunca `pip` ni venv manual).
- No hagas push/merge sin OK explícito del usuario (approval gate de git-workflow.md §3).
```

> **Nota de fidelidad**: como estas herramientas no tienen disclosure progresiva, el agente puede cargar todos los módulos que referencies de una. Si te importa el ahorro de tokens ahí, referenciá en el archivo de reglas **solo** `SKILL.md` y dejá que el agente abra los módulos cuando los necesite.

---

## 4. Una sola fuente de verdad

Mantené **una** copia de `dev-protocol/` por repo y que todos los archivos de reglas (`.cursor/rules`, `GEMINI.md`, `AGENTS.md`, etc.) **la referencien** en vez de copiar el contenido. Así actualizás el protocolo en un solo lugar y todas las herramientas lo ven.

> Los nombres de archivo de reglas de cada herramienta evolucionan rápido — si alguno no funciona, verificá la doc oficial vigente de esa herramienta. El patrón ("apuntá su archivo de contexto a `SKILL.md`") se mantiene.

---

## 5. Higiene de skills en este repo (ahorro de tokens)

Este proyecto usa **una skill versionada** (`dev-protocol`) más **una opcional local** (`grilling`, stress-test de planes). El resto del pack Matt Pocock / skills genéricas (**tdd**, **review**, **diagnosing-bugs**, **setup-pre-commit**, etc.) fue **archivado** en `.agents/skills/_archive/` porque duplican módulos de `dev-protocol` o no aplican al stack (`uv` + `pre-commit` Python, no Husky).

### Qué symlinkear en `.claude/skills/` (por clon)

Solo dos enlaces — **no** re-symlinkear el pack completo ni skills globales de `~/.agents/skills/`:

```bash
./scripts/setup-skills.sh
# equivalente manual:
# mkdir -p .claude/skills
# ln -sfn ../../.agents/skills/dev-protocol .claude/skills/dev-protocol
# ln -sfn ../../.agents/skills/grilling .claude/skills/grilling
```

### Cursor / skills globales

Si Cursor indexa `~/.agents/skills/` entero (~1500 entradas), el catálogo `available_skills` consume muchos tokens **antes** de leer código. Mitigación recomendada:

- Mantener skills **a nivel repo** (este script) y **no** exponer el directorio global completo en la configuración del IDE, o
- Reducir el set global a skills que uses en todos los proyectos (p. ej. solo `dev-protocol`).

### Mapeo: skill archivada → usar en su lugar

| Archivada | Usar |
| :--- | :--- |
| diagnosing-bugs | `dev-protocol/debugging.md` |
| tdd | `dev-protocol/code-design.md` |
| review | `dev-protocol/qa-review.md` |
| setup-pre-commit | `dev-protocol/git-workflow.md` + `.pre-commit-config.yaml` del repo |
| domain-modeling | `UBIQUITOUS_LANGUAGE.md` (raíz del repo) |
| qa, request-refactor-plan, … | `roadmap/*.md` Agent Prompts + dev-protocol |
