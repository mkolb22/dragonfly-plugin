# Dragonfly Performance Research: Rust & Optimal Tooling

## Summary

Dragonfly is compute-bound, not I/O-bound. Its hot paths are:
embedding generation (ONNX), vector similarity (cosine), SQLite bulk ops, and AST parsing.
These are exactly the workloads where Rust dominates Node.js.

Estimated total speedup of a Rust rewrite: **3–5× faster** across all hot paths,
with **zero GC pauses** during inference.

---

## Current Stack

| Component | Current Implementation | Known Overhead |
|-----------|----------------------|----------------|
| Embeddings | `@huggingface/transformers` → ONNX Runtime → CoreML/ANE | V8 GC, single-threaded inference |
| SQLite | `better-sqlite3` (native C addon) | Minimal — already a thin C binding |
| AST parsing | `tree-sitter` (Node.js binding) | V8 object allocation for every node |
| Vector KNN | `sqlite-vec` (vec0 virtual table) | Fast, native C — no Node overhead |
| Vector similarity | JS Float32Array cosine loop | V8 NEON autovectorization — decent |
| MCP transport | Node.js stdio streams | Low — not the bottleneck |

### Current Benchmark (Apple M5, ANE active)

- Embedding: **6.8 ms/call** (CoreML fp16, ANE path)
- Cosine similarity (384-dim): ~0.01 ms per pair (V8 NEON JIT)
- SQLite batch insert (100 rows): ~5 ms
- AST index (86 files): ~506 ms

---

## Option A — Full Rust Rewrite (Maximum Performance)

### Architecture

```
MCP stdio transport (tokio::io)
    ↓
Tool router (match arms, zero allocation)
    ↓
┌─────────────────────────────────────────┐
│  Semantic tools: ort crate → ONNX       │  ← CoreML/ANE preserved
│  SQLite: rusqlite + r2d2 pool           │  ← zero FFI overhead
│  AST: tree-sitter Rust bindings         │  ← tree-sitter is C, Rust is first-class
│  Vector ops: std::simd (portable SIMD)  │  ← 8–16 vectors in parallel
│  Parallel embed: rayon thread pool      │  ← embed N chunks concurrently
└─────────────────────────────────────────┘
```

### Key Rust Crates

| Crate | Purpose | Advantage over Node |
|-------|---------|---------------------|
| `ort` | ONNX Runtime bindings | Same CoreML backend, zero GC pauses |
| `rusqlite` | SQLite bindings | Zero FFI overhead vs better-sqlite3 |
| `tree-sitter` | AST parsing (Rust bindings) | First-class — library is C, Rust is idiomatic consumer |
| `rayon` | Data parallelism | Parallel embedding across CPU cores |
| `std::simd` | Portable SIMD | 8–16 float ops per instruction for cosine similarity |
| `tokio` | Async runtime | Handles MCP stdio + concurrent tool execution |
| `serde_json` | JSON parsing | ~2× faster than Node.js JSON for large payloads |
| `candle` | Alternative to ONNX | Pure Rust ML framework; Metal backend on Apple Silicon |

### Expected Performance Gains

| Hot Path | Current (Node.js) | Rust Estimate | Reason |
|----------|-------------------|---------------|--------|
| Embedding (single) | 6.8 ms | 4–5 ms | No V8 JIT warmup, no GC pauses |
| Embedding (batch 32) | ~218 ms serial | ~30 ms | Rayon parallel batching |
| Cosine similarity (1K pairs) | ~10 ms | ~1–2 ms | SIMD, no V8 overhead |
| AST index (86 files) | 506 ms | ~100–150 ms | No V8 object allocation per node |
| SQLite batch insert (1K) | ~50 ms | ~15 ms | rusqlite prepared stmt, no callback overhead |
| Process startup | ~800 ms (Node.js boot) | ~50 ms | No V8 init, no JIT warmup |

**Total: 3–5× faster on compute paths. 15× faster startup.**

### MCP Transport

MCP is JSON over stdin/stdout — language-agnostic. Rust handles this with:
```rust
// tokio + serde_json — clean, zero-copy where possible
let mut stdin = BufReader::new(tokio::io::stdin());
let mut stdout = BufWriter::new(tokio::io::stdout());
```

No protocol change. Existing Claude Code sessions work unchanged.

### Migration Risk

- High effort (~3–4 weeks to rewrite 113 tools)
- `ort` crate requires ONNX Runtime shared libs — same as current
- tree-sitter Rust bindings are mature (tree-sitter itself is Rust now)
- rusqlite is battle-tested (used in Firefox, Servo)

---

## Option B — Rust Hot Path Addons via napi-rs (Pragmatic Hybrid)

Keep TypeScript for MCP interface + tool routing. Replace hot paths with Rust native addons.

### What to Move to Rust

| Hot Path | napi-rs Addon | Speedup |
|----------|---------------|---------|
| Cosine similarity | `cosine_similarity(a: Float32Array, b: Float32Array)` | ~5× (SIMD) |
| Batch embedding | `embed_batch(texts: string[])` → ONNX Rust session | ~3× (parallel) |
| SQLite bulk insert | `insert_chunks(chunks: Buffer[])` → rusqlite transaction | ~2× |
| SHA-256 cache key | `cache_key(text: string)` → ring crate | ~3× |

### Effort

- 2–3 days per hot path addon
- TypeScript layer unchanged — no tool API changes
- `napi-rs` has excellent TypeScript type generation

---

## Option C — Node.js Optimizations (No Rust)

Already applied: ANE/CoreML (6.8 ms), vec0 KNN. Remaining:

| Optimization | Speedup | Effort |
|---|---|---|
| Worker threads for parallel embedding | ~3× for batch | 1 day |
| ONNX batch inference (embed N at once) | ~5× for embed_project | 1 day |
| Prepared statement cache at startup | ~20% SQLite | 4 hours |
| Float32Array everywhere (avoid `number[]`) | ~15% cosine | 2 hours |

Ceiling: ~1.5–2× improvement. GC pauses remain.

---

## Recommendation

### Near-term (now): Option C + Option B hot paths
1. Add ONNX batch embedding (biggest win for `embed_project`)
2. Worker thread pool for parallel embedding during project indexing
3. Rust addon for cosine similarity via `napi-rs` (SIMD, trivial to write)

### Long-term: Option A (full Rust)
The right architecture for a compute-bound MCP server. Rust eliminates GC pauses
on the critical path (inference, AST, vector ops), cuts startup to ~50 ms, and
enables true parallelism across embedding batches via Rayon.

The `candle` ML framework (pure Rust, Metal backend on Apple Silicon) is worth
evaluating as a replacement for ONNX Runtime — it would remove the C library
dependency entirely while preserving ANE/GPU acceleration.

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-07 | ANE/CoreML acceleration added | 6.8 ms/embed on M5, fp16, graceful CPU fallback |
| 2026-03-07 | Research: Rust rewrite path | Compute-bound workloads favor Rust 3–5× over Node.js |
| 2026-03-07 | Near-term: batch embedding + napi-rs cosine | Pragmatic wins without full rewrite |
