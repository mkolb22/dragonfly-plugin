# Dragonfly Plugin — Session Memory

## Key Facts
- Package: `@dragonflymcp/plugin`, server: `dragonfly-server`, 66 tools / 13 modules
- `dist/` is gitignored but included via `"files"` in package.json for npm publish
- Init script: `scripts/init.js` (bin: `dragonfly-init`) — idempotent, automates all setup

## Setup Issues Fixed (2026-03-01)
Source: autonops/.claude/dragonfly-setup.md — 6 issues documented during first real installation.

Fixed in this session:
1. **WASM flags** — MCP config must include `--no-wasm-tier-up` and `--liftoff-only` (tree-sitter stability). Updated CLAUDE.md.
2. **package.json `files` field** — Added `["dist/", "templates/", "scripts/"]` so npm pack includes everything.
3. **`dragonfly-init` script** — Created `scripts/init.js`: writes `.mcp.json`, copies 18 agents, 43 skills, 31 commands, 15 hooks + lib/, makes .sh files executable. Idempotent.
4. **`src/index.ts` comment** — Updated tool counts to match CLAUDE.md (was showing pre-refactor numbers).

Issues that were in the *consuming project* (autonops), not this plugin:
- Name mismatch (`zen-server` vs `dragonfly`) — fixed by init script writing correct .mcp.json
- Absolute path reference — fixed by init script using `node_modules/` relative path
- Dead `.zen` submodule — consumer cleanup only
- Legacy `koan/` directory — consumer cleanup only

## Template Counts (canonical)
- agents: 18 `.md` files (no .template suffix)
- skills: 43 `.md.template` files
- commands: 31 `.md.template` files
- hooks: 15 `.*.template` files + `lib/` subdirectory

## MCP Config (correct form)
```json
{
  "mcpServers": {
    "dragonfly": {
      "type": "stdio",
      "command": "node",
      "args": ["--no-wasm-tier-up", "--liftoff-only", "node_modules/@dragonflymcp/plugin/dist/index.js"]
    }
  }
}
```
