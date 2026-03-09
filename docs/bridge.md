# Bridge Module

**Module:** `bridge`
**Tools:** 4 (`dragonfly_bridge_export`, `dragonfly_bridge_import`, `dragonfly_bridge_search`, `dragonfly_bridge_list`)
**Feature flag:** `DRAGONFLY_BRIDGE_ENABLED` (default: enabled)
**Storage:** Reads from `memoryDbPath`; writes to `DRAGONFLY_BRIDGE_GLOBAL_MEMORY_PATH` (default: `~/.dragonfly/global-memory/`)
**Always enabled:** No — opt-in via feature flag

---

## Quick Reference

| Tool | Description | Required Params |
|---|---|---|
| `dragonfly_bridge_export` | Export local memories to the global YAML store | `project_name` |
| `dragonfly_bridge_import` | Import global memories into the current project | None |
| `dragonfly_bridge_search` | Keyword search across all global memories | `query` |
| `dragonfly_bridge_list` | Browse the global store by category | None |

---

## Overview

The Bridge module enables cross-project knowledge federation. It provides the mechanism for memories stored in one project's local `memory.db` to be exported to a shared global store, discovered by other projects, and imported into a new project's memory system.

Without the Bridge module, Dragonfly knowledge is project-local. An architectural decision made in Project A, or a debugging pattern discovered in Project B, is invisible to Project C. The Bridge module makes this tacit knowledge explicit and portable.

### Global Store Format

```
~/.dragonfly/global-memory/
├── architecture/
│   ├── my-api.yaml          # All architecture memories exported from project "my-api"
│   └── auth-service.yaml    # All architecture memories from project "auth-service"
├── patterns/
│   └── my-api.yaml
├── decisions/
│   └── my-api.yaml
└── ... (any category from local memory.db)
```

Each YAML file contains all memories of that category from a single project. The directory structure uses category as the first level and project name as the file. Deduplication is by memory ID: if a memory with the same ID already exists in the global store, the first-write-wins and subsequent exports skip it.

### Directionality

Bridge is **unidirectional by default**:
- `dragonfly_bridge_export`: local → global (always writes)
- `dragonfly_bridge_import`: global → local (preview only by default)
- `dragonfly_bridge_search`: global read-only
- `dragonfly_bridge_list`: global read-only

The `commit: true` parameter on `dragonfly_bridge_import` enables bidirectional flow: it writes selected global memories into the local `memory.db`, completing the loop. Without `commit: true`, import is informational — it shows what is available without changing local state.

---

## Tools

### `dragonfly_bridge_export`

Export local memories to the global YAML store. Reads from the current project's `memory.db`, filters by minimum confidence, deduplicates against existing global entries, and writes to category-organized YAML files.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `project_name` | string | Yes | — | Label for this project in the global store (e.g., `"auth-service"`, `"payment-api"`) |
| `min_confidence` | string | No | `"low"` | Minimum confidence level to export: `"low"` (all), `"medium"` (≥0.5), `"high"` (≥0.8) |

**Deduplication:** If a memory ID already exists in the global store under any project file, it is skipped. First-write-wins ensures that the canonical version of a memory is the one that was exported first, not overwritten by subsequent exports.

**Returns:**

```json
{
  "exported": 23,
  "skipped_duplicates": 4,
  "skipped_low_confidence": 7,
  "categories": ["architecture", "patterns", "decisions", "debugging"],
  "files_written": [
    "~/.dragonfly/global-memory/architecture/auth-service.yaml",
    "~/.dragonfly/global-memory/patterns/auth-service.yaml"
  ]
}
```

---

### `dragonfly_bridge_import`

Import global memories into the current project. Without `commit: true`, returns a preview of available memories matching the filters. With `commit: true`, writes the matching memories into the local `memory.db`.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | No | none | Keyword filter — only import memories whose content or tags contain this string |
| `project` | string | No | all | Filter to memories exported from a specific source project |
| `commit` | boolean | No | `false` | If `true`, write matching memories to local `memory.db`. Default is preview-only |
| `limit` | number | No | `5` | Maximum memories to import per category |

**Returns (preview mode, `commit: false`):**

```json
{
  "found": 12,
  "categories": ["architecture", "patterns"],
  "preview": [
    {
      "category": "architecture",
      "content": "JWT tokens use RS256 signing with key rotation every 90 days.",
      "confidence": "high",
      "source_project": "auth-service",
      "tags": ["jwt", "security", "authentication"]
    }
  ],
  "committed": false
}
```

**Returns (commit mode, `commit: true`):**

```json
{
  "found": 12,
  "committed_count": 10,
  "categories": ["architecture", "patterns"],
  "committed": true
}
```

---

### `dragonfly_bridge_search`

Keyword search across all memories in the global store. Search is substring-based (not semantic embedding search). Results are ranked: content matches appear before tag-only matches, then by confidence level.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | Yes | — | Search string for substring matching |
| `project` | string | No | all | Filter to a specific source project |
| `limit` | number | No | `20` | Maximum results |

**Ranking:** Content matches before tag matches. Within each match type, ranked by confidence: `high` > `medium` > `low`.

**Returns:**

```json
{
  "results": [
    {
      "category": "architecture",
      "match_type": "content",
      "confidence": "high",
      "content": "JWT tokens use RS256 signing. The public key is distributed via /.well-known/jwks.json.",
      "tags": ["jwt", "rs256", "authentication"],
      "source_project": "auth-service"
    },
    {
      "category": "patterns",
      "match_type": "tag",
      "confidence": "medium",
      "content": "Token refresh uses a sliding window: each use extends expiry by 24h.",
      "tags": ["jwt", "token-refresh"],
      "source_project": "payment-api"
    }
  ],
  "total": 2,
  "query": "jwt"
}
```

---

### `dragonfly_bridge_list`

Browse the global memory store by category. Returns category counts and a 3-entry preview per category for each project.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `project` | string | No | all | Filter to a specific source project |

**Returns:**

```json
{
  "total_count": 147,
  "category_count": 6,
  "categories": [
    {
      "name": "architecture",
      "count": 42,
      "preview": [
        { "content": "The service uses hexagonal architecture...", "source_project": "my-api" },
        { "content": "Database connections are pooled with a max of 20...", "source_project": "auth-service" },
        { "content": "All external API calls go through the adapter layer...", "source_project": "my-api" }
      ]
    },
    {
      "name": "patterns",
      "count": 38,
      "preview": [...]
    }
  ]
}
```

---

## Academic Foundation

### Organizational Memory — Tacit and Explicit Knowledge

Walsh, J. P. & Ungson, G. R. (1991). *Organizational memory.* Academy of Management Review, 16(1), 57–91. DOI: 10.5465/amr.1991.4278992

Walsh and Ungson distinguish explicit organizational memory (documented knowledge) from tacit memory (knowledge embedded in people and practices). The Bridge module targets the conversion of tacit AI-assistant knowledge — memories accumulated by the Dragonfly agent during project work — into explicit, transferable knowledge in the global store. The `min_confidence` filter implements a quality gate: only memories above the threshold are shared, preventing low-quality tacit knowledge from polluting the organizational memory.

### Knowledge Management Systems — Cross-Boundary Transfer

Alavi, M. & Leidner, D. E. (2001). *Review: Knowledge management and knowledge management systems: Conceptual foundations and research issues.* MIS Quarterly, 25(1), 107–136. DOI: 10.2307/3250961

Alavi and Leidner identify cross-boundary knowledge transfer as the primary driver of organizational learning: knowledge created in one unit must flow to other units where it can be applied. Their framework identifies three barriers: awareness (does the recipient know the knowledge exists?), motivation (does the recipient want to use it?), and absorption (can the recipient integrate it?). The Bridge module addresses all three: `dragonfly_bridge_list` and `dragonfly_bridge_search` create awareness; `dragonfly_bridge_import` with preview mode reduces motivation barriers by showing value before commitment; `commit: true` handles absorption by writing directly into the local memory system.

### Episodic vs. Semantic Memory — What to Export

Tulving, E. (1972). *Episodic and semantic memory.* In E. Tulving & W. Donaldson (Eds.), *Organization of Memory.* Academic Press.

Tulving's distinction is directly applicable to Bridge export policy. **Episodic memories** (specific events: "the deployment on 2025-11-12 failed because of X") are project-specific and time-bound — they do not generalize and should not be exported. **Semantic memories** (general knowledge: "this kind of deployment failure is caused by X") do generalize and are the primary export candidates. **Procedural memories** (how-to knowledge: "to diagnose this, do Y") are the most valuable exports. The `type` filter in `memory_recall` enables selective export by type, and the recommended practice is to export `semantic` and `procedural` memories, not `episodic` ones.

### Architecture Decision Records

Nygard, M. T. (2011). *Documenting architecture decisions.* thinkrelevance.com/blog/2011/11/15/documenting-architecture-decisions.html

Architecture Decision Records (ADRs) are short documents capturing significant architectural decisions: the context, the decision, and the consequences. Bridge exports of memories with category `architecture` and `decisions` are portable ADRs: structured records of what was decided in one project that can inform decisions in other projects. The Bridge module makes ADRs automatically available across projects without requiring a separate documentation workflow — they emerge naturally from the memory system.

### Inner Source Patterns

InnerSource Commons. (2022). *InnerSource patterns.* innersourcecommons.org/learn/patterns/

Inner source is the practice of applying open source development practices within an organization — sharing code, documentation, and knowledge across team boundaries. The Bridge module implements inner source principles for AI-assisted development: memories exported to the global store are available to any Dragonfly project, enabling teams to benefit from each other's accumulated knowledge without formal documentation processes. The global store is the inner source repository for AI agent knowledge.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DRAGONFLY_BRIDGE_ENABLED` | `true` | Enable or disable the Bridge module |
| `DRAGONFLY_BRIDGE_GLOBAL_MEMORY_PATH` | `~/.dragonfly/global-memory` | Path to the global YAML memory store |

---

## Integration with Other Modules

**Memory module:** Bridge reads directly from the Memory module's `memories` table in `memoryDbPath`. The `min_confidence` filter maps to the Memory module's confidence field. `dragonfly_bridge_import` with `commit: true` writes into the same `memories` table — imported global memories become first-class local memories indistinguishable from locally stored ones.

**Framework module (auto-export):** When `dragonfly_advance_workflow` detects workflow completion, it automatically calls `BridgeStore.exportMemories()` for the current project and includes a `bridge_export` field in its response:
```json
{
  "bridge_export": {
    "exported": 12,
    "project": "my-api",
    "categories": ["architecture", "decisions", "patterns"]
  }
}
```
This means every completed workflow pushes the project's accumulated knowledge to the global store without requiring an explicit `dragonfly_bridge_export` call.

**Analytics module:** Bridge export/import operations are recorded in the provenance `events` table, enabling the Analytics module to track cross-project knowledge flow over time.

**Spec module:** Specifications exported via `dragonfly_spec_export` are a complementary knowledge-sharing mechanism. For structured system definitions, `dragonfly_spec_export` is more appropriate than Bridge. For ad-hoc knowledge (debugging discoveries, architectural principles), Bridge is the right channel.

**Evolve module:** High-quality evolved prompts (`evolve_best` with `save_as_skill: true`) can be stored as procedural memories and then exported via Bridge, making prompt optimization results available across projects.

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/bridge/export.ts` | Local memory → global YAML export with deduplication |
| `src/tools/bridge/import.ts` | Global YAML → local memory import with preview/commit modes |
| `src/tools/bridge/search.ts` | Keyword search across global YAML files |
| `src/tools/bridge/list.ts` | Category browser for global store |
| `src/tools/bridge/index.ts` | MCP tool registration |
