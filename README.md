# Dragonfly

Sonnet-optimized MCP plugin for Claude Code: 74 tools across 13 modules covering code intelligence, semantic search, persistent memory, and workflow orchestration.

## Installation

```bash
npm install --save-dev @dragonflymcp/plugin
```

The `postinstall` script runs automatically and deploys all agents, skills, commands, hooks, and `.mcp.json` into your project. Restart Claude Code to activate.

To re-run setup manually at any time:

```bash
npx dragonfly-init
```

Setup is idempotent — existing files are never overwritten.

## Modules

| Module | Tools | Description |
|--------|-------|-------------|
| AST | 7 | Code intelligence through AST analysis — call graphs, symbol lookup, reference finding |
| Semantic | 3 | Semantic search with LRU-cached embeddings and incremental re-embedding |
| Memory | 4 | Persistent semantic memory with episodic/semantic/procedural categorization |
| Framework | 8 | Workflow orchestration with memory context, analytics snapshots, and bridge export |
| State | 8 | Checkpoints, stories, provenance events, workflow session persistence |
| Evolve | 4 | Genetic algorithm prompt optimization with real-failure training data |
| Spec | 6 | Formal specification DSL for type-safe code generation |
| Testing | 6 | Test generation, execution, coverage analysis, untested file discovery |
| Repair | 5 | Self-repair, iterative refinement, test-driven repair with evolve test case capture |
| Knowledge Graph | 7 | Entity/relation management with hybrid search (semantic + keyword + graph) |
| Analytics | 5 | Cost/latency/quality benchmarks, pattern learning with evolve hints, drift detection |
| Pipeline | 2 | WYSIWID composition DSL and execution planning |
| Bridge | 4 | Cross-project memory federation with auto-export on workflow completion |

## Integration Architecture

As of v1.3.x, modules are wired together into a connected system. Key integration points:

- **Memory context on workflow start** — `dragonfly_start_workflow` recalls similar past workflows and returns `memory_context` with outcomes and similarity scores.
- **Testing guidance injection** — Quality steps receive enriched prompts listing `run_tests`, `run_tests_with_repair`, `analyze_coverage`, and `find_untested_files`.
- **Repair guidance on failure** — Failed steps return `repair_guidance` pointing to `self_debug`, `run_tests_with_repair`, and `iterative_refine`.
- **Analytics snapshot on completion** — Completed workflows return `analytics_summary` with cost, latency, and quality metrics.
- **Bridge auto-export on completion** — High-confidence memories are automatically exported to the global bridge store.
- **EmbeddingCache and EmbeddingRefresher** — `embed_project` uses hash-based change detection and 4-parallel embedding with LRU caching.
- **Spec in feature DSL** — Medium and large feature workflows include the `spec` concept in their pipeline templates.
- **Evolve hints from analytics** — `dragonfly_learn_patterns` returns `evolve_hint` when high-confidence patterns accumulate.

See [docs/integration.md](docs/integration.md) for the full integration map, data flows, and response field reference.

## The Evolve-from-Repair Loop

Repair events are automatically captured as `evolve-test-case` memories with no user action required. Over time, these accumulate real failure patterns from the project. When `dragonfly_learn_patterns` detects enough high-confidence patterns, it returns an `evolve_hint` suggesting prompt optimization. Running `evolve_start` with `use_memory_test_cases: true` loads these real failures as training data, producing project-specific prompt variants that Claude evaluates across generations. The result is skills that reflect actual project failure patterns rather than generic best practices.

See [docs/integration.md](docs/integration.md) for the full feedback loop diagram and design rationale.

## What Gets Deployed

| Destination | Count | Source |
|-------------|-------|--------|
| `.claude/agents/` | 18 agents | `templates/agents/*.md` |
| `.claude/skills/` | 43 skills | `templates/skills/*.md.template` |
| `.claude/commands/` | 31 commands | `templates/commands/*.md.template` |
| `.claude/hooks/` | 15 hooks + lib | `templates/hooks/*.template` |
| `.mcp.json` | MCP server config | written by init script |

## Documentation

| File | Description |
|------|-------------|
| [docs/ast.md](docs/ast.md) | AST analysis tools — call graphs, symbols, references |
| [docs/semantic.md](docs/semantic.md) | Semantic search, embedding cache, incremental re-embedding |
| [docs/memory.md](docs/memory.md) | Persistent memory — store, recall, forget, evolve |
| [docs/framework.md](docs/framework.md) | Workflow orchestration — start, advance, plan, compose |
| [docs/state.md](docs/state.md) | Checkpoints, stories, provenance, sessions |
| [docs/spec.md](docs/spec.md) | Specification DSL — generate, save, import, export |
| [docs/testing.md](docs/testing.md) | Test generation, execution, coverage, untested files |
| [docs/repair.md](docs/repair.md) | Self-debug, iterative refine, test-driven repair |
| [docs/evolve.md](docs/evolve.md) | Genetic prompt optimization — start, submit, best, status |
| [docs/analytics.md](docs/analytics.md) | Benchmarks, pattern learning, drift detection |
| [docs/bridge.md](docs/bridge.md) | Cross-project memory export, import, search |
| [docs/integration.md](docs/integration.md) | Full integration architecture and data flow reference |

## Feature Flags

Modules are opt-in via environment variables. Set in your `.mcp.json` `env` block or shell:

```bash
DRAGONFLY_MEMORY_ENABLED=true
DRAGONFLY_FRAMEWORK_ENABLED=true
DRAGONFLY_STATE_ENABLED=true
DRAGONFLY_EVOLVE_ENABLED=true
DRAGONFLY_SPEC_ENABLED=true
DRAGONFLY_REPAIR_ENABLED=true
DRAGONFLY_KG_ENABLED=true
DRAGONFLY_ANALYTICS_ENABLED=true
DRAGONFLY_PIPELINE_ENABLED=true
DRAGONFLY_BRIDGE_ENABLED=true
```

AST, Semantic, and Testing modules are always enabled.

## Environment Variables

```bash
PROJECT_ROOT                      # working directory (default: cwd)
DRAGONFLY_STATE_DB_PATH           # override state DB path
DRAGONFLY_MEMORY_DB_PATH          # override memory DB path
DRAGONFLY_INDEX_PATH              # override AST index path
DRAGONFLY_FRAMEWORK_CONTENT_ROOT  # override templates path
DRAGONFLY_DEBUG=true              # enable debug logging
```

## Data Directory

Dragonfly stores all runtime state in `data/` at the project root:

```
data/
├── index/       # AST index (rebuilt via index_project tool)
├── state.db     # checkpoints, stories, workflows, specs
└── memory.db    # memories, embeddings, knowledge graph
```

Add `data/` to `.gitignore`. It is created automatically on first run.

## MCP Configuration

The init script writes this to `.mcp.json`:

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
      ]
    }
  }
}
```

The WASM flags are required for tree-sitter stability.

## Building from Source

```bash
git clone https://github.com/mkolb22/dragonfly-plugin
cd dragonfly-plugin
npm install
npm run build    # tsc — must be 0 errors
npm run test:run # vitest run
```

## License

[MIT AND Commons Clause](./LICENSE) — free to use, modify, and distribute. Commercial use requires licensor approval. Copyright 2026 Michael Kolb.
