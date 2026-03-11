# Dragonfly Plugin

Opus-powered MCP plugin: 66 tools across 13 modules. Fully standalone — no `.zen/` submodule.

## Quick Reference

| Item | Value |
|------|-------|
| Package | `@dragonflymcp/plugin` |
| Server name | `dragonfly-server` |
| Tool prefix | `dragonfly_` (framework/state/spec/analytics/bridge/pipeline) |
| Data directory | `data/` (gitignored, created on first run) |
| Templates | `templates/` (bundled, committed to repo) |

## Modules (66 tools)

| Module | Tools | Feature Flag |
|--------|-------|-------------|
| AST | 7 | always on |
| Semantic | 3 | always on |
| Memory | 4 | `DRAGONFLY_MEMORY_ENABLED` |
| Framework | 8 | `DRAGONFLY_FRAMEWORK_ENABLED` |
| State | 8 | `DRAGONFLY_STATE_ENABLED` |
| Evolve | 4 | `DRAGONFLY_EVOLVE_ENABLED` |
| Spec | 6 | `DRAGONFLY_SPEC_ENABLED` |
| Testing | 6 | always on |
| Repair | 5 | `DRAGONFLY_REPAIR_ENABLED` |
| Knowledge Graph | 7 | `DRAGONFLY_KG_ENABLED` |
| Analytics | 2 | `DRAGONFLY_ANALYTICS_ENABLED` |
| Pipeline | 2 | `DRAGONFLY_PIPELINE_ENABLED` |
| Bridge | 4 | `DRAGONFLY_BRIDGE_ENABLED` |

## Installing in a Consuming Project

```bash
npm install --save-dev @dragonflymcp/plugin   # or: file:../dragonfly-plugin
npx dragonfly-init                          # deploys agents, skills, commands, hooks, .mcp.json
```

`dragonfly-init` is idempotent — it skips files that already exist.

## Build & Test

```bash
npm install
npm run build       # tsc — must be 0 errors
npm run test:run    # vitest run — all tests must pass
npm start           # node dist/index.js
```

## Data Layout

```
data/
├── index/          # AST index (rebuilt on demand, can be large)
├── state.db        # health, checkpoints, stories, workflows, specs, repair
└── memory.db       # memories, embeddings, KG entities/relations, vectors
```

All databases are created automatically on first use. The `data/` directory is gitignored.

## Environment Variables

All env vars use `DRAGONFLY_` prefix. Key overrides:

```bash
PROJECT_ROOT                      # working directory (default: cwd)
DRAGONFLY_STATE_DB_PATH           # override state DB path
DRAGONFLY_MEMORY_DB_PATH          # override memory DB path
DRAGONFLY_INDEX_PATH              # override AST index path
DRAGONFLY_FRAMEWORK_CONTENT_ROOT  # override templates path
DRAGONFLY_DEBUG=true              # enable debug logging
```

## Claude Code MCP Config

**Installed as npm dependency (recommended):**
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

**Run from source (development):**
```json
{
  "mcpServers": {
    "dragonfly": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--no-wasm-tier-up",
        "--liftoff-only",
        "/path/to/dragonfly-plugin/dist/index.js"
      ],
      "env": {
        "PROJECT_ROOT": "/path/to/your/project"
      }
    }
  }
}
```

The `--no-wasm-tier-up` and `--liftoff-only` flags are required for tree-sitter WASM stability.
