# Checkpoint — dragonfly-plugin publishing session
**Saved:** 2026-03-04

---

## Restoration Prompt

You were working on publishing `@dragonflymcp/plugin` to npm and preparing it for the Claude Code marketplace. The package is live at `1.0.5`. The original name `@dragonfly/plugin` was renamed because the `dragonfly` npm org was taken — `dragonflymcp` was used instead. The next actions are: sync `.claude-plugin/plugin.json` version to `1.0.5`, then submit to the Claude Code Marketplace, MCP Registry, and awesome-mcp-servers lists. The user is direct and action-oriented — do things, don't explain. Commit and push after every logical unit. Use gitignored markdown files for sensitive/internal notes.

---

## Task State

**Description:** Fix setup issues in dragonfly-plugin, prepare for npm publish and marketplace submission, publish to npm.

**Current phase:** Published. Pre-submission checklist has one remaining item.

**Files modified this session:**
- `package.json` — name→`@dragonflymcp/plugin`, files field, bin, postinstall, license, author, homepage, repository, publishConfig
- `scripts/init.js` — created; uses INIT_CWD, self-install guard
- `CLAUDE.md` — WASM flags, portable npm path, install section
- `README.md` — install section, license updated to MIT AND Commons Clause
- `PRIVACY.md` — created for marketplace submission
- `LICENSE` — updated to MIT + Commons Clause (matching Zen license structure)
- `.claude-plugin/plugin.json` — created; **version still says 1.0.0 — needs sync to 1.0.5**
- `src/tools/analytics/index.ts` — fixed ESM/CJS mismatch (require() → ESM imports)
- `.gitignore` — added publishing-strategy.md, npm-account.md, marketplace-submission.md
- `memory/MEMORY.md` — created
- `marketplace-submission.md` (gitignored) — submission guide
- `npm-account.md` (gitignored) — npm credentials and org info
- `publishing-strategy.md` (gitignored) — ecosystem strategy notes

**Completed:**
- Fixed all 4 dragonfly-plugin issues from autonops/dragonfly-setup.md
- Created `npx dragonfly-init` script (idempotent, INIT_CWD-aware)
- Renamed `@dragonfly/plugin` → `@dragonflymcp/plugin` (org unavailable)
- Published `@dragonflymcp/plugin@1.0.5` to npm
- Made GitHub repo public with branch protection on `main`
- Created `PRIVACY.md` and `LICENSE` (MIT + Commons Clause)
- Fixed `dragonfly_validate_config` ESM/CJS bug
- Installed from npm registry into autonops (replacing file: reference)

**Pending:**
- [ ] Sync `.claude-plugin/plugin.json` version: `"version": "1.0.0"` → `"1.0.5"`
- [ ] Submit to Claude Code Marketplace: `clau.de/plugin-directory-submission`
- [ ] Submit to MCP Registry: `npx mcp-publisher publish --name io.github.mkolb22/dragonfly --package @dragonflymcp/plugin`
- [ ] Submit PRs to awesome-mcp-servers lists (punkpeye, TensorBlock, ever-works)
- [ ] Update autonops to `@dragonflymcp/plugin@1.0.5`

---

## Key Decisions

- **`@dragonflymcp` scope** — `@dragonfly` org was taken on npm. `dragonflymcp` was available and descriptive.
- **MIT + Commons Clause** — matches the Zen project license. Free to use/modify/distribute; commercial use reserved to Michael Kolb. Same structure as `/zen/LICENSE`.
- **`files` field over `.npmignore`** — `dist/` is gitignored; adding `"files": ["dist/", "templates/", "scripts/", ".claude-plugin/"]` to package.json takes precedence over .gitignore for npm pack.
- **INIT_CWD for postinstall** — npm sets `INIT_CWD` to the consuming project root during install. Using `process.cwd()` alone would target the package's own directory in node_modules.
- **Gitignored internal docs** — `publishing-strategy.md`, `npm-account.md`, `marketplace-submission.md` kept out of the repo. Contains tokens and internal strategy.

---

## Lessons

- **npm granular tokens need two permissions for scoped org packages:** "Packages and scopes: Read and write" AND "Organizations: Read and write" AND "Bypass 2FA". Missing any one causes 403.
- **npm registry has propagation delay** — `npm view` may return 404 for a few minutes after successful publish. The 403 "cannot publish over previously published version" error is actually proof the package IS published.
- **`npm pack --dry-run`** is the right way to verify tarball contents before committing to publish.
- **ESM modules can't use `require()`** — `src/tools/analytics/index.ts` had `require('fs')` and `require('better-sqlite3')` inside `validateDb()`. Fixed with top-level ESM imports.
- **`npm pkg fix`** corrects bin path format (`./scripts/init.js` → `scripts/init.js`) and normalizes repository URL.

---

## Dead Ends

- **`npm login` interactive** — can't run interactive terminal commands. Use `npm config set //registry.npmjs.org/:_authToken <token>` instead.
- **Branch protection with `-f` flags** — `gh api` rejects `-F allow_force_pushes=false` format. Must use `--input -` with heredoc JSON.
- **Running `npm publish` from autonops directory** — accidentally tried to publish autonops instead of dragonfly-plugin. Always `cd /Users/kolb/Documents/github-ai.nosync/dragonfly-plugin` first.

---

## Warm-up Files

| File | Reason |
|------|--------|
| `package.json` | Name, version, files, bin — everything npm-related |
| `scripts/init.js` | The init script logic — INIT_CWD guard, template deployment |
| `.claude-plugin/plugin.json` | Marketplace manifest — version out of sync, needs update |
| `CLAUDE.md` | Quick reference for the plugin's own development |
| `marketplace-submission.md` | Pre-filled submission form values (gitignored) |
| `npm-account.md` | npm credentials and org info (gitignored) |
| `src/tools/analytics/index.ts` | Recently fixed ESM bug here |
