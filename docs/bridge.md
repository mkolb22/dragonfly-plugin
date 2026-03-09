# Bridge Module

**Module:** `bridge`
**Tools:** 4
**Feature flag:** `DRAGONFLY_BRIDGE_ENABLED` (default: enabled)
**Storage:** `~/.dragonfly/global-memory/` (YAML files, configurable)
**Local storage:** `memory.db` (read for export; write on `commit: true` import)

---

## Overview

The Bridge module enables cross-project knowledge federation. It maintains a global YAML store of memories that persists independently of any individual project's `memory.db`. A developer can export learnings from Project A, start Project B, and immediately search or import relevant patterns from the global store — without manual copying or re-discovery.

Bridge addresses a fundamental gap in the Memory module: Memory is scoped to a single project. Bridge is the federated layer across all projects.

**Key architectural fact:** Bridge is unidirectional by default. Export pushes local → global. Import is preview-only unless `commit: true` is specified. The `commit` parameter closes the loop and makes Bridge truly bidirectional.

---

## Quick Reference

| Tool | Description | Key Parameters |
|---|---|---|
| `dragonfly_bridge_export` | Export local memories to global YAML store | `project_name`, `min_confidence` |
| `dragonfly_bridge_import` | Search global memories; optionally commit to local memory.db | `query`, `project`, `commit`, `limit` |
| `dragonfly_bridge_search` | Keyword search across all global memories | `query`, `project`, `limit` |
| `dragonfly_bridge_list` | Browse global store by category | `project` |

---

## Tools

### `dragonfly_bridge_export`

Export local memories from the project's `memory.db` to the global YAML store. Deduplicates by memory ID — re-exporting the same memory is a no-op. Use `min_confidence` to export only well-established, generalizable patterns and exclude low-confidence noise.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `project_name` | string | Yes | — | Project label for grouping (e.g., "my-app", "api-service") |
| `min_confidence` | string | No | `"low"` | Minimum confidence to export: `"low"` (all) \| `"medium"` \| `"high"` |

**Returns:**
```
{
  message: string,
  exported: number,   // new memories written to global store
  skipped: number,    // memories already in global store (deduped by ID)
  categories: string[]
}
```

**Global store structure:**
```
~/.dragonfly/global-memory/
├── architecture/
│   └── my-app.yaml       # All architecture memories from "my-app"
├── patterns/
│   └── my-app.yaml
├── conventions/
│   └── my-app.yaml
└── ... (any category from memory.db)
```

**Confidence mapping from memory.db:**
- `confidence >= 0.7` → "high"
- `confidence >= 0.4` → "medium"
- `confidence < 0.4` → "low"

Using `min_confidence: "high"` exports only memories with `confidence >= 0.7` — the well-established patterns worth sharing universally.

---

### `dragonfly_bridge_import`

Import memories from the global store into the current project. By default (preview mode), returns a summary of matching memories without writing anything. Set `commit: true` to write matched memories directly to the local `memory.db`.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | No | none | Keyword filter — include only memories containing this text |
| `project` | string | No | none | Import only from this project's memories |
| `commit` | boolean | No | `false` | Write matched memories to local `memory.db` |
| `limit` | number | No | `5` | Max memories to include per category |

**Returns (preview mode, `commit: false`):**
```
{
  found: number,
  categories: string[],
  preview: [{
    category: string,
    content: string,
    confidence: string
  }],
  message: "Found N memories. Set commit:true to write to local memory.db."
}
```

**Returns (commit mode, `commit: true`):**
```
{
  found: number,
  categories: string[],
  preview: [...],
  committed: number,   // memories written to local memory.db
  message: "Committed N memories to local memory.db"
}
```

**Confidence conversion when committing:**
- `"high"` → `0.85` in memory.db
- `"medium"` → `0.60` in memory.db
- `"low"` → `0.30` in memory.db

Committed memories have `source: "bridge:{original_source}"` to preserve provenance.

---

### `dragonfly_bridge_search`

Keyword search across all global memories, matching content and tags. Results are ranked by match quality (content match before tag match) then by confidence (high before medium before low).

**Note:** Search is substring-based (not semantic similarity). Use `semantic_search` from the Semantic module for meaning-based retrieval within the current project.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | Yes | — | Search term (case-insensitive substring match) |
| `project` | string | No | none | Filter to a specific project's memories |
| `limit` | number | No | `20` | Maximum results to return |

**Returns:**
```
{
  query: string,
  total: number,    // total matches before limit
  results: [{
    category: string,
    match_type: "content" | "tag",
    confidence: "high" | "medium" | "low",
    content: string,
    tags: string[],
    project: string
  }]
}
```

---

### `dragonfly_bridge_list`

Browse the global store by category, optionally filtered to a specific project.

**Parameters:**
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `project` | string | No | none | Filter to a specific project's memories |

**Returns:**
```
{
  total: number,
  category_count: number,
  categories: [{
    category: string,
    count: number,
    preview: string[]   // first 3 memory content snippets, truncated to 70 chars
  }]
}
```

---

## Usage Pattern

### New Project Bootstrap

```
# In old project:
dragonfly_bridge_export { project_name: "old-project", min_confidence: "medium" }

# In new project:
dragonfly_bridge_search { query: "authentication" }
dragonfly_bridge_import { query: "authentication", commit: true }

# Global memories are now in local memory.db — available via memory_recall
memory_recall { query: "authentication patterns" }
```

### Knowledge Curation

```
# Export only high-confidence patterns (avoid exporting noise):
dragonfly_bridge_export { project_name: "api-service", min_confidence: "high" }

# Browse what's accumulated:
dragonfly_bridge_list {}

# Find patterns from a specific past project:
dragonfly_bridge_search { query: "database", project: "old-service" }
```

---

## Research Basis

| Work | Authors | Year | Relevance |
|---|---|---|---|
| **Organizational Memory** | Walsh & Ungson, Academy of Management Review | 1991 | Explicit vs. tacit knowledge separation: Bridge should carry semantic (generalizable) knowledge, not episodic (project-specific event) memories |
| **Knowledge Management Systems** | Alavi & Leidner, MIS Quarterly | 2001 | Cross-boundary knowledge transfer is the primary driver of organizational learning — Bridge's core purpose |
| **Episodic vs. Semantic Memory** | Tulving | 1972 | Taxonomy: episodic (project-specific events) vs. semantic (generalizable facts) — the `min_confidence` filter is a proxy for promoting episodic to semantic |
| **Architecture Decision Records (ADRs)** | Nygard | 2011, thinkrelevance.com | ADRs capture significant design decisions in a portable format — Bridge exports are effectively portable ADRs shared across projects |
| **Inner Source** | Innersource Commons | 2016+ | Organizations sharing code patterns across internal projects — Bridge enables inner-source knowledge sharing for AI-assisted development |

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `DRAGONFLY_BRIDGE_ENABLED` | `true` | Enable/disable the Bridge module |
| `DRAGONFLY_BRIDGE_GLOBAL_MEMORY_PATH` | `~/.dragonfly/global-memory` | Global YAML store root directory |

---

## Integration

- **Memory module**: Bridge reads from local `memory.db` (export) and writes to it (import with `commit: true`). The `MemoryStore.insertMemory()` API is used directly for committed imports.
- **Semantic module**: Bridge uses keyword search only. For semantic (embedding-based) search within the current project, use `semantic_search` from the Semantic module. A hybrid approach — `bridge_search` to discover cross-project patterns, then `semantic_search` within the current project — covers both retrieval modes.
- **Analytics module**: `dragonfly_bridge_export` does not write provenance events. Cross-project usage is not tracked in the events table.

---

## Design Limitations

| Limitation | Severity | Notes |
|---|---|---|
| No semantic search | Medium | Bridge uses substring matching; not embedding-based. Planned: integrate Semantic module's cosine similarity search. |
| First-write-wins deduplication | Medium | Re-exporting an updated memory does not update the global store if the ID already exists. |
| O(n) search | Medium | Full YAML scan per query — scales to ~10K memories before noticeable latency. |
| No versioning | Low | Cannot track knowledge evolution across exports. |
