# Semantic Module

**Module:** `semantic`
**Tools:** 3 (`embed_project`, `semantic_search`, `find_similar_code`)
**Feature flag:** None
**Storage:** `memoryDbPath` (embedding vectors + chunk metadata)
**Always enabled:** Yes

---

## Quick Reference

| Tool | Description | Required Params |
|---|---|---|
| `embed_project` | Generate and store semantic embeddings for project codebase | None |
| `semantic_search` | Natural-language search over codebase embeddings | `query` |
| `find_similar_code` | Find code structurally similar to a given snippet | `code` |

---

## Overview

The Semantic module provides meaning-based code search using transformer-based embeddings. Where text search matches tokens and AST analysis matches structure, semantic search matches *intent* — a query like "validate user permissions before database write" returns relevant code even when none of those exact words appear in the source.

The module runs entirely locally. Embeddings are generated using `@huggingface/transformers` with ONNX Runtime, requiring no external API calls, no network access, and no API keys. On Apple Silicon, the CoreML execution provider routes embedding inference through the Apple Neural Engine (ANE), achieving approximately 5× speedup over CPU-only inference on the same machine.

### Architecture

```
Source files
     │
     ▼
EmbeddingRefresher (incremental, concurrency=4)
     │  file-hash change detection — skips unchanged files
     │  Semaphore controls 4 parallel embed calls
     │  native EmbeddingCache integration per chunk
     ▼
CodeChunker (sliding window, overlap)
     │  splits files into semantically coherent segments
     ▼
EmbeddingCache (two-tier: in-memory LRU + SQLite)
     │  SHA-256 key on chunk content + model name
     │  in-memory LRU (configurable cap) → SQLite fallback
     │  TTL expiry + LRU eviction on overflow
     ▼
Transformer encoder (ONNX / @huggingface/transformers)
     │  CodeBERT or similar code-specialized model
     │  Apple Silicon: ANE via CoreML execution provider
     │  (only called on cache miss)
     ▼
Embedding vectors (float32[768])
     │
     ▼
VectorStore (memoryDbPath)
     │  chunks + embeddings + metadata (file, line range, language)
     ▼
Query layer — uses CachedEmbedder (cache.wrap(model))
     │  query → embed (with cache) → cosine similarity → ranked results
     │
     ├─ semantic_search (natural language → code)
     └─ find_similar_code (code snippet → similar code)
```

Indexing is incremental via `EmbeddingRefresher`: file content hashes detect changed files; chunk content hashes feed the two-tier `EmbeddingCache` to avoid re-encoding unchanged chunks. On a large codebase, typical re-embed runs after minor changes complete in seconds with near-100% cache hit rates.

---

## Tools

### `embed_project`

Create or update semantic embeddings for the project codebase. Chunks source files, encodes each chunk with a transformer model, and stores the resulting vectors in the embedding database. Must be called before `semantic_search` or `find_similar_code` can return results.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `paths` | string[] | No | entire project | Restrict embedding to specific directories or files |
| `incremental` | boolean | No | `true` | Skip chunks whose source content has not changed |
| `languages` | string[] | No | all supported | Filter by language: `typescript`, `javascript`, `python`, `go`, `rust`, `java`, `c` |

**Returns:**

```json
{
  "chunksEmbedded": 89,
  "chunksSkipped": 280,
  "filesChanged": 12,
  "filesUnchanged": 77,
  "totalChunks": 412,
  "durationMs": 4200,
  "cacheHitRate": 0.76
}
```

`cacheHitRate` reflects the `EmbeddingCache` efficiency across this run. On first-run or heavily changed codebases, hit rate is low; on minor incremental runs, hit rate approaches 1.0. If errors occurred (file read failures, encoding errors), an `errors` array is included.

---

### `semantic_search`

Search the codebase by semantic meaning using natural language. The query is embedded with the same model used during indexing, and results are ranked by cosine similarity to the query vector. Returns only results above the similarity threshold.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | Yes | — | Natural language description of what to find |
| `limit` | number | No | `5` | Maximum results to return |
| `threshold` | number (0–1) | No | `0.5` | Minimum cosine similarity score for inclusion |
| `filter` | object | No | none | Metadata filters, e.g. `{ "language": "typescript", "file": "src/auth" }` |

**Returns:** Ranked array of results:

```json
[
  {
    "file": "src/auth/middleware.ts",
    "line_start": 34,
    "line_end": 51,
    "snippet": "export function requireRole(role: string) { ... }",
    "similarity": 0.847,
    "language": "typescript"
  }
]
```

Results are sorted by `similarity` descending. A threshold of `0.5` filters noise; for exploratory searches, lower to `0.3`. For precise retrieval, raise to `0.7`.

---

### `find_similar_code`

Find code in the project that is semantically similar to a given code snippet. Unlike `semantic_search`, the query is code rather than natural language — the snippet is embedded directly and matched against the index.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `code` | string | Yes | — | Code snippet to use as the similarity query |
| `limit` | number | No | `5` | Maximum results to return |
| `excludeExact` | boolean | No | `true` | Exclude results with near-identical content to the input |

**Returns:**

```json
[
  {
    "file": "src/payments/validator.ts",
    "line_start": 12,
    "line_end": 28,
    "snippet": "function validatePaymentAmount(amount: number) { ... }",
    "similarity": 0.79
  }
]
```

Typical use cases: detecting duplicate logic, finding existing patterns before writing new code, locating tests that cover similar functionality.

---

## Academic Foundation

### BERT — Transformer Architecture for Contextual Embeddings

Devlin, J., Chang, M.-W., Lee, K., & Toutanova, K. (2019). *BERT: Pre-training of deep bidirectional transformers for language understanding.* arXiv:1810.04805. https://arxiv.org/abs/1810.04805

BERT (Bidirectional Encoder Representations from Transformers) introduced the transformer encoder architecture that underlies all embedding models used in this module. The key insight is bidirectional context: each token's representation is conditioned on all other tokens in the input simultaneously, not just preceding tokens. This produces contextual embeddings where the same word has different vector representations depending on its surrounding context — essential for code where identifiers like `open`, `close`, or `read` have radically different meanings depending on context. BERT's masked language modeling pre-training objective allows it to learn rich representations without labeled data.

### CodeBERT — BERT Pre-trained on Code

Feng, Z., Guo, D., Tang, D., Duan, N., Feng, X., Gong, M., Shou, L., Qin, B., Liu, T., Jiang, D., & Zhou, M. (2020). *CodeBERT: A pre-trained model for programming and natural language.* arXiv:2002.08155. https://arxiv.org/abs/2002.08155

CodeBERT (Microsoft Research) extends BERT with pre-training on paired natural language and code data across six programming languages. Standard BERT embeddings treat code as text, losing structural signals. CodeBERT's bimodal pre-training on (docstring, code) pairs teaches the model that "retrieves a user from the database by ID" and `SELECT * FROM users WHERE id = $1` are semantically aligned. This is precisely the capability exploited by `semantic_search`: natural language queries map to the same embedding space as code. CodeBERT achieves state-of-the-art performance on natural language code search benchmarks.

### Sentence-BERT — Sentence-Level Semantic Similarity

Reimers, N. & Gurevych, I. (2019). *Sentence-BERT: Sentence embeddings using Siamese BERT-networks.* arXiv:1908.10084. https://arxiv.org/abs/1908.10084

Standard BERT requires cross-encoding both inputs together to compute similarity, making pairwise similarity computation over large corpora prohibitively expensive. Sentence-BERT (SBERT) fine-tunes BERT with a Siamese network structure to produce fixed-length sentence embeddings that can be compared directly via cosine similarity — reducing a 65-hour pairwise computation to 5 seconds. The `semantic_search` and `find_similar_code` tools rely on this single-pass embedding + cosine similarity architecture: each chunk is embedded once at index time, and queries are embedded once at search time. SBERT's training methodology is the direct predecessor to the models used in this module.

### Blended RAG — Hybrid Semantic + Keyword Retrieval

Sawarkar, K., Mangal, A., & Solanki, S. R. (2024). *Blended RAG: Improving RAG (Retriever-Augmented Generation) accuracy with semantic search and hybrid query-based retrievers.* arXiv:2404.07220. https://arxiv.org/abs/2404.07220

Blended RAG demonstrates that combining semantic (embedding) retrieval with keyword (BM25) retrieval consistently outperforms either approach alone across multiple benchmarks. Pure semantic search excels at conceptual queries but can miss results when the user knows the exact identifier name. Pure keyword search finds exact matches but misses semantic variants. The Semantic module is designed to work alongside the AST module's structural queries and the bridge module's keyword search — together implementing the blended retrieval pattern Sawarkar et al. identify as optimal.

### HippoRAG — Graph-Enhanced Long-Term Retrieval

Gutierrez, B. J., Shu, Y., Gu, Y., Kamigaito, H., & Su, Y. (2024). *HippoRAG: Neurobiologically inspired long-term memory for large language models.* NeurIPS 2024. arXiv:2405.14831. https://arxiv.org/abs/2405.14831

HippoRAG models RAG retrieval after the hippocampal memory system, combining embedding-based initial retrieval with graph traversal over entity relationships for re-ranking. The architecture mirrors the complementary roles of the Semantic module (embedding similarity, analogous to hippocampal pattern completion) and the Knowledge Graph module (structured entity traversal, analogous to the neocortical relational store). The Dragonfly pipeline's layered retrieval — semantic search first, then graph traversal for related context — is an implementation of the HippoRAG pattern.

### Cosine Similarity for Information Retrieval

Salton, G. & McGill, M. J. (1983). *Introduction to Modern Information Retrieval.* McGraw-Hill.

The vector space model with cosine similarity, introduced by Salton and McGill, is the mathematical foundation for all embedding-based retrieval. Cosine similarity measures the angle between two vectors, normalizing for vector magnitude — meaning a short docstring and a long function body can score high similarity if they describe the same concept. The `threshold` parameter in `semantic_search` maps directly to the minimum cosine similarity score in Salton's model.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| *(none module-specific)* | — | Embeddings stored at path from `memoryDbPath` in plugin config |

The embedding model is selected at build time. The default is a code-specialized model available through `@huggingface/transformers`. Apple Silicon users automatically receive ANE-accelerated inference via the CoreML execution provider — no configuration required.

---

## Integration with Other Modules

**AST module:** Semantic search provides the "find by meaning" complement to AST's "find by structure." A typical pattern is `semantic_search` to narrow the relevant files, then `get_symbol_info` or `get_call_graph` for precise structural analysis of those files.

**Memory module:** Both modules share the `memoryDbPath` database but write to separate tables. The Semantic module stores code chunk embeddings; the Memory module stores memory content embeddings. The embedding model and similarity computation are shared infrastructure.

**Repair module:** `semantic_search` is useful for locating existing error-handling patterns before `iterative_refine` generates new error handling — ensuring consistency with the project's established patterns.

**Knowledge Graph module:** `semantic_search` provides candidate nodes for graph traversal queries. `kg_traverse` can deepen the context around semantically-retrieved code by walking the entity relationship graph outward from those nodes.

**Analytics module:** `embed_project` stats (chunks created, model used, duration) feed into the observability layer for performance benchmarking of the embedding pipeline.

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/semantic/chunker.ts` | `CodeChunker` — language-aware sliding window file chunking |
| `src/tools/semantic/store.ts` | `VectorStore` — SQLite chunk + embedding storage, cosine similarity search |
| `src/tools/semantic/cache.ts` | `EmbeddingCache` — two-tier LRU cache (in-memory Map + SQLite), `wrap(model)` |
| `src/tools/semantic/refresher.ts` | `EmbeddingRefresher` — file-hash change detection, parallel embed (Semaphore), cache integration |
| `src/tools/semantic/index.ts` | MCP tool registration; wires EmbeddingCache + EmbeddingRefresher into `embed_project` |
