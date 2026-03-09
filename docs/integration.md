# Integration Architecture

## Overview

Dragonfly's 13 modules started as independent tools — each registered its own MCP handlers, managed its own state, and had no knowledge of the others. v1.3.x wired them together into a connected system. Workflow start now recalls similar past workflows from memory. Workflow completion triggers analytics snapshots and bridge exports. Repair events automatically capture test cases that feed into prompt evolution. This document describes the full integration map, the data flows between modules, and the complete evolve-from-repair feedback loop.

## Module Dependency Graph

```
                          ┌─────────────┐
                          │  Framework  │ (entry point)
                          └──────┬──────┘
               ┌─────────┬──────┼──────┬──────────┐
               ▼          ▼      ▼      ▼          ▼
          ┌────────┐ ┌───────┐ ┌──────┐ ┌─────────┐ ┌────────┐
          │Pipeline│ │ State │ │Memory│ │Analytics│ │ Bridge │
          │ (DSL)  │ │(perst)│ │(outc)│ │(complet)│ │(export)│
          └────────┘ └───┬───┘ └──┬───┘ └────┬────┘ └───┬────┘
                         │        │           │          │
                         │        │     reads ▲    reads ▲
                         │        │     state.db   memory.db
                         │        │
               ┌─────────┘        │
               ▼                  ▼
          ┌─────────┐       ┌──────────┐
          │Semantic │       │Knowledge │
          │(embeddings)     │  Graph   │
          └────┬────┘       └────┬─────┘
               │                 │
          shared by:        ┌────┘
          Memory, KG,       ▼
          Framework    ┌─────────┐
                       │   AST   │
                       │(kg_ingest_ast)
                       └─────────┘

  Standalone chain (wired in v1.3.x):

  Repair ──capture──▶ Memory ──test cases──▶ Evolve ──save_as_skill──▶ Skills ──▶ Framework
                    (evolve-test-case)     (use_memory_test_cases)              (enriched prompts)
```

**Core loop**: Framework calls Pipeline for DSL parsing, State for persistence, and Memory for outcome recording.

**Foundation**: Semantic provides embeddings used by Memory and Knowledge Graph. Knowledge Graph ingests from AST via `kg_ingest_ast`.

**Standalone chain (newly wired)**: Repair captures test cases into Memory. Evolve loads those test cases via `use_memory_test_cases`. Evolved prompts are saved as skills. Framework uses those skills in enriched prompts.

**Analytics** reads from `state.db` events table as a passive observer.

**Bridge** reads from `memory.db` and writes to a global YAML store. Auto-triggered on workflow completion.

## The Core Workflow Loop

1. **`dragonfly_start_workflow`** receives a task description and calls `planWorkflow`, which classifies the task (bugfix, feature, refactor, etc.), selects the appropriate DSL template from the Pipeline module, and builds the step sequence.

2. After planning, the framework calls `recallSimilarWorkflows` from workflow-intelligence. If similar past workflows exist, the response includes `memory_context` with the matching tasks, their outcomes, complexity classifications, and similarity scores.

3. The planned steps are persisted to `session.ts` as a workflow session in `state.db`.

4. **`dragonfly_advance_workflow`** is called repeatedly to move through steps. Each step receives an `enrichedPrompt` combining the task context with relevant skills.

5. When the next step's concept is `"quality"`, the enriched prompt is prepended with testing guidance listing the available testing tools: `run_tests`, `run_tests_with_repair`, `analyze_coverage`, and `find_untested_files`.

6. When a step outcome is `"failed"`, the response includes `repair_guidance` pointing to `self_debug`, `run_tests_with_repair`, and `iterative_refine`.

7. On workflow completion (all steps done), if analytics and state are enabled, the framework instantiates an AnalyticsStore, calls `computeBenchmarks`, and returns `analytics_summary`. If bridge and memory are enabled, it calls `BridgeStore.exportMemories()` with `min_confidence: "high"` and returns `bridge_export`.

## Integration Points Added in v1.3.0

### 1. Memory context on workflow start

- **Location**: `src/tools/framework/index.ts`, `dragonfly_start_workflow` handler
- **Trigger**: After `planWorkflow` completes, when memory is enabled
- **What it does**: Calls `recallSimilarWorkflows` to search memory for past workflows with similar task descriptions
- **Returns**: `memory_context` object with `found` (boolean), `hint` (string summary), and `recent[]` (array of matching workflows with task, outcome, complexity, and similarity score)

### 2. Testing guidance injection

- **Location**: `src/tools/framework/index.ts`, `dragonfly_advance_workflow` handler
- **Trigger**: When `nextStep.concept === "quality"`
- **What it does**: Prepends testing guidance to `enrichedPrompt` listing the four testing tools: `run_tests`, `run_tests_with_repair`, `analyze_coverage`, `find_untested_files`
- **Returns**: Modified `nextStep.enrichedPrompt` with testing guidance prepended

### 3. Repair guidance on failure

- **Location**: `src/tools/framework/index.ts`, `dragonfly_advance_workflow` handler
- **Trigger**: When `outcome === "failed"`
- **What it does**: Constructs a `repair_guidance` string directing the agent to self_debug, run_tests_with_repair, or iterative_refine
- **Returns**: `repair_guidance` string in the advance response

### 4. Analytics snapshot on completion

- **Location**: `src/tools/framework/index.ts`, `dragonfly_advance_workflow` handler
- **Trigger**: When workflow completes and both `analyticsEnabled` and `stateEnabled` are true
- **What it does**: Instantiates AnalyticsStore, calls `computeBenchmarks` against the state database
- **Returns**: `analytics_summary` with `total_actions`, `total_workflows`, `total_cost_usd`, `quality_approval_rate`, `failure_rate`

### 5. Bridge auto-export on completion

- **Location**: `src/tools/framework/index.ts`, `dragonfly_advance_workflow` handler
- **Trigger**: When workflow completes and both `bridgeEnabled` and `memoryEnabled` are true
- **What it does**: Calls `BridgeStore.exportMemories()` with `min_confidence: "high"` for the current project
- **Returns**: `bridge_export` with exported count, project name, and categories

### 6. EmbeddingCache integration

- **Location**: `src/tools/semantic/index.ts`
- **Trigger**: On module initialization
- **What it does**: Creates a lazy-loaded EmbeddingCache backed by the `memoryDbPath` SQLite database. `getCachedEmbedder()` wraps `getSharedEmbedder()` with transparent LRU caching (SHA-256 keys, 7-day TTL)
- **Returns**: Cached embedder used by `semantic_search` and `find_similar_code`

### 7. EmbeddingRefresher integration

- **Location**: `src/tools/semantic/index.ts`, `embed_project` handler
- **Trigger**: When `embed_project` is called
- **What it does**: Replaced the manual serial embed loop with `EmbeddingRefresher(projectRoot, store, getSharedEmbedder(), { concurrency: 4, cache: getCache() })`. Uses file-hash-based change detection to skip unchanged files
- **Returns**: `chunksEmbedded`, `chunksSkipped`, `filesChanged`, `filesUnchanged`, `cacheHitRate`, `durationMs`

### 8. Spec in feature DSL

- **Location**: `src/tools/framework/workflow-planner.ts`
- **Trigger**: When task is classified as `feature` with medium or large complexity
- **What it does**: Inserts the `spec` concept into the pipeline DSL
- **Templates**:
  - Feature medium: `"story | spec | architecture | implementation | quality | version"`
  - Feature large: `"story | spec | parallel(architecture, security) | implementation | quality | version"`

### 9. evolve_hint in learn_patterns

- **Location**: `src/tools/analytics/index.ts`, `dragonfly_learn_patterns` handler
- **Trigger**: When extracted patterns include entries with 10 or more occurrences and 80% or higher success rate
- **What it does**: Returns an `evolve_hint` suggesting prompt optimization
- **Returns**: `evolve_hint` with `message`, `suggested_concepts`, and `workflow`

## The Evolve-from-Repair Feedback Loop

This is the key long-running feedback loop that turns real project failures into optimized prompts over weeks and months.

```
Stage 1 -- Capture (automatic, zero-cost, fire-and-forget)
  +---------------------------------------------------------+
  | self_debug         -> always captures (resolved: false)  |
  | run_with_verif.    -> captures on success-after-failure  |
  |                      (resolved: true)                    |
  | run_tests_with_r.  -> captures test failure + suggestion |
  |                      (conceptHint: "quality")            |
  +----------------------------+----------------------------+
                               | captureEvolveTestCase()
                               | memory: category="evolve-test-case"
                               v
                         memory.db
                         (accumulates over weeks/months)

Stage 2 -- Signal (threshold-triggered)
  dragonfly_learn_patterns
    -> evolve_hint fires when >=10 high-confidence patterns
    -> "N patterns ready for optimization. Use evolve_start."

Stage 3 -- Evolve (Claude in the loop -- required)
  evolve_start
    concept_name: "implementation-concept"
    initial_prompt: <current skill content>
    test_cases: [your explicit cases]
    use_memory_test_cases: true   <-- loads real project failures
    -> memory_test_cases_loaded: 23

  [Claude evaluates variants across generations]

  evolve_best
    save_as_skill: true
    -> .claude/skills/implementation-concept.md updated

Stage 4 -- Measure
  dragonfly_analyze_workflows
    -> compare quality_approval_rate before vs after skill update
```

### Design rationale

**Stage 1 is zero-cost and automatic.** `captureEvolveTestCase()` is fire-and-forget. It never blocks the repair tools, never slows down debugging, and never requires the user to opt in. Memory accumulation is a side effect of normal repair work.

**Stage 2 prevents premature optimization.** The threshold of 10 or more high-confidence patterns ensures that evolve_hint only fires when there is enough training data to produce meaningful improvements. Optimizing on two examples would overfit.

**Stage 3 requires Claude.** Fitness scoring for prompt variants cannot be automated without semantic judgment. A human-in-the-loop (via Claude) evaluates whether a mutated prompt actually produces better code. This is the EvoPrompting model from Chen et al. (2023) — genetic operators generate candidates, but an LLM scores them.

**Stage 4 closes the measurement loop.** `quality_approval_rate` from `dragonfly_analyze_workflows` is the ground truth signal. If the evolved skill improves approval rates, the optimization worked. If not, revert.

### Confidence levels

- **0.9** — Assigned to confirmed fixes. The repair was applied and the code ran successfully afterward (`resolved: true`). These carry high weight during evolution because they represent proven solutions.
- **0.6** — Assigned to suggestions only. The repair tool generated a suggestion but it was not verified as working (`resolved: false` or suggestion-only context). These still provide useful signal but are weighted lower during fitness evaluation.

### Project specificity

Skills evolved with `use_memory_test_cases: true` reflect this project's actual failure patterns, not generic best practices. The test cases come from real bugs, real test failures, and real repair events specific to the codebase. As a result, evolved skills will appear as "extra" files when running `dragonfly_check_drift` against the base templates. This is expected and documented — project-specific skills are a feature, not drift.

## Module Interaction Matrix

| Module | Calls | Called by |
|--------|-------|-----------|
| Framework | Pipeline (DSL), State (persist), Memory (outcomes), Analytics (completion), Bridge (export) | -- (entry point) |
| Pipeline | -- | Framework |
| State | -- | Framework, Analytics (reads) |
| Memory | -- | Framework (outcomes), Workflow Intelligence, Bridge (import), Evolve (test cases) |
| Analytics | State (reads events) | Framework (completion), dragonfly_learn_patterns (manual) |
| Bridge | Memory (reads/writes) | Framework (auto-export on complete) |
| Repair | Memory (test case capture) | Framework (repair_guidance suggests these tools) |
| Evolve | Memory (use_memory_test_cases) | Analytics (evolve_hint suggests), Framework (skills saved here) |
| Semantic | -- (embeddings shared via getSharedEmbedder) | Memory, KG, Framework (embed_project) |
| Knowledge Graph | AST (kg_ingest_ast), Memory (autoLink) | -- |
| AST | -- | Knowledge Graph |
| Testing | -- | Framework (repair_guidance suggests, quality enriched prompt) |
| Spec | -- | Framework (spec concept in DSL) |

## AdvanceResult Response Fields

All fields returned by `dragonfly_advance_workflow` as of v1.3.x:

| Field | When Present | Description |
|-------|-------------|-------------|
| `workflowId` | Always | Session ID |
| `completedStep` | Always | Step state at time of completion |
| `nextStep` | When not last step | Next concept with enrichedPrompt and skills |
| `nextStep.enrichedPrompt` | When concept is quality | Prepended with testing guidance (run_tests, run_tests_with_repair, analyze_coverage, find_untested_files) |
| `workflowComplete` | Always | True when all steps done or session failed |
| `summary` | Always | totalSteps, completedSteps, failedSteps, totalDurationMs |
| `failureHints` | On failure, when memory has past data | Past similar failures from memory |
| `repair_guidance` | On failure | Hints pointing to self_debug, run_tests_with_repair, iterative_refine |
| `syncRules` | When sync rules match | Matched rules with actions and autoAdvance |
| `checkpoint_prompt` | On success or completion | Trigger and message for checkpoint |
| `analytics_summary` | On completion (analyticsEnabled) | total_actions, total_workflows, total_cost_usd, quality_approval_rate, failure_rate |
| `bridge_export` | On completion (bridgeEnabled, memories exported) | Exported count, project name, categories |

## StartWorkflow Response Fields

All fields returned by `dragonfly_start_workflow` as of v1.3.x:

| Field | When Present | Description |
|-------|-------------|-------------|
| `workflowId` | Always | Session ID |
| `task` | Always | Original task string |
| `plan` | Always | taskType, complexity, totalSteps, reasoning, pipelineDsl, estimatedDurationMs |
| `firstStep` | When plan has steps | concept, agent, model, enrichedPrompt, skills |
| `stepOverview` | Always | All steps with concept, agent, model, status |
| `memory_context` | When memoryEnabled and similar past workflows exist | found, hint, recent[] with task, outcome, complexity, similarity |

## Configuration Reference

The `.mcp.json` env block controls which integrations are active. Feature flags and their defaults:

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
        "PROJECT_ROOT": "/path/to/project",
        "DRAGONFLY_MEMORY_ENABLED": "true",
        "DRAGONFLY_FRAMEWORK_ENABLED": "true",
        "DRAGONFLY_STATE_ENABLED": "true",
        "DRAGONFLY_EVOLVE_ENABLED": "true",
        "DRAGONFLY_SPEC_ENABLED": "true",
        "DRAGONFLY_REPAIR_ENABLED": "true",
        "DRAGONFLY_KG_ENABLED": "true",
        "DRAGONFLY_ANALYTICS_ENABLED": "true",
        "DRAGONFLY_PIPELINE_ENABLED": "true",
        "DRAGONFLY_BRIDGE_ENABLED": "true",
        "DRAGONFLY_STATE_DB_PATH": "data/state.db",
        "DRAGONFLY_MEMORY_DB_PATH": "data/memory.db",
        "DRAGONFLY_INDEX_PATH": "data/index",
        "DRAGONFLY_DEBUG": "false"
      }
    }
  }
}
```

**Flags that affect integration behavior:**

- `DRAGONFLY_MEMORY_ENABLED` — Required for `memory_context` in start_workflow, `failureHints` in advance_workflow, and `bridge_export` on completion.
- `DRAGONFLY_ANALYTICS_ENABLED` + `DRAGONFLY_STATE_ENABLED` — Both required for `analytics_summary` on workflow completion.
- `DRAGONFLY_BRIDGE_ENABLED` + `DRAGONFLY_MEMORY_ENABLED` — Both required for `bridge_export` on workflow completion.
- `DRAGONFLY_EVOLVE_ENABLED` — Required for `use_memory_test_cases` and `save_as_skill` in evolve tools.
- `DRAGONFLY_REPAIR_ENABLED` — Required for `captureEvolveTestCase` (Stage 1 of the evolve loop).

AST, Semantic, and Testing modules are always enabled and do not have feature flags.

## File Reference

| File | Role in Integration |
|------|---------------------|
| `src/tools/framework/index.ts` | Orchestration entry point — wires memory, analytics, bridge, testing guidance, repair guidance |
| `src/tools/framework/workflow-intelligence.ts` | `recallSimilarWorkflows`, `recordWorkflowOutcome`, `getFailureHints` |
| `src/tools/framework/workflow-planner.ts` | DSL templates — spec concept in feature workflows |
| `src/tools/framework/session.ts` | `advanceStepWithIntelligence` — memory recording |
| `src/tools/repair/memory-capture.ts` | `captureEvolveTestCase` — Stage 1 of evolve loop |
| `src/tools/semantic/cache.ts` | EmbeddingCache — LRU + SQLite |
| `src/tools/semantic/refresher.ts` | EmbeddingRefresher — incremental re-embedding |
| `src/tools/memory/store.ts` | `listByCategory` — used by evolve_start for test case loading |
| `src/tools/analytics/index.ts` | `evolve_hint` in dragonfly_learn_patterns |
| `src/tools/analytics/aggregators.ts` | `computeBenchmarks` — called on workflow completion |
| `src/tools/bridge/store.ts` | `exportMemories` — called on workflow completion |
