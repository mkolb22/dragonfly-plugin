#!/usr/bin/env node
/**
 * dragonfly-init — one-shot setup for consuming projects
 *
 * Run from the project root after installing @dragonfly/plugin:
 *   npx dragonfly-init
 *
 * Steps:
 *   1. Write .mcp.json
 *   2. Copy agents → .claude/agents/
 *   3. Copy skills → .claude/skills/  (strip .template suffix)
 *   4. Copy commands → .claude/commands/ (strip .template suffix)
 *   5. Copy hooks → .claude/hooks/     (strip .template suffix, chmod +x *.sh)
 *   6. Copy hooks/lib → .claude/hooks/lib/
 */

import { fileURLToPath } from 'url';
import { dirname, join, basename, resolve } from 'path';
import {
  existsSync, mkdirSync, copyFileSync, chmodSync,
  readdirSync, cpSync, writeFileSync,
} from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');   // node_modules/@dragonfly/plugin

// When running as a postinstall hook, npm sets INIT_CWD to the directory
// where `npm install` was invoked (the consuming project root). Use it
// preferentially over cwd(), which points to the package dir inside node_modules.
const projectRoot = process.env.INIT_CWD ?? process.cwd();

// Guard: skip if we'd be writing into our own package (dev npm install).
if (projectRoot === pkgRoot || resolve(projectRoot) === resolve(pkgRoot)) {
  process.exit(0);
}

function ensure(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

// ── Step 1: .mcp.json ────────────────────────────────────────────────────────
const mcpPath = join(projectRoot, '.mcp.json');
if (existsSync(mcpPath)) {
  log(`[skip] .mcp.json already exists — review manually if needed`);
} else {
  const mcpConfig = {
    mcpServers: {
      dragonfly: {
        type: 'stdio',
        command: 'node',
        args: [
          '--no-wasm-tier-up',
          '--liftoff-only',
          'node_modules/@dragonfly/plugin/dist/index.js',
        ],
      },
    },
  };
  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
  log(`[write] .mcp.json`);
}

// ── Step 2: Agents ───────────────────────────────────────────────────────────
const agentsSrc = join(pkgRoot, 'templates', 'agents');
const agentsDst = join(projectRoot, '.claude', 'agents');
ensure(agentsDst);
let agentCount = 0;
for (const file of readdirSync(agentsSrc)) {
  if (!file.endsWith('.md')) continue;
  const dst = join(agentsDst, file);
  if (!existsSync(dst)) {
    copyFileSync(join(agentsSrc, file), dst);
    agentCount++;
  }
}
log(`[agents] ${agentCount} copied → .claude/agents/`);

// ── Step 3: Skills ───────────────────────────────────────────────────────────
const skillsSrc = join(pkgRoot, 'templates', 'skills');
const skillsDst = join(projectRoot, '.claude', 'skills');
ensure(skillsDst);
let skillCount = 0;
for (const file of readdirSync(skillsSrc)) {
  if (!file.endsWith('.md.template')) continue;
  const dstName = basename(file, '.template'); // strip .template → keep .md
  const dst = join(skillsDst, dstName);
  if (!existsSync(dst)) {
    copyFileSync(join(skillsSrc, file), dst);
    skillCount++;
  }
}
log(`[skills] ${skillCount} copied → .claude/skills/`);

// ── Step 4: Commands ─────────────────────────────────────────────────────────
const commandsSrc = join(pkgRoot, 'templates', 'commands');
const commandsDst = join(projectRoot, '.claude', 'commands');
ensure(commandsDst);
let commandCount = 0;
for (const file of readdirSync(commandsSrc)) {
  if (!file.endsWith('.md.template')) continue;
  const dstName = basename(file, '.template');
  const dst = join(commandsDst, dstName);
  if (!existsSync(dst)) {
    copyFileSync(join(commandsSrc, file), dst);
    commandCount++;
  }
}
log(`[commands] ${commandCount} copied → .claude/commands/`);

// ── Step 5: Hooks ────────────────────────────────────────────────────────────
const hooksSrc = join(pkgRoot, 'templates', 'hooks');
const hooksDst = join(projectRoot, '.claude', 'hooks');
ensure(hooksDst);
let hookCount = 0;
for (const file of readdirSync(hooksSrc)) {
  if (!file.endsWith('.template')) continue;
  const dstName = basename(file, '.template');
  const dst = join(hooksDst, dstName);
  if (!existsSync(dst)) {
    copyFileSync(join(hooksSrc, file), dst);
    if (dstName.endsWith('.sh')) {
      chmodSync(dst, 0o755);
    }
    hookCount++;
  }
}
log(`[hooks] ${hookCount} copied → .claude/hooks/`);

// ── Step 6: hooks/lib ────────────────────────────────────────────────────────
const libSrc = join(hooksSrc, 'lib');
const libDst = join(hooksDst, 'lib');
if (existsSync(libSrc) && !existsSync(libDst)) {
  cpSync(libSrc, libDst, { recursive: true });
  log(`[hooks/lib] copied → .claude/hooks/lib/`);
}

// ── Done ─────────────────────────────────────────────────────────────────────
log(`\nDragonfly setup complete. Restart Claude Code to activate the MCP server.`);
