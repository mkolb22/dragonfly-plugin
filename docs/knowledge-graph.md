# Knowledge Graph Module

**Module:** `knowledge`
**Tools:** 7
**Feature flag:** `DRAGONFLY_KG_ENABLED` (default: `true`)
**Storage:** `data/memory.db` (shared with Memory module)
**Always enabled:** No — opt-in via feature flag or always-on default

---

## Overview

The Knowledge Graph (KG) module builds a structural entity-relation graph over your codebase and supports hybrid search combining four signals: semantic similarity, keyword matching, graph proximity, and community clustering. It is the only module that answers multi-hop structural queries — questions that require traversing relationships between code entities rather than just finding similar text.

**Research basis:** The module's architecture is informed by three bodies of research:

- **AST-derived KG RAG (2026):** Deterministic AST-based graph construction achieves 95.6% accuracy on code retrieval vs 68.9% for vector-only and 84.4% for LLM/pattern-based extraction. See `docs/research/kg-rag-research.md`.
- **HippoRAG (NeurIPS 2024):** Graph traversal for multi-hop recall outperforms iterative LLM retrieval by 10–30x cost at +20% recall.
- **Blended RAG (2024):** Hybrid keyword+semantic search consistently outperforms single-method retrieval by 15–30%.

---

## Prerequisites

Before using most KG tools, the following must be run in order:

```
1. index_project          — Build AST index (AST module)
2. kg_ingest_ast          — Bridge AST into KG (this module)
3. kg_community detect    — Optional: build community clusters
```

`kg_query` and `kg_traverse` require a populated KG. `kg_entity`, `kg_relate`, and `kg_ingest` can be used at any time.

---

## Tools

### `kg_ingest_ast` — Primary Code Ingestion

**The most important tool in this module.** Bridges the AST index into the KG with deterministic accuracy.

**When to use:** After running `index_project`. Must be run before `kg_query` or `kg_traverse` will return useful results for code.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `scope` | string | No | Path prefix to limit ingestion (e.g. `src/tools/auth`) |

**What it creates:**

| Entity type | Source | Example |
|---|---|---|
| `file` | Every indexed source file | `src/tools/auth/index.ts` |
| `module` | Derived from directory paths | `auth`, `database` |
| `function` | AST function declarations | `validateToken` |
| `method` | Class methods | `AuthService.login` |
| `type` | Classes, interfaces, type aliases | `UserPayload` |
| `variable` | Top-level constants | `MAX_RETRIES` |
| `interface` | TypeScript/Go interfaces | `IAuthProvider` |

**Relations created:**

| Relation | Example |
|---|---|
| `symbol → defined_in → file` | `validateToken → defined_in → src/auth/index.ts` |
| `file → contains → symbol` | `src/auth/index.ts → contains → validateToken` |
| `parent → contains → method` | `AuthService → contains → AuthService.login` |
| `module → contains → file` | `auth → contains → src/auth/index.ts` |
| `caller → calls → callee` | `handleRequest → calls → validateToken` |

**Why not `kg_ingest` for code?** Pattern-based extraction (used by `kg_ingest`) has a ~30% entity miss rate on code files and produces hallucinated relations. `kg_ingest_ast` is deterministic, complete, 71x faster, and 8.8x cheaper. See `docs/research/kg-rag-research.md`.

**Example:**
```
Run kg_ingest_ast with scope="src/tools/auth"
→ filesProcessed: 4, symbolsIngested: 23, callRelationsIngested: 41
→ "Run kg_community with action='detect' for community analysis"
```

**After ingestion:** Run `kg_community` with `action="detect"` if you need community-based architectural queries. Community detection is decoupled from ingestion to keep indexing fast.

---

### `kg_query` — Hybrid Search

Search the knowledge graph using a combined signal approach. The default `hybrid` mode fuses four signals for best results.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | Yes | — | Natural language or symbol name query |
| `limit` | number | No | 20 | Max results |
| `entity_type` | enum | No | — | Filter by entity type |
| `mode` | enum | No | `hybrid` | `semantic`, `keyword`, or `hybrid` |

**Search modes:**

| Mode | When to use | Signals |
|---|---|---|
| `hybrid` | Default — best for most queries | semantic + keyword + graph + community |
| `keyword` | Exact symbol name lookup | keyword only |
| `semantic` | Intent-based queries ("error handlers") | semantic only |

**Signal weights (code-optimized defaults):**

| Signal | Weight | Env override | Rationale |
|---|---|---|---|
| Semantic | 0.35 | `DRAGONFLY_KG_SEMANTIC_WEIGHT` | Intent matching; slightly reduced vs NL because code relies more on exact names |
| Keyword | 0.35 | `DRAGONFLY_KG_KEYWORD_WEIGHT` | Exact symbol names; equally important for code queries |
| Graph | 0.25 | `DRAGONFLY_KG_GRAPH_WEIGHT` | Structural proximity; the key differentiator for code per research |
| Community | 0.05 | `DRAGONFLY_KG_COMMUNITY_WEIGHT` | Cluster membership; low weight — validated for NL, unvalidated for code |

**Response includes per-result score breakdown:**
```json
{
  "id": "ent-abc123",
  "name": "validateToken",
  "type": "function",
  "description": "function in src/auth/index.ts:42",
  "finalScore": 0.87,
  "scores": {
    "semantic": 0.92,
    "keyword": 0.85,
    "graph": 0.70,
    "community": 0.40
  }
}
```

**Example queries:**

```
kg_query "authentication middleware"          → finds auth-related functions by intent
kg_query "validateToken" mode=keyword         → exact symbol lookup
kg_query "error handling" entity_type=function → semantic search filtered by type
```

**How hybrid search works internally:**

1. Semantic search: embed query → cosine similarity over entity embeddings (fetch limit×2)
2. Keyword search: FTS5 BM25 → fallback to LIKE matching (fetch limit×2)
3. Merge results by entity ID
4. Graph proximity: BFS from top 8 semantic results with decay factor `1/(depth+1)`
5. Community boost: entities in same community as other results get a small boost
6. Normalize each signal independently (divide by max)
7. Fuse with weights → sort by final score → return top `limit`

---

### `kg_traverse` — Multi-Hop Graph Traversal

Follow relations between entities across multiple hops. The primary tool for structural questions: *"What calls this? What does it depend on? What implements this interface?"*

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `entity_id` | string | One of | — | Start entity by ID |
| `name` | string | One of | — | Start entity by name |
| `depth` | number | No | 2 | Traversal depth (max 5) |
| `limit` | number | No | 20 | Max nodes returned (max 50) |
| `relation_types` | string | No | all | Comma-separated relation types to follow |

**Relation types available for filtering:**
`calls`, `imports`, `implements`, `contains`, `depends_on`, `related_to`, `defined_in`, `tested_by`, `guards`, `stores_in`, `configures`

**Examples:**

```
kg_traverse name="AuthService"                          → everything AuthService touches (depth 2)
kg_traverse name="IAuthProvider" relation_types="implements"  → all implementations
kg_traverse name="handleRequest" relation_types="calls" depth=3  → full call chain
kg_traverse name="src/auth/index.ts" relation_types="contains"  → all symbols in file
```

**Multi-hop example (depth=2, calls only):**
```
handleRequest
  → calls → validateToken          (depth 1)
    → calls → JWTService.verify    (depth 2)
    → calls → TokenCache.get       (depth 2)
  → calls → rateLimit              (depth 1)
    → calls → RedisClient.incr     (depth 2)
```

**Response:**
```json
{
  "nodeCount": 6,
  "nodes": [
    {
      "id": "ent-xxx",
      "name": "validateToken",
      "type": "function",
      "depth": 1,
      "relations": [
        { "targetId": "ent-yyy", "type": "calls", "weight": 1.0 }
      ]
    }
  ]
}
```

**Use `kg_traverse` when:**
- You need to trace a call chain
- You need to find all implementations of an interface
- You need to see all symbols in a file or module
- You need to understand what a function depends on transitively

---

### `kg_entity` — Create or Get Entity

Idempotent upsert of a single entity. If an entity with the same name and type already exists, it is returned. If not, it is created and embedded.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Entity name |
| `entity_type` | enum | Yes | One of 14 entity types |
| `description` | string | No | Human-readable description |
| `properties` | string | No | JSON object of additional metadata |

**Entity types:**
`function`, `method`, `type`, `package`, `file`, `concept`, `pattern`, `tool`, `module`, `store`, `table`, `config`, `variable`, `interface`

**When to use:** Manually adding concepts, patterns, or architectural notes that aren't in the AST (e.g., architectural decisions, design patterns, external service references).

```
kg_entity name="Repository Pattern" entity_type="pattern" description="Data access abstraction"
kg_entity name="PostgreSQL" entity_type="store" description="Primary database"
kg_entity name="AuthN" entity_type="concept" description="Authentication subsystem"
```

---

### `kg_relate` — Create Relation

Create a typed, weighted relation between two entities. Both entities must already exist.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `source` | string | Yes | — | Source entity name or ID (prefix `ent-`) |
| `target` | string | Yes | — | Target entity name or ID |
| `relation_type` | enum | Yes | — | Relation type |
| `weight` | number | No | 1.0 | Relation strength 0–1 |

**Relation types:**
`calls`, `imports`, `implements`, `contains`, `depends_on`, `related_to`, `defined_in`, `tested_by`, `guards`, `stores_in`, `configures`

**Examples:**
```
kg_relate source="UserService" target="PostgreSQL" relation_type="stores_in"
kg_relate source="authMiddleware" target="AuthService" relation_type="guards"
kg_relate source="UserRepository" target="Repository Pattern" relation_type="implements"
```

Duplicate relations are silently ignored.

---

### `kg_ingest` — Natural Language Ingestion

**For natural language documents only.** Extracts entities and relations from text using pattern matching (regex-based). Do not use on source code files — use `kg_ingest_ast` instead.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `text` | string | Yes | NL text (README, design doc, architecture notes, comments) |
| `source` | string | No | Memory ID to link extracted entities to |

**What it extracts:**

*Entities (pattern-based):*
- PascalCase terms → concepts or types
- `function X`, `def X`, `func X` → functions
- `class X`, `interface X` → types
- `package X`, `module X` → packages
- `"X pattern"`, `"X architecture"` → patterns

*Relations (pattern-based):*
- `import { X } from 'Y'` → imports
- `X.Y()` call patterns → calls
- `class X extends Y` / `implements Y` → implements
- `X depends on Y`, `X uses Y` → depends_on

**Use for:**
- README content describing the architecture
- Architecture decision records (ADRs)
- Design documents and specifications
- Code comments extracted as text blocks
- External service or dependency descriptions

**Do not use for raw source code files.** The AST module provides deterministic, complete extraction from code. Pattern matching on code has a ~30% miss rate.

---

### `kg_community` — Community Detection and Query

Build and query community clusters — groups of entities that are structurally interconnected. Communities represent logical subsystems or bounded contexts in your codebase.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | enum | Yes | `detect`, `list`, or `get` |
| `community_id` | string | For `get` | Community to retrieve |
| `include_relation_types` | string | No | Whitelist: comma-separated relation types to build graph from |
| `exclude_relation_types` | string | No | Blacklist: types to exclude (default: see below) |

**Actions:**

**`detect`** — Run community detection algorithm and persist results.

Community detection uses connected components (BFS) over the entity-relation graph. By default excludes relations that create artificial super-clusters:

| Excluded by default | Reason |
|---|---|
| `configures` | Config entities connect to everything — would collapse all entities into one community |
| `depends_on` | Transitive dependencies connect too broadly |
| `guards` | Cross-cutting middleware patterns |
| `contains` | Hierarchical — would group everything in the same file |
| `defined_in` | Same: hierarchical, too broad |

Override with `include_relation_types` to use only specific relations:
```
kg_community action="detect" include_relation_types="calls,implements"
```

**`list`** — Return all detected communities with names and member counts.

**`get`** — Return a specific community with full member entity details.

**When to run `detect`:**
- After `kg_ingest_ast` completes
- After manually adding entities/relations that change subsystem boundaries
- Not needed for every session — communities are persisted in the database

**Community naming:** Each community is named after its highest-degree entity (the most-connected node), which is typically the central coordinator of that subsystem.

**Example use cases:**
```
kg_community action="detect"                              → build clusters
kg_community action="list"                                → see subsystem overview
kg_community action="get" community_id="comm-abc123"      → inspect AuthService cluster
```

**Architectural query pattern:** After detection, use `kg_query` — the 5% community signal in hybrid search will boost entities that co-occur in the same cluster, helping surface related symbols for architectural questions.

---

## Data Model

### Entity Schema

```
id          TEXT PRIMARY KEY   — "ent-{nanoid}" format
name        TEXT NOT NULL      — Symbol/concept name
entity_type TEXT NOT NULL      — One of 14 types
description TEXT               — Human-readable context
properties  TEXT               — JSON: file, line, kind, signature, parent
source_memory_id TEXT          — Linked memory ID (if created from memory_store)
created_at  TEXT
updated_at  TEXT
```

**Embeddings:** Each entity is embedded using the shared embedding model (all-MiniLM-L6-v2 by default, 384-dim) via the shared embedder singleton. On Apple Silicon, embeddings use CoreML/ANE for ~5x speedup over CPU.

### Relation Schema

```
id            TEXT PRIMARY KEY
source_id     TEXT → kg_entities.id
target_id     TEXT → kg_entities.id
relation_type TEXT — one of 11 types
weight        REAL — 0.0–1.0
properties    TEXT — JSON metadata
created_at    TEXT
```

### Community Schema

```
id          TEXT PRIMARY KEY
name        TEXT — Highest-degree entity name
summary     TEXT
entity_ids  TEXT — JSON array of member IDs
level       INTEGER — Hierarchy level (always 0 currently)
created_at  TEXT
updated_at  TEXT
```

### Memory Links

```
entity_id    TEXT → kg_entities.id
memory_id    TEXT → memories.id (Memory module)
relationship TEXT — e.g. "related_memory"
created_at   TEXT
PRIMARY KEY (entity_id, memory_id)
```

When a memory is stored via `memory_store` and KG is enabled, the top 3 semantically related KG entities (similarity ≥ 0.6) are automatically linked in this table. This makes memories navigable from KG entities and vice versa.

---

## Storage

All KG data lives in `data/memory.db` (shared with the Memory module). Tables:

| Table | Purpose |
|---|---|
| `kg_entities` | Entity records |
| `kg_entity_embeddings` | 384-dim BLOB embeddings per entity |
| `kg_entity_vss` | vec0 KNN index (lazy-initialized on first embed) |
| `kg_relations` | Directed, typed, weighted edges |
| `kg_communities` | Detected community clusters |
| `kg_entity_memory_links` | Cross-module links to Memory entries |
| `kg_entity_fts` | FTS5 virtual table for keyword search |
| `kg_metadata` | Key-value store for module metadata |

**Search priority chain (fastest to slowest):**
1. vec0 KNN index — O(log n), requires embedding data
2. `vec_distance_cosine` SQL function — O(n), requires sqlite-vec extension
3. JavaScript cosine similarity — O(n), always available fallback

---

## Configuration

All environment variables are optional. Defaults are tuned for code intelligence.

| Variable | Default | Description |
|---|---|---|
| `DRAGONFLY_KG_ENABLED` | `true` | Enable/disable the module |
| `DRAGONFLY_KG_SEMANTIC_WEIGHT` | `0.35` | Semantic signal weight in hybrid search |
| `DRAGONFLY_KG_KEYWORD_WEIGHT` | `0.35` | Keyword signal weight |
| `DRAGONFLY_KG_GRAPH_WEIGHT` | `0.25` | Graph proximity weight |
| `DRAGONFLY_KG_COMMUNITY_WEIGHT` | `0.05` | Community boost weight |
| `DRAGONFLY_MEMORY_DB_PATH` | `data/memory.db` | Path to shared SQLite database |
| `DRAGONFLY_EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Local ONNX model or `openai` |
| `DRAGONFLY_EMBEDDING_DIMS` | `384` | Embedding dimensions (must match model) |

**Tuning for NL document queries** (e.g., if using primarily with markdown/docs):
```bash
DRAGONFLY_KG_SEMANTIC_WEIGHT=0.45
DRAGONFLY_KG_KEYWORD_WEIGHT=0.25
DRAGONFLY_KG_GRAPH_WEIGHT=0.20
DRAGONFLY_KG_COMMUNITY_WEIGHT=0.10
```

**Tuning for pure structural code navigation:**
```bash
DRAGONFLY_KG_SEMANTIC_WEIGHT=0.20
DRAGONFLY_KG_KEYWORD_WEIGHT=0.40
DRAGONFLY_KG_GRAPH_WEIGHT=0.40
DRAGONFLY_KG_COMMUNITY_WEIGHT=0.00
```

---

## Apple Silicon Acceleration

The KG module uses the shared embedder singleton, which automatically routes to CoreML/ANE on Apple Silicon (`darwin` + `arm64`):

```typescript
// Detected at startup
const IS_APPLE_SILICON = process.platform === "darwin" && process.arch === "arm64";

// On Apple Silicon: CoreML with NPU target + fp16
executionProviders: [{ name: "coreml", deviceType: "npu" }, "cpu"]
// On other platforms: CPU only, fp32
executionProviders: ["cpu"]
```

Embedding generation (used by `kg_ingest_ast`, `kg_entity`, `kg_query`) benefits from ~5x speedup on Apple Silicon via the Neural Engine. No configuration required.

---

## Integration with Other Modules

### Memory Module

When `memory_store` saves a new memory and KG is enabled, the top 3 semantically related KG entities (similarity ≥ 0.6) are automatically linked in `kg_entity_memory_links`. This is non-fatal — memory storage succeeds even if KG linking fails.

Result: architectural knowledge stored as memories is navigable from KG entity traversal and vice versa.

### AST Module

`kg_ingest_ast` reads directly from the AST index (built by `index_project`). The AST module is the ground truth for code structure; the KG is a queryable enrichment layer on top of it. When both are populated, `kg_query` and `kg_traverse` answer structural questions that pure AST tools (`find_references`, `get_call_graph`) cannot contextualize semantically.

### Testing Module

After `analyze_coverage` identifies untested files, `kg_traverse` can be used to surface the structural context of those files — what calls them, what they implement, what module they belong to — giving the LLM richer context for targeted test generation.

---

## Typical Workflow

```
# 1. Build AST index
index_project

# 2. Populate KG from AST (deterministic, fast)
kg_ingest_ast

# 3. Optionally add NL context from docs
kg_ingest text="<README content>"
kg_ingest text="<Architecture doc>"

# 4. Optionally build community clusters (for architectural queries)
kg_community action="detect"

# 5. Query
kg_query "authentication middleware"
kg_query "database connection pooling" entity_type=function

# 6. Traverse for multi-hop analysis
kg_traverse name="AuthService" depth=2
kg_traverse name="IRepository" relation_types="implements"

# 7. Check what's untested, then traverse for context
find_untested_files
kg_traverse name="UserRepository" relation_types="calls,defined_in"
```

---

## Limitations

- **Call graph is static-analysis-only.** Dynamic dispatch (virtual methods, reflection, dependency injection) may not appear in call relations. The AST can only see what the parser sees.
- **Cross-language projects.** Relations between entities in different languages (e.g., TypeScript calling a Go service) are not captured — only intra-language static calls.
- **Community detection is BFS connected components**, not hierarchical Leiden. Communities represent simple connectivity, not overlapping membership or hierarchical structure.
- **Embeddings are 384-dim** (all-MiniLM-L6-v2 default). For large codebases (>100k entities), vec0 KNN search remains O(log n) but index build time scales with entity count.
- **Community signal is unvalidated for code.** The 5% community weight is conservative by design. See `docs/research/kg-rag-research.md` for full context.

---

## Recommended `.mcp.json` Configuration

```json
{
  "mcpServers": {
    "dragonfly": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--no-wasm-tier-up",
        "--liftoff-only",
        "node_modules/@dragonflymcp/plugin/dist/index.js"
      ],
      "env": {
        "DRAGONFLY_KG_ENABLED": "true",
        "DRAGONFLY_MEMORY_ENABLED": "true",
        "DRAGONFLY_FRAMEWORK_ENABLED": "true",
        "DRAGONFLY_STATE_ENABLED": "true",
        "DRAGONFLY_SPEC_ENABLED": "true",
        "DRAGONFLY_REPAIR_ENABLED": "true"
      }
    }
  }
}
```
