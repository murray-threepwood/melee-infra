# DOCUMENTATION SYNCHRONIZATION WORKFLOW

Update documentation **only when the change actually affects that asset**. Do not touch every file on every micro-fix — that wastes tokens and creates noise.

These documents are the recovery core of the codebase. Keep them accurate; do not keep them busy.

| File | Update when… | Do **not** update when… |
| :--- | :--- | :--- |
| **`manifest.json`** | Version bumps, or `state_schema` / `constraints` change (new config field, default, range, or vector dim). | Pure refactors, bug fixes that leave the config contract unchanged. |
| **`CHANGELOG.md`** | Releases or **notable** capability changes (new provider, new surface, security posture change). Append a short section. | Every PR, typo fix, or internal cleanup. |
| **`architecture_spec.md`** | Contracts change: API shapes, provider interface, data schemas, security/scalability policies, prompt/templating contracts, token/latency expectations. | Implementation details that stay within an existing contract. |
| **`README.md`** | How to install, configure, or run the system changes (tooling, scripts, prerequisites). | Internal code changes that do not affect first-time setup. |
| **`CONTEXT.md`** | Domain language changes (new term, renamed concept, retired alias). | Code-only changes that use existing terms. |
| **`current-research/`** | Accidental or planned **empirical discoveries** (measurements, geometry studies, “why does knob X feel dead on model Y?”) that outgrow a one-line lesson. | Routine bug fixes; put the distilled invariant in `lessons-learned.md` and link here for the evidence dump. |
| **`lessons-learned.md`** | A durable engineering **invariant** agents must not re-break. Keep it short; point to `current-research/` for long evidence. | Dumping full measurement tables or open science threads into the skill. |

### Manifest shape (slim)

`manifest.json` holds **current state only**:

- `project`, `version`
- `state_schema` (live config contract)
- `constraints` (e.g. `vector_dim`)

It is **not** a historical feature-flag ledger. Capability history lives in `CHANGELOG.md`.

### Agent handoff bundle

`./run_pack.sh` generates `context.txt` (gitignored) for external LLMs/agents. After meaningful doc or runtime changes, regenerate it when you need a fresh handoff — it is not a committed asset and does not need doc-sync on every change.

---

## CONTEXT & BLUEPRINT WORKFLOW

By default, the codebase domain context is managed in a glossary format to ensure clean domain definitions. However, a specialized blueprint mode exists for tracking codebase layout.

### 1. CONTEXT.md (Standard Run - Default)
Behaves strictly as a **Domain Model Glossary & Ubiquitous Language** reference, devoid of code or implementation details.

- **Structure**: Define terms precisely under subheadings. Keep definitions tight (1-2 sentences max defining what a concept *is*, not what it *does*).
- **Aliases**: Be opinionated. If multiple words exist for the same concept, pick the canonical term and list the others under an `_Avoid_` section.
- **Relationships**: Show bold term names and express cardinality/relationships between concepts.
- **Context Mapping**: For repositories with multiple subdomains or modules, a `CONTEXT-MAP.md` at the root must map out each context (e.g. `[Ordering](./src/ordering/CONTEXT.md)`) and their relationships.
- **Update Frequency**: Update terms inline as decisions are made; do not batch glossary updates. Skip entirely if no domain terms changed.

### 2. CONTEXT.blueprint.md (Bootstrap Run)
The **Bootstrap Run** is a specialized mode containing a comprehensive codebase re-generation blueprint.

- **Activation**: Activated in one of two ways:
  1. Setting `"bootstrap_run": true` in `manifest.json`.
  2. Explicit declaration by the user in the prompt.
- **Output File**: Write/update the blueprint in a separate file: **`CONTEXT.blueprint.md`**.
- **Content Requirements**:
  - File-by-file inventory and mapping.
  - Complete structural dependencies between modules.
  - Technical debt analysis and context anchors.
  - Absolute context density to enable repository regeneration from zero.
