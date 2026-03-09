# Memory Module

**Module:** `memory`
**Tools:** 4 (`memory_store`, `memory_recall`, `memory_evolve`, `memory_forget`)
**Feature flag:** None
**Storage:** `memoryDbPath` (memories table + memory_embeddings table + links table)
**Always enabled:** Yes

---

## Quick Reference

| Tool | Description | Required Params |
|---|---|---|
| `memory_store` | Persist a new typed memory with optional metadata | `content`, `type` |
| `memory_recall` | Retrieve memories by semantic similarity to a query | `query` |
| `memory_evolve` | Adjust a memory's confidence score based on new evidence | `memory_id`, `delta` |
| `memory_forget` | Archive (soft-delete) a memory | `memory_id` |

---

## Overview

The Memory module provides persistent, semantically-searchable memory for the Dragonfly agent. It enables the agent to record learnings, decisions, and observations across sessions and retrieve them by meaning — not just by keyword match or exact lookup.

The module implements a three-tier memory taxonomy (episodic, semantic, procedural) drawn directly from cognitive psychology, with confidence scoring that evolves over time as memories are corroborated or contradicted. Memories are never hard-deleted; `memory_forget` archives them, preserving an audit trail while excluding them from future recall.

### Architecture

```
memory_store
     │  content + type + category + tags + confidence
     ▼
Embedding encoder (@huggingface/transformers ONNX)
     │  same model as Semantic module
     ▼
memoryDbPath
     ├─ memories table
     │   id, content, type, category, source, tags, confidence, archived, created_at
     ├─ memory_embeddings table
     │   memory_id → float32 vector
     └─ links table
         memory_id_a, memory_id_b, relationship

memory_recall
     │  query → embed → cosine similarity
     ▼
Ranked memories (similarity × confidence weight)
```

Confidence is a first-class attribute. During recall, similarity scores are weighted by confidence — a high-confidence memory at 0.7 similarity may outrank a low-confidence memory at 0.85 similarity. This implements a probabilistic retrieval model rather than pure nearest-neighbor.

---

## Tools

### `memory_store`

Store a new memory. The content is embedded immediately and stored alongside the text. The `type` parameter maps to Tulving's cognitive memory taxonomy — using the correct type improves recall precision because type is a filter dimension.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `content` | string | Yes | — | The memory content to store |
| `type` | string | Yes | — | `episodic` (specific event), `semantic` (general knowledge), or `procedural` (how-to) |
| `category` | string | No | none | Grouping label, e.g. `architecture`, `patterns`, `decisions` |
| `source` | string | No | none | Origin of the memory, e.g. tool name, session ID, or document name |
| `tags` | string[] | No | `[]` | Free-form tags for faceted filtering |
| `confidence` | number (0–1) | No | `1.0` | Initial confidence score |

**Returns:**

```json
{
  "memory_id": "mem_a3f7c2",
  "stored": true,
  "type": "semantic",
  "category": "architecture"
}
```

**Type guidance:**
- `episodic` — something that happened: "The migration to Postgres failed on 2025-11-12 due to a missing index"
- `semantic` — general facts: "This project uses camelCase for all internal identifiers"
- `procedural` — how to do something: "To deploy, run `make release` from the project root"

---

### `memory_recall`

Retrieve memories by semantic similarity. The query is embedded and compared against all stored memory embeddings using cosine similarity. Results are filtered by threshold and optionally by type, category, or tags before ranking.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | Yes | — | Natural language query describing what to recall |
| `limit` | number | No | `5` | Maximum memories to return |
| `threshold` | number (0–1) | No | `0.5` | Minimum similarity score for inclusion |
| `type` | string | No | all | Filter: `episodic`, `semantic`, or `procedural` |
| `category` | string | No | none | Filter by category label |
| `tags` | string[] | No | none | Filter: return only memories containing all specified tags |

**Returns:**

```json
[
  {
    "memory_id": "mem_a3f7c2",
    "content": "Authentication uses JWT with 24h expiry and refresh tokens stored in Redis.",
    "type": "semantic",
    "category": "architecture",
    "confidence": 0.92,
    "similarity": 0.81,
    "created_at": "2025-10-04T09:12:00Z"
  }
]
```

---

### `memory_evolve`

Update a memory's confidence score based on new evidence. Confidence can increase (when a memory is corroborated) or decrease (when it is contradicted or becomes stale). The change is recorded in the evolution history for auditability.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `memory_id` | string | Yes | — | ID of the memory to update |
| `delta` | number | No | — | Confidence change: positive to increase, negative to decrease. Final value is clamped to [0, 1] |
| `reason` | string | No | none | Human-readable explanation for the confidence change |

**Returns:**

```json
{
  "memory_id": "mem_a3f7c2",
  "previous_confidence": 0.92,
  "new_confidence": 0.65,
  "delta_applied": -0.27,
  "reason": "JWT expiry was changed to 1h in auth config update",
  "evolution_count": 3
}
```

Memories with confidence below `0.2` are excluded from recall results by default, functioning as a soft deprecation without requiring explicit `memory_forget`.

---

### `memory_forget`

Archive a memory, removing it from future recall results without destroying the record. All archived memories remain in the database with their full history, enabling audit and potential restoration.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `memory_id` | string | Yes | — | ID of the memory to archive |
| `reason` | string | No | none | Explanation for archival |

**Returns:**

```json
{
  "memory_id": "mem_a3f7c2",
  "archived": true,
  "reason": "Superseded by updated authentication architecture"
}
```

---

## Academic Foundation

### Episodic vs. Semantic Memory — The Type Taxonomy

Tulving, E. (1972). *Episodic and semantic memory.* In E. Tulving & W. Donaldson (Eds.), *Organization of Memory* (pp. 381–403). Academic Press.

Tulving's foundational distinction between episodic memory (personally experienced events, tied to time and place) and semantic memory (general world knowledge, independent of acquisition context) is directly implemented in the `type` parameter of `memory_store`. A third type, procedural memory (skill-based knowledge, "how to"), is drawn from Tulving's 1985 extension. The practical consequence for the Dragonfly agent is that episodic memories ("this build failed because of X") degrade in relevance over time, while semantic memories ("this project uses pattern Y") remain relevant until explicitly invalidated. Procedural memories ("to do Z, follow these steps") are the most reusable across projects and are the primary source for Bridge module exports.

### Forgetting Curve and Confidence Decay

Ebbinghaus, H. (1885). *Über das Gedächtnis: Untersuchungen zur experimentellen Psychologie.* Duncker & Humblot. (Translated: *Memory: A Contribution to Experimental Psychology*, 1913.)

Ebbinghaus's forgetting curve — the exponential decay of retention over time without rehearsal — is the theoretical model for confidence decay in `memory_evolve`. Memories not accessed or corroborated over time should have reduced weight in recall, mirroring biological memory consolidation. While the current implementation uses explicit `delta` values rather than automatic time-based decay, the design intent follows Ebbinghaus: confidence represents the current reliability of a memory, and that reliability must be actively maintained or it degrades.

### Spaced Repetition for LLM Memory Consolidation

Ye, X. et al. (2023). *SPACED: A spaced repetition framework for effective LLM memory consolidation.* Proceedings of EMNLP 2023.

SPACED applies the spaced repetition learning principle — re-exposing a learner to material at increasing intervals proportional to their current retention — to LLM memory management. The study demonstrates that periodic memory review and confidence re-scoring (equivalent to `memory_evolve` calls based on usage frequency) produces more accurate and efficient memory retrieval over long time horizons. The evolution history tracked by `memory_evolve` is the data structure needed to implement a SPACED-style scheduler.

### MemGPT — Hierarchical LLM Memory Management

Packer, C., Fang, V., Patil, S. G., Moon, H., Fang, R., & Gonzalez, J. E. (2023). *MemGPT: Towards LLMs as operating systems.* arXiv:2310.08560. https://arxiv.org/abs/2310.08560

MemGPT introduces an operating-system-inspired memory hierarchy for LLM agents: a fast "main context" (the active prompt window) and a slower "external storage" (persistent database). The agent explicitly manages movement between tiers using retrieval and eviction operations. The Memory module implements MemGPT's external storage tier: `memory_recall` is the retrieval operation that surfaces relevant context into the agent's working memory, and `memory_forget` is the eviction operation. The confidence-weighted recall ranking extends MemGPT's model by prioritizing high-confidence memories over lower-confidence ones at equal similarity.

### Retrieval-Augmented Generation

Lewis, P., Perez, E., Piktus, A., Petroni, F., Karpukhin, V., Goyal, N., Küttler, H., Lewis, M., Yih, W.-t., Rocktäschel, T., Riedel, S., & Kiela, D. (2020). *Retrieval-augmented generation for knowledge-intensive NLP tasks.* arXiv:2005.11401. https://arxiv.org/abs/2005.11401

Lewis et al. (Meta AI Research) established the RAG pattern: retrieve relevant documents from an external store, prepend them to the LLM prompt, generate a grounded response. `memory_recall` is the retrieval step in this pattern. The Memory module extends basic RAG with: typed memory categories that allow retrieval filters; confidence scoring that weights retrieved results; and evolution tracking that keeps the external store current. The RAG pattern is why memory is stored as natural language text rather than structured records — the recalled content is inserted directly into agent prompts.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `memoryDbPath` | `~/.dragonfly/memory.db` | SQLite database path for memories, embeddings, and links |

---

## Integration with Other Modules

**Semantic module:** Both modules use the same `memoryDbPath` database and the same embedding model. Code embeddings (Semantic) and memory content embeddings (Memory) are stored in separate tables but share the vector computation infrastructure. The `embed_project` and `memory_store` operations use identical embedding pipelines.

**Bridge module:** The Bridge module's `dragonfly_bridge_export` reads from the Memory module's `memories` table, filtering by confidence level. The Bridge is the cross-project distribution channel for memories. Memories with `type: "semantic"` and `type: "procedural"` are the primary candidates for export, as they generalize across projects better than `episodic` memories.

**Framework module:** The WYSIWID workflow system calls `memory_recall` to retrieve relevant past decisions before generating architecture or implementation plans. Memories of type `semantic` and category `architecture` are particularly valuable here — they surface constraints and decisions that should influence new work.

**Analytics module:** The observability layer tracks `memory_store` and `memory_recall` call frequency and latency. `evolve_best` in the Evolve module stores winning prompt variants as `procedural` memories for future reuse.

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/memory/store.ts` | Memory persistence and embedding storage |
| `src/tools/memory/recall.ts` | Similarity search and confidence-weighted ranking |
| `src/tools/memory/evolve.ts` | Confidence update and evolution history |
| `src/tools/memory/index.ts` | MCP tool registration |
