# Changelog

All notable changes to the Dragonfly MCP plugin are documented in this file.

## v1.3.2 (2026-03-09) — Comprehensive documentation update

### Documentation

- **`docs/repair.md`**: Updated `get_repair_history` parameter reference (uses `errorType`, not `session_id`); expanded integration section with full evolve-from-repair feedback loop description; updated file reference to match actual source files (`repairer.ts`, `memory-capture.ts`).
- **`docs/evolve.md`**: Added `use_memory_test_cases` parameter to `evolve_start`; updated `evolve_start` return fields (`test_cases_total`, `memory_test_cases_loaded`); corrected `evolve_best` return shape (`prompt`, `fitness_score`, `generation`, `improvement_pct`, `initial_prompt`, `total_variants_evaluated`, `skill_saved`, `skill_path`); expanded integration section with repair feedback loop and analytics `evolve_hint` signal; updated file reference to actual source files.
- **`docs/analytics.md`**: Added `evolve_hint` to `dragonfly_learn_patterns` response; updated integration section to describe `computeBenchmarks` usage in `dragonfly_advance_workflow` and the repair → pattern learning pipeline.
- **`docs/bridge.md`**: Added auto-export section describing `bridge_export` response field from `dragonfly_advance_workflow` on workflow completion.
- **`docs/semantic.md`**: Updated architecture diagram to include `EmbeddingRefresher` and `EmbeddingCache`; updated `embed_project` return fields to reflect actual response shape (`chunksEmbedded`, `chunksSkipped`, `filesChanged`, `filesUnchanged`, `totalChunks`, `durationMs`, `cacheHitRate`); updated file reference to include `cache.ts` and `refresher.ts`.
- **`docs/framework.md`**: Added `spec` and `repair` to concept list; updated `dragonfly_start_workflow` return to show `memory_context`; updated `dragonfly_advance_workflow` return to show `testing_guidance` (quality step), `repair_guidance` (failure), `analytics_summary` and `bridge_export` (completion); expanded integration section to document all module connections added in v1.3.0–v1.3.1.
- **`CHANGELOG.md`**: Created (this file) — complete version history from v1.0.0 through current.

---

## v1.3.1 (2026-03-09) — Evolve test case capture from repair events

### New

- **`src/tools/repair/memory-capture.ts`**: `captureEvolveTestCase()` helper that persists repair events to memory as `evolve-test-case` entries. Assigns confidence 0.9 for confirmed fixes and 0.6 for suggested-only. Fire-and-forget (never blocks the caller).

### Changed

- **`repair/index.ts`**: `captureEvolveTestCase()` is now called in three places:
  - `self_debug` — always captures (resolved may be true or false).
  - `run_with_verification` — captures when execution succeeds after a prior failure (`resolved: true`).
  - `run_tests_with_repair` — captures when repair suggestions are generated for test failures (`conceptHint: "quality"`).
- **`memory/store.ts`**: Added `listByCategory(category, limit)` — direct SQL filter without embedding, used by `evolve_start` to load test cases.
- **`evolve/index.ts`**: Added `use_memory_test_cases: boolean` parameter to `evolve_start`. When true, loads up to 20 `evolve-test-case` memories and appends them to `test_cases`. Returns `memory_test_cases_loaded` count in the response. Turns real project failures into evolution training data over time.

---

## v1.3.0 (2026-03-09) — Cross-module integration (Tier 1, 2, 3)

### Tier 1 — Workflow-level integration

- **`dragonfly_start_workflow`** returns `memory_context` containing similar past workflows, outcomes, and similarity scores.
- **`dragonfly_advance_workflow`** on completion returns `analytics_summary` (total_actions, total_workflows, total_cost_usd, quality_approval_rate, failure_rate) and auto-exports high-confidence memories via bridge, returning `bridge_export`.
- **`embed_project`** replaced manual serial loop with EmbeddingRefresher (4-parallel, hash-based change detection, LRU cache).
- **`semantic_search`** and **`find_similar_code`** use cached embedder via `getCachedEmbedder()`.

### Tier 2 — Step-level integration

- **Quality step enrichment**: When the next step's concept is `"quality"`, the enriched prompt is prepended with testing guidance listing `run_tests`, `run_tests_with_repair`, `analyze_coverage`, and `find_untested_files`.
- **Step failure repair guidance**: When a step outcome is `"failed"`, the response includes `repair_guidance` pointing to `self_debug`, `run_tests_with_repair`, and `iterative_refine`.

### Tier 3 — Structural integration

- **Spec concept** added to feature medium and large DSL templates in `workflow-planner.ts`.
- **Repair concept** added to the CONCEPTS registry.
- **`dragonfly_learn_patterns`** returns `evolve_hint` for high-confidence patterns (10 or more occurrences, 80% or higher success rate).

---

## v1.2.1 (2026-03-09) — EmbeddingCache and EmbeddingRefresher utilities

### New

- **`src/tools/semantic/cache.ts`**: Two-tier LRU embedding cache (in-memory Map + optional SQLite persistence). SHA-256 key normalization, TTL expiration (default 7 days), LRU eviction, transparent model wrapping via `wrap()`. 29 tests.
- **`src/tools/semantic/refresher.ts`**: Incremental re-embedding engine. File-hash-based change detection (only re-embeds changed files), Semaphore concurrency control (default 4 parallel embed calls), optional EmbeddingCache integration. 25 tests.

---

## v1.2.0 (2026-03-09) — Evolve improvements, Analytics expansion, Bridge bidirectional, 11 module docs

### Evolve

- Added `applyMutation(prompt, rate)` — EvoPrompting (Chen et al., 2023) sentence-level operators (delete, insert, reorder).
- Added `crossover(parentA, parentB)` for multi-parent prompt recombination.
- Updated `evolve_submit` to generate seed variants from submitted prompts.
- Added `save_as_skill` (boolean) and `skill_name` (string) parameters to `evolve_best`.

### Analytics

- Exposed 3 previously hidden subsystems as MCP tools:
  - **`dragonfly_analyze_workflows`** — `computeBenchmarks` with 6 aggregators: cost, latency p50/p90/p99, approval rates, model usage, failure rates, trends.
  - **`dragonfly_learn_patterns`** — `extractPatterns` + `generateSkill`.
  - **`dragonfly_check_drift`** — `compareDirectories` for detecting configuration divergence.
- Total analytics tools: 2 to 5.

### Bridge

- **`dragonfly_bridge_export`** gained `min_confidence` parameter.
- **`dragonfly_bridge_import`** gained `commit: boolean` and `limit: number` parameters. With `commit: true`, writes matched global memories into local `memory.db` via `MemoryStore.insertMemory()`.
- **`dragonfly_bridge_search`** description clarified as keyword-based (not semantic).

### Documentation

- Created 11 module docs in `docs/`: `ast.md`, `semantic.md`, `memory.md`, `framework.md`, `state.md`, `spec.md`, `testing.md`, `repair.md`, `evolve.md`, `analytics.md`, `bridge.md`.
- Each includes quick reference table, per-tool parameter tables, example return values, academic research with DOIs, configuration env vars, integration with other modules, and file reference table.

### Tests

- 560 tests passing.

---

## v1.1.0 — Pipeline DSL and Knowledge Graph improvements

### Pipeline

- WYSIWID (Meng & Jackson, MIT CSAIL) declarative DSL for workflow composition.
- `parsePipeline`, `validatePipeline`, `generatePlan`.

### Knowledge Graph

- `kg_ingest_ast` bridges AST index to knowledge graph.
- Hybrid search combining semantic, keyword, graph, and community weights.

---

## v1.0.0 — Initial release (13 modules, 66 tools)

| Module | Tools |
|--------|-------|
| AST | 7 |
| Semantic | 3 |
| Memory | 4 |
| Framework | 8 |
| State | 8 |
| Evolve | 4 |
| Spec | 6 |
| Testing | 6 |
| Repair | 5 |
| Knowledge Graph | 7 |
| Analytics | 2 |
| Pipeline | 2 |
| Bridge | 4 |
