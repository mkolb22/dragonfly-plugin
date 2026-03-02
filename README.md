# Dragonfly

Sonnet-optimized MCP plugin for Claude Code: 66 tools across 13 modules covering code intelligence, semantic search, persistent memory, and workflow orchestration.

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
| AST | 7 | Code intelligence through AST analysis |
| Semantic | 3 | Semantic search with embeddings |
| Memory | 4 | Persistent semantic memory |
| Framework | 8 | Workflow orchestration |
| State | 8 | Health, checkpoints, stories |
| Evolve | 4 | Prompt optimization |
| Spec | 6 | Specification DSL for code generation |
| Testing | 6 | Test generation, execution, coverage |
| Repair | 5 | Self-repair and iterative refinement |
| Knowledge Graph | 7 | Entity/relation management with hybrid search |
| Analytics | 2 | Cost and performance observability |
| Pipeline | 2 | Composition DSL and execution planning |
| Bridge | 4 | Cross-project memory export/import/search |

## What Gets Deployed

| Destination | Count | Source |
|-------------|-------|--------|
| `.claude/agents/` | 18 agents | `templates/agents/*.md` |
| `.claude/skills/` | 43 skills | `templates/skills/*.md.template` |
| `.claude/commands/` | 31 commands | `templates/commands/*.md.template` |
| `.claude/hooks/` | 15 hooks + lib | `templates/hooks/*.template` |
| `.mcp.json` | MCP server config | written by init script |

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

MIT
