# Bug: dragonfly_bridge_search Returns 0 Results for Non-Standard Categories

**Severity**: High
**Component**: Bridge module — `src/tools/bridge/store.ts`
**Affects**: `dragonfly_bridge_search`, `dragonfly_bridge_list`, `dragonfly_bridge_import`
**Status**: Fixed in dragonfly-plugin (fix also applied to dragonfly repo)

---

## Symptom

`dragonfly_bridge_search` returns 0 results even when YAML files exist in `~/.dragonfly/global-memory/` with content that should match the query.

```
dragonfly_bridge_search(query: "competitive test opus") → { total: 0, results: [] }
```

Files were confirmed to exist at `~/.dragonfly/global-memory/competitive-evaluation/bodhi.yaml` with matching content.

---

## Root Cause

`loadGlobalMemories()` in `store.ts` iterates over a **hardcoded `CATEGORIES` constant** instead of scanning the actual directory:

```typescript
// BEFORE — hardcoded 6 categories only
export const CATEGORIES = ["architecture", "conventions", "patterns", "preferences", "technologies", "workflows"] as const;

loadGlobalMemories(): Map<string, BridgeMemory[]> {
  for (const cat of CATEGORIES) {   // ← never reads any other subdirectory
    const catDir = join(this.globalDir, cat);
    ...
  }
}
```

`exportMemories()` writes to `join(globalDir, category, projectName.yaml)` using the **memory's actual category** from the SQLite `memories` table. Any memory stored with a category not in the hardcoded list (e.g., `competitive-evaluation`, `agent-evolution`, `learnings`, `evolution-results`) gets exported to a subdirectory that `loadGlobalMemories()` never reads.

This creates a silent data loss pattern: export succeeds, files are written, but search/list/import find nothing.

---

## Trigger Conditions

Any memory stored via `memory_store` with a `category` outside the 6 hardcoded values:

| Category in DB | Exported to | Searchable? |
|---|---|---|
| `architecture` | `~/.dragonfly/global-memory/architecture/` | ✅ Yes |
| `patterns` | `~/.dragonfly/global-memory/patterns/` | ✅ Yes |
| `competitive-evaluation` | `~/.dragonfly/global-memory/competitive-evaluation/` | ❌ No (before fix) |
| `agent-evolution` | `~/.dragonfly/global-memory/agent-evolution/` | ❌ No (before fix) |
| `learnings` | `~/.dragonfly/global-memory/learnings/` | ❌ No (before fix) |

The `~/.dragonfly/global-memory/` store already had 15 subdirectories from active use — 9 of them invisible to search.

---

## Fix

Replace the hardcoded CATEGORIES iteration with a dynamic directory scan:

```typescript
// AFTER — scans all subdirectories
loadGlobalMemories(): Map<string, BridgeMemory[]> {
  const result = new Map<string, BridgeMemory[]>();

  if (!existsSync(this.globalDir)) return result;

  let subdirs: string[];
  try {
    subdirs = readdirSync(this.globalDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return result;
  }

  for (const cat of subdirs) {
    const catDir = join(this.globalDir, cat);
    // ... rest unchanged
  }
}
```

**File changed**: `src/tools/bridge/store.ts` — `loadGlobalMemories()` method only.
No schema changes, no API changes, no behavior change for the 6 original categories.

---

## Verification

After fix, `dragonfly_bridge_search` should find memories in any category:

```
dragonfly_bridge_search(query: "competitive test opus")
→ { total: 2, results: [...memories from competitive-evaluation/bodhi.yaml] }
```

---

## Impact

- **dragonfly_bridge_export**: Unaffected — exports to correct path based on memory category
- **dragonfly_bridge_search**: Fixed — now searches all category subdirectories
- **dragonfly_bridge_list**: Fixed — now lists all category subdirectories
- **dragonfly_bridge_import**: Fixed — now imports from all category subdirectories

---

## Discovery

Found while using `dragonfly_bridge_search query:"competitive test opus"` to retrieve competitive evaluation results that had just been exported via `dragonfly_bridge_export project_name:"bodhi"`. The export reported success (19 memories exported), but subsequent search returned 0 results. Traced to `loadGlobalMemories()` never reading the `competitive-evaluation/` subdirectory.

**Date**: 2026-03-04
**Fixed in**: dragonfly-plugin commit (this fix) + dragonfly repo (same patch applied in parallel)
