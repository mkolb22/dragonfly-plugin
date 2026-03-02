# dragonfly-init — What It Fixes and What It Doesn't

> Written after the autonops project setup (2026-03-01).
> Documents every issue the init script resolves, the residual steps that
> still require manual action, and why each decision was made.

---

## What `dragonfly-init` Fixes Automatically

Running `npx dragonfly-init` (or installing the package, which triggers
`postinstall`) resolves the five silent-failure causes found in production:

---

### Fix 1 — Missing `.mcp.json`

**Problem:** Without `.mcp.json`, Claude Code has no MCP server to connect to.
The plugin is installed in `node_modules` but never activated.

**What init does:**
```json
// .mcp.json written by init (skipped if file already exists)
{
  "mcpServers": {
    "dragonfly": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--no-wasm-tier-up",
        "--liftoff-only",
        "node_modules/@dragonfly/plugin/dist/index.js"
      ]
    }
  }
}
```

**Key decisions:**
- Server name is `dragonfly` — must match `enabledMcpjsonServers` in
  `.claude/settings.local.json` exactly. A mismatch causes the server to
  appear in `/mcp` as disabled.
- Path is relative (`node_modules/...`) — portable across machines and CI,
  unlike an absolute path to a sibling repository.
- `--no-wasm-tier-up --liftoff-only` — Node flags that prevent V8 from
  spending time on WebAssembly tier-up during startup, reducing cold-start
  latency for the MCP server process.
- **Skips if `.mcp.json` already exists** — avoids overwriting a customized
  config on re-install or `npm install` runs.

---

### Fix 2 — Agents Not Appearing in `/agents`

**Problem:** Claude Code discovers subagents by scanning `.claude/agents/*.md`.
The plugin ships 18 agent definitions in `templates/agents/` but they are
never automatically placed in the project.

**What init does:**
Copies all `templates/agents/*.md` files to `.claude/agents/`, skipping any
that already exist (idempotent). Agents installed:

| Agent | Purpose |
|---|---|
| `story-concept` | Requirements capture |
| `architecture-concept` | System design |
| `implementation-concept` | Code generation |
| `quality-concept` | Review and testing |
| `version-concept` | Git operations |
| `context-concept` | Context window management |
| `code-analysis-concept` | Codebase context gathering |
| `verification-concept` | Multi-pass independent review |
| `security-concept` | Threat modeling and vulnerability scanning |
| `documentation-concept` | Comprehensive doc generation |
| `research-concept` | Open-ended investigation |
| `checkpoint-concept` | Session state preservation |
| `debate-advocate` | Proposes architectural approach |
| `debate-critic` | Challenges assumptions |
| `debate-synthesis` | Resolves debate, produces final decision |
| `compete-control` | Generates code without dragonfly tools (baseline) |
| `compete-treatment` | Generates code with full dragonfly tools |
| `compete-evaluator` | Scores outputs across 6 quality dimensions |

---

### Fix 3 — Skills Not Found by Agents

**Problem:** Agents reference skills by name (e.g., `project-structure`,
`security-vulnerability-scanning`). If `.claude/skills/` is empty, agent
skill lookups fail silently — no error is raised, the skill is simply not
loaded.

**What init does:**
Copies `templates/skills/*.md.template` → `.claude/skills/*.md`, stripping
the `.template` suffix. The extension stripping is critical: Claude Code looks
for `project-structure.md`, not `project-structure.md.template`.

43 skills installed covering: security scanning, error classification,
code templates, refactoring patterns, test generation, branch strategy,
semantic memory, schema validation, performance estimation, and more.

---

### Fix 4 — Slash Commands Missing from `/commands`

**Problem:** Commands like `/feature`, `/checkpoint`, `/health`, `/recall`,
`/restore` are defined in `templates/commands/`. Without copying them, none
appear in Claude Code's command palette.

**What init does:**
Copies `templates/commands/*.md.template` → `.claude/commands/*.md`,
stripping the `.template` suffix. 31 commands installed.

---

### Fix 5 — Hooks Not Executing

**Problem:** Dragonfly hooks drive lifecycle automation: session-start loads
context health, pre-compact saves a checkpoint, subagent-stop records
provenance. Without `.claude/hooks/`, none fire.

**What init does:**
- Copies `templates/hooks/*.template` → `.claude/hooks/` (stripping `.template`)
- Sets `chmod 755` on all `.sh` files — hooks that aren't executable are
  silently skipped by Claude Code
- Copies `templates/hooks/lib/` → `.claude/hooks/lib/` (shared shell library)

16 hooks installed: `session-start.sh`, `pre-compact.sh`, `stop.sh`,
`subagent-stop.sh`, `concept-complete.sh`, `post-commit.sh`,
`post-tool-use.sh`, `post-tool-structure-check.sh`, `statusline.sh`, and more.

---

## What `dragonfly-init` Does NOT Fix

These steps require manual action after running init:

---

### Manual Step 1 — Enable the MCP server in Claude Code

`.mcp.json` registers the server, but Claude Code requires it to be
explicitly enabled per-project. Open the MCP dialog (`/mcp`) and enable
`dragonfly`. This writes to `.claude/settings.local.json`:

```json
{
  "enabledMcpjsonServers": ["dragonfly"]
}
```

**Why init can't do this:** Claude Code manages `settings.local.json`
directly and doesn't expose a programmatic API for enabling MCP servers.
The file must be written by Claude Code itself through the UI.

**Critical:** The server name in `enabledMcpjsonServers` must exactly match
the key in `.mcp.json` (`"dragonfly"`). A mismatch leaves the plugin
invisible in `/mcp` with no error message.

---

### Manual Step 2 — Restart Claude Code

After init, Claude Code must be restarted to:
- Connect to the new MCP server process
- Scan `.claude/agents/` for new subagents
- Load `.claude/commands/` for slash commands
- Register `.claude/hooks/` for lifecycle events

There is no API to hot-reload these. Exit (`/exit`) and reopen.

---

### Manual Step 3 — Add `data/` to `.gitignore`

Dragonfly writes runtime state to `data/` in the project root:

```
data/
├── index/       # AST index
├── state.db     # checkpoints, stories, workflows, specs
└── memory.db    # memories, embeddings, knowledge graph
```

This directory should not be committed. Add it to `.gitignore`:
```
data/
```

Init doesn't touch `.gitignore` to avoid unexpected side effects on
projects that already have a `data/` directory with different semantics.

---

### Manual Step 4 — Clean up legacy zen artifacts (migration only)

If migrating from the old `zen-server` / `.zen` submodule setup:

**Remove `.zen` submodule (3 steps, all required):**
```bash
git submodule deinit -f .zen
git rm -f .zen
rm -rf .git/modules/.zen
```
Skipping step 3 causes `git submodule add` to fail at that path in the future.

**Archive the `koan/` directory:**
```bash
mkdir -p .archive && mv koan/ .archive/koan
echo ".archive/" >> .gitignore
```

**Remove stale `.mcp.json` server name** (if it was `zen-server`):
Init skips `.mcp.json` if it already exists. If the existing file has
`"zen-server"` as the server name, update it manually to `"dragonfly"`.

---

## Idempotency

Init is safe to run multiple times. Every copy operation checks `existsSync`
before writing. Running `npm install` repeatedly will not overwrite
customized agent, skill, command, or hook files.

To force-reinstall a specific file, delete it and re-run:
```bash
rm .claude/agents/implementation-concept.md
node node_modules/@dragonfly/plugin/scripts/init.js
```

---

## Running Init Manually

```bash
# After npm install (also runs automatically via postinstall):
node node_modules/@dragonfly/plugin/scripts/init.js

# Or via npx if installed globally:
npx dragonfly-init
```

Expected output on a fresh project:
```
[write] .mcp.json
[agents] 18 copied → .claude/agents/
[skills] 43 copied → .claude/skills/
[commands] 31 copied → .claude/commands/
[hooks] 16 copied → .claude/hooks/
[hooks/lib] copied → .claude/hooks/lib/

Dragonfly setup complete. Restart Claude Code to activate the MCP server.
```

Expected output on an already-configured project:
```
[skip] .mcp.json already exists — review manually if needed
[agents] 0 copied → .claude/agents/
[skills] 0 copied → .claude/skills/
[commands] 0 copied → .claude/commands/
[hooks] 0 copied → .claude/hooks/

Dragonfly setup complete. Restart Claude Code to activate the MCP server.
```

---

*Last updated: 2026-03-01. Written against @dragonfly/plugin v1.0.0.*
