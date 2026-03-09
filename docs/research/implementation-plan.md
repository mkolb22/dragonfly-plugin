# Dragonfly Plugin — Implementation Plan

**Date:** 2026-03-08
**Based on:** kg-rag-research.md, module review analysis, full source code audit
**Scope:** Module justification, KG redesign, cross-module optimizations

---

## Part 1: Module Justification

Each module reviewed against research evidence and practical workflow value.

---

### Keep: AST Module (7 tools)

**Justification:** Foundation for all code intelligence. Deterministic, complete, fast. The AST KG paper (2026) validates that AST-derived structural analysis is the gold standard for code retrieval — 95.6% accuracy vs 68.9% for vector-only. Every other kept module either depends on or benefits from AST.

**Current state:** Sound. No changes required.

**Optimization:** None needed. Tree-sitter WASM with incremental indexing is the right architecture.

---

### Keep: Semantic Module (3 tools)

**Justification:** Hybrid search research (Blended RAG) shows semantic + keyword consistently outperforms either alone by 15–30%. Code semantic search answers intent-based queries ("error handling functions", "authentication middleware") that exact symbol search cannot. Validated as a necessary complement to AST.

**Current state:** Well-implemented. Apple Silicon ANE optimization already present.

**Optimizations:**
1. Chunk size default (512 tokens) is appropriate for sentence-transformer model limits.
2. The 2000-char text truncation in `embed()` matches the model's effective context. No change needed.
3. Shared embedder singleton ensures ANE is used for both Semantic and Memory — correct.

---

### Keep: Memory Module (4 tools)

**Justification:** HippoRAG validates graph-based associative memory for cross-session context retrieval. Confidence decay (base rate 0.05) prevents stale memories from dominating recall. Auto-linking (similarity threshold) builds associative structure over time — the mechanism HippoRAG's research shows improves multi-hop recall.

**Current state:** Well-designed. Decay + auto-linking + graph traversal is the correct architecture.

**Optimizations:**
1. **Decay grace period** (7 days) is appropriate for development workflows.
2. **Traversal depth in recall** currently defaults to 0 (no graph traversal). Should default to 1 — the research shows even one hop improves recall. The `memory_recall` tool description should note this.
3. **Memory ↔ KG integration gap:** `kg_entity_memory_links` table exists but is never populated by `memory_store`. When a memory is stored, related KG entities should be linked automatically if the KG is populated. This is a missing data flow.

---

### Keep: Framework Module (8 tools)

**Justification:** Workflow orchestration cannot be replaced by ad-hoc prompting. Consistent skill loading, step tracking, and sync rule evaluation are operational requirements, not research questions. The module earns its weight by enforcing workflow discipline across sessions.

**Current state:** Heaviest module (~1,200 LOC). No research-driven changes, but one architectural concern: the WorkflowPlanner makes LLM calls to analyze tasks, adding latency and cost on every workflow start.

**Optimization:**
1. **WorkflowPlanner caching:** Cache planner results keyed by task description hash. Identical or near-identical task descriptions should reuse the last plan rather than calling LLM again. Short TTL (session-scoped) is sufficient.

---

### Keep: State Module (8 tools)

**Justification:** Checkpoints and stories are session continuity infrastructure. Without them, long-running multi-session work requires re-establishing context manually every session. The checkpoint restore with warm-up files is the practical implementation of what RAPTOR's hierarchical summarization achieves theoretically — progressive context restoration at multiple levels of detail.

**Current state:** Sound. SQLite-backed with migration utilities.

**Optimization:** No changes needed.

---

### Keep: Spec Module (6 tools)

**Justification:** ZenSpec's type-safe contract DSL is a unique capability not covered elsewhere. Pre/post-conditions and effects encode correctness requirements that neither the AST module nor semantic search can derive. Language-specific prompt generation (Go, Swift, Rust, TypeScript, Python) with framework detection reduces LLM hallucination of incorrect idioms.

**Current state:** Well-implemented. Multi-language generator is the right design.

**Optimization:**
1. **Spec → Testing integration:** After `dragonfly_spec_generate`, the Testing module should be able to pick up the spec's pre/post conditions as property-based test cases. Currently no integration. This is a gap but not a blocker.

---

### Keep: Testing Module (6 tools)

**Justification:** Test generation, execution, and coverage analysis are core to any development workflow. The module's multi-framework detection (Jest, Vitest, Pytest, Go test, Mocha) ensures it works without configuration in new projects.

**Current state:** Solid. Multi-language AST parsing for test generation is the correct approach.

**Optimization:**
1. **Coverage → KG integration:** `analyze_coverage` identifies untested files. If the KG is populated (via `kg_ingest_ast`), untested files should be enriched with their graph context — what calls them, what they implement — so the LLM can generate better-targeted tests. Currently no integration.

---

### Keep: Repair Module (5 tools)

**Justification:** Error parsing + strategy-based repair suggestions + historical learning via SQLite is a practical complement to Testing. The `get_repair_history` tool — looking up similar past failures by code hash — is a lightweight but empirically sound approach: past fixes are the best prior for future fixes.

**Current state:** Appropriate scope. Pattern-based repair suggestions are honest about their limits (they suggest, not auto-apply).

**Optimization:**
1. **Repair → Memory integration:** Successful repairs should be stored in the Memory module as procedural memories. Currently no integration. This would allow `memory_recall` to surface past successful fixes when similar errors recur across projects.

---

### Remove: Evolve Module

**Justification:** Genetic algorithm for prompt optimization is too niche for practical daily use. Requires iterative LLM evaluation across generations — expensive and slow. No research validates this approach for production coding workflows. The module is an experiment, not a utility.

---

### Remove: Pipeline Module

**Justification:** Custom DSL (`story | architecture:opus | implementation | parallel(...)`) adds a new syntax to learn without adding capability beyond Framework. Framework already handles workflow step orchestration. An abstraction that requires documentation to use and has no incremental value over the existing module is dead weight.

---

### Remove: Analytics Module

**Justification:** Two tools (timeline view + config validation) do not justify a module. The timeline view is a diagnostic nicety, not a development workflow tool. Config validation belongs in the State module as a health check. These tools' value doesn't compound — there's nothing to build on.

---

### Remove: Bridge Module

**Justification:** Cross-project memory export/import via filesystem JSON is useful only if you actively maintain a global memory store across many projects. For most workflows, in-project Memory is sufficient. The Bridge adds setup and maintenance burden for a use case most users will never need. If needed, it can be re-added.

---

### Remove: Knowledge Graph Module — **Revised to Conditional Keep**

**The earlier recommendation was to remove KG. The research reverses this.** The AST KG paper provides direct evidence that KG-augmented retrieval outperforms vector-only by +26.7% on code. The module is the right architecture — the problem is the wrong ingestion path is being used.

**Condition for keeping:** Implement changes in Part 2 below. If changes are not implemented, KG should be removed because `kg_ingest` on code files degrades rather than improves results (probabilistic miss rate, hallucinated edges, duplicate entities).

---

## Part 2: Knowledge Graph Implementation Changes

### Change 1: Restrict `kg_ingest` to Natural Language Documents

**Problem:** `kg_ingest` uses pattern-based extraction from text. On code files, this produces a 31.2% entity miss rate (per AST KG paper) and hallucinated relations. When Claude uses this tool on code, the KG is silently incomplete and unreliable.

**Change:** Update the tool description to explicitly restrict usage to NL documents.

**File:** `src/tools/knowledge/index.ts`

**Current description:**
```typescript
description: "Extract entities and relations from text and add to the knowledge graph. Use for ingesting documentation, comments, architecture notes, or any unstructured text.",
```

**New description:**
```typescript
description: "Extract entities and relations from NATURAL LANGUAGE text only — READMEs, architecture docs, comments, specifications, design notes. DO NOT use on source code files — use kg_ingest_ast instead for code. Pattern-based extraction on code produces unreliable results with ~30% miss rate.",
```

**Impact:** Zero code change. Tool description change controls LLM behavior.

---

### Change 2: Elevate `kg_ingest_ast` as Primary Ingestion Tool

**Problem:** `kg_ingest_ast` exists but its description doesn't communicate that it should be run first and is the authoritative ingestion path for code.

**Change:** Update tool description and add explicit guidance.

**File:** `src/tools/knowledge/index.ts`

**Current description:**
```typescript
description: "Bridge AST index into knowledge graph. Ingests symbols, files, modules, and call relations from the AST index.",
```

**New description:**
```typescript
description: "PRIMARY ingestion tool for code — bridges the AST index into the knowledge graph with deterministic accuracy (95%+ per research vs 68% for vector-only). Run this first to populate the KG with symbols, files, modules, and call relations before using kg_query or kg_traverse. Requires ast index to be built first (index_project). 71x faster and 8.8x cheaper than LLM-based extraction with zero miss rate.",
```

**Impact:** Zero code change. Positions `kg_ingest_ast` correctly for LLM tool selection.

---

### Change 3: Rebalance Hybrid Search Weights

**Problem:** The current weights (semantic 0.4, keyword 0.3, graph 0.2, community 0.1) under-weight the graph signal for code. The AST KG paper shows code relationships are structural — graph proximity should carry more weight than for NL documents. Community (0.1) is the least validated signal for code.

**Research basis:**
- AST KG paper: structural graph is the differentiating signal for code
- Blended RAG: keyword matters for exact symbol names (may need increase)
- GraphRAG: community helps global queries (validated for NL, not code)

**Change:** Update default config weights.

**File:** `src/core/config.ts`

```typescript
// Current
kgSemanticWeight: envFloat("DRAGONFLY_KG_SEMANTIC_WEIGHT", 0.4),
kgKeywordWeight: envFloat("DRAGONFLY_KG_KEYWORD_WEIGHT", 0.3),
kgGraphWeight: envFloat("DRAGONFLY_KG_GRAPH_WEIGHT", 0.2),
kgCommunityWeight: envFloat("DRAGONFLY_KG_COMMUNITY_WEIGHT", 0.1),

// New
kgSemanticWeight: envFloat("DRAGONFLY_KG_SEMANTIC_WEIGHT", 0.35),
kgKeywordWeight: envFloat("DRAGONFLY_KG_KEYWORD_WEIGHT", 0.35),
kgGraphWeight: envFloat("DRAGONFLY_KG_GRAPH_WEIGHT", 0.25),
kgCommunityWeight: envFloat("DRAGONFLY_KG_COMMUNITY_WEIGHT", 0.05),
```

**Rationale:**
- Semantic: 0.40 → 0.35 (slight reduction; code queries rely more on exact names)
- Keyword: 0.30 → 0.35 (increase; exact symbol matching is critical for code)
- Graph: 0.20 → 0.25 (increase; structural proximity is the key differentiator per AST paper)
- Community: 0.10 → 0.05 (reduce; unvalidated for code, high noise risk)

All weights remain configurable via environment variables — no breaking change.

---

### Change 4: Increase Graph BFS Seeds in Hybrid Search

**Problem:** `computeGraphScores()` in `retrieval.ts` seeds the BFS from the top 5 semantic results. For code graphs, which are denser and more interconnected than NL entity graphs, 5 seeds may miss structurally relevant neighbors.

**File:** `src/tools/knowledge/retrieval.ts`

```typescript
// Current (line ~30)
const seedIds = semanticResults.slice(0, 5).map(r => r.entity.id);

// New
const seedIds = semanticResults.slice(0, 8).map(r => r.entity.id);
```

**Rationale:** Code call graphs typically have higher branching factor than NL entity graphs. 8 seeds provides broader BFS coverage without excessive computation.

---

### Change 5: Decouple Community Detection from `kg_ingest_ast`

**Problem:** `kg_ingest_ast` automatically runs community detection after ingestion (line ~537 in index.ts). Community detection is an O(n) graph traversal over all entities and relations. On large codebases, this adds significant latency to every AST ingest.

**Change:** Remove automatic community detection from `kg_ingest_ast`. Let users call `kg_community` action "detect" explicitly when needed.

**File:** `src/tools/knowledge/index.ts`

```typescript
// Current (in kg_ingest_ast handler, ~line 537)
const communities = await store.detectCommunities();
// ... return with communitiesDetected

// New — remove the detectCommunities() call
// Return bridgeResult + astIndexStats only
// Add note: "Run kg_community with action='detect' after ingestion for community analysis"
```

**Update kg_ingest_ast return description:**
```typescript
// Add to description:
"After ingestion, optionally run kg_community with action='detect' to build community clusters for architectural analysis queries."
```

**Rationale:** Keep ingestion fast (deterministic AST parsing). Community detection is only needed for architectural/global queries, not for every code navigation query.

---

### Change 6: Fix Memory ↔ KG Data Flow

**Problem:** The `kg_entity_memory_links` table exists in the KG schema but is never populated. When `memory_store` saves a memory, related KG entities (if the KG is populated) are not linked. This breaks the intended cross-module integration.

**Change:** In `memory_store` handler, after creating the memory, check if KG is enabled and search for related KG entities to link.

**File:** `src/tools/knowledge/index.ts` (add to `kg_entity` handler) or `src/tools/memory/index.ts`

**Preferred location:** Add a `linkMemoryToKgEntities(memoryId, content)` utility called from `memory_store` when `kgEnabled`:

```typescript
// In memory_store handler, after memory is stored:
if (config().kgEnabled) {
  try {
    const kgStore = getKgStore();
    const embedding = await embedder.embed(content);
    const related = kgStore.searchSemantic(embedding, { limit: 3, threshold: 0.6 });
    for (const result of related) {
      kgStore.linkEntityToMemory(result.entity.id, memoryId, "related_memory");
    }
  } catch {
    // Non-fatal: KG linking failure should not break memory storage
  }
}
```

**Impact:** Memories stored about code concepts become navigable from KG entities and vice versa. `kg_traverse` results can surface related memories; `memory_recall` graph traversal can reach KG-linked entities.

---

### Change 7: Default Memory Recall Traversal Depth

**Problem:** `memory_recall` defaults to `traverseDepth: 0` (no graph traversal). HippoRAG research shows even one hop of graph traversal improves multi-hop recall significantly.

**File:** `src/tools/memory/index.ts`

```typescript
// Current
traverseDepth: { type: "number", description: "Graph traversal depth for context (0-3)", default: 0 }

// New
traverseDepth: { type: "number", description: "Graph traversal depth for context (0-3, default 1). Depth 1 includes directly linked memories for richer context.", default: 1 }
```

**Rationale:** One hop costs minimal compute (BFS over indexed links) and consistently improves recall quality per HippoRAG. Depth 0 is still available for point queries.

---

## Part 3: Cross-Module Integration Improvements

### Integration A: Testing → KG (Coverage Enhancement)

When `analyze_coverage` identifies untested files, query KG for those files' entity context:

**File:** `src/tools/testing/index.ts` (in `analyze_coverage` handler)

```typescript
// After identifying untested files, if KG enabled:
if (config().kgEnabled && untestedFiles.length > 0) {
  const kgStore = getKgStore();
  for (const file of untestedFiles.slice(0, 10)) {
    const fileEntity = kgStore.findEntityByName(file, "file");
    if (fileEntity) {
      const neighbors = kgStore.traverse(fileEntity.id, 1, 10);
      // Attach neighbors to coverage result for richer test generation context
    }
  }
}
```

**Value:** Test generation for an untested file benefits from knowing what calls it and what it implements — the same structural context the AST KG paper shows improves architectural understanding.

---

### Integration B: Repair → Memory (Persistent Fix Learning)

When `run_with_verification` or `run_tests_with_repair` successfully resolves an error, store the fix as a procedural memory:

**File:** `src/tools/repair/index.ts`

```typescript
// After successful repair:
if (config().memoryEnabled && repairSuccessful) {
  const memStore = getMemoryStore();
  await memStore.insertMemory({
    type: "procedural",
    content: `Fixed ${errorType} in ${language}: ${errorMessage} → ${strategy} (${suggestion})`,
    summary: `${errorType} repair: ${strategy}`,
    confidence: 0.8,
    category: "repair",
    tags: [language, errorType, strategy],
  });
}
```

**Value:** Repair knowledge accumulates across projects and sessions via Memory, rather than only within the per-project SQLite repair history.

---

### Integration C: Spec → Testing (Property Test Generation)

After `dragonfly_spec_generate`, extract pre/post conditions for property-based test hints:

**File:** `src/tools/spec/index.ts`

```typescript
// In spec_generate handler, append to generated prompt:
if (spec.functions?.some(f => f.preconditions || f.postconditions)) {
  prompt += "\n\n## Property-Based Tests\nGenerate property tests for:";
  for (const fn of spec.functions) {
    if (fn.preconditions) prompt += `\n- ${fn.name} preconditions: ${fn.preconditions.join(", ")}`;
    if (fn.postconditions) prompt += `\n- ${fn.name} postconditions: ${fn.postconditions.join(", ")}`;
  }
}
```

**Value:** Closes the loop between specification (what code should do) and testing (verifying it does).

---

## Part 4: Implementation Sequence

Execute in this order to avoid integration issues:

```
Phase 1: Zero-risk descriptor changes (Changes 1, 2)
  → Update tool descriptions only
  → No code changes, no regression risk
  → Immediately improves LLM tool selection

Phase 2: Config rebalancing (Change 3)
  → Update default weights in config.ts
  → All weights remain env-var overridable
  → Test: kg_query results should show higher graph scores

Phase 3: Retrieval tuning (Changes 4, 5)
  → BFS seeds: retrieval.ts (1 line)
  → Remove auto community detection from kg_ingest_ast: index.ts
  → Run test suite after: store.test.ts, bridge.test.ts

Phase 4: Memory integration (Changes 6, 7)
  → Add Memory ↔ KG linking
  → Update recall default traversal depth
  → Integration test: store memory, verify KG link appears

Phase 5: Cross-module integrations (Integrations A, B, C)
  → Testing → KG: analyze_coverage context enrichment
  → Repair → Memory: procedural fix learning
  → Spec → Testing: property test generation hints
  → Each is non-fatal (wrapped in try/catch, doesn't break primary flow)
```

---

## Part 5: Module Enable/Disable Configuration

The recommended `.mcp.json` for the trimmed 8-module configuration:

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
        "DRAGONFLY_MEMORY_ENABLED": "true",
        "DRAGONFLY_FRAMEWORK_ENABLED": "true",
        "DRAGONFLY_STATE_ENABLED": "true",
        "DRAGONFLY_SPEC_ENABLED": "true",
        "DRAGONFLY_REPAIR_ENABLED": "true",
        "DRAGONFLY_KG_ENABLED": "true",
        "DRAGONFLY_KG_SEMANTIC_WEIGHT": "0.35",
        "DRAGONFLY_KG_KEYWORD_WEIGHT": "0.35",
        "DRAGONFLY_KG_GRAPH_WEIGHT": "0.25",
        "DRAGONFLY_KG_COMMUNITY_WEIGHT": "0.05"
      }
    }
  }
}
```

Modules not listed (Evolve, Pipeline, Analytics, Bridge) default to disabled.
AST, Semantic, and Testing are always enabled.

---

## Part 6: Success Criteria

After implementation, the KG module should produce:

1. **No pattern-extracted code entities.** KG entity population for code comes exclusively from `kg_ingest_ast`. Verify by checking entity descriptions — all code entities should have `defined_in`, `file`, `line` properties set by the AST bridge.

2. **Higher graph scores in hybrid results.** With graph weight at 0.25, graph-proximity results should appear in top-5 for structural queries ("what calls AuthService?").

3. **Faster `kg_ingest_ast`.** Without auto community detection, AST bridge completes in O(symbols) rather than O(symbols + graph). Measurable on projects with >500 symbols.

4. **Memory recall at depth=1 returns richer context.** For memories with linked entities, recall should surface related memories one hop away by default.

5. **Cross-module flows non-disruptive.** All integrations (A, B, C) are wrapped in try/catch and never break primary tool responses.

---

## Summary

| Category | Changes |
|---|---|
| Modules removed | Evolve, Pipeline, Analytics, Bridge |
| KG module: keep with changes | Changes 1–7 |
| Tool description changes | 2 (kg_ingest, kg_ingest_ast) |
| Config changes | 4 weight adjustments |
| Code changes | 3 (BFS seeds, community decoupling, memory linking) |
| Default behavior changes | 1 (recall traversal depth) |
| Cross-module integrations | 3 (Testing→KG, Repair→Memory, Spec→Testing) |
| Breaking changes | 0 |
