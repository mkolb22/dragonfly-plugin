# State Module

**Module:** `state`
**Tools:** 9 (`dragonfly_health_get`, `dragonfly_checkpoint_save`, `dragonfly_checkpoint_list`, `dragonfly_checkpoint_get`, `dragonfly_checkpoint_restore`, `dragonfly_story_save`, `dragonfly_story_get`, `dragonfly_story_list`, `dragonfly_flow_plan`)
**Feature flag:** None
**Storage:** `DRAGONFLY_STATE_DB_PATH` (default: `~/.dragonfly/state.db`, SQLite WAL mode)
**Always enabled:** Yes

---

## Quick Reference

| Tool | Description | Required Params |
|---|---|---|
| `dragonfly_health_get` | Check plugin health and database connectivity | None |
| `dragonfly_checkpoint_save` | Save current workflow state as a named checkpoint | `name` |
| `dragonfly_checkpoint_list` | List saved checkpoints | None |
| `dragonfly_checkpoint_get` | Retrieve a specific checkpoint | `checkpoint_id` or `name` |
| `dragonfly_checkpoint_restore` | Restore workflow state from a checkpoint | `checkpoint_id` |
| `dragonfly_story_save` | Save or update a user story | `title`, `description` |
| `dragonfly_story_get` | Retrieve a specific story | `story_id` |
| `dragonfly_story_list` | List all stories, optionally filtered by status | None |
| `dragonfly_flow_plan` | Plan workflow execution flow for a story | `story_id` |

---

## Overview

The State module is the persistence backbone of Dragonfly. It manages health monitoring, workflow checkpoints, story records, and the provenance event log that all other modules write into. Every workflow session, every concept execution outcome, and every story artifact is ultimately stored in or referenced from `state.db`.

The database uses SQLite with WAL (Write-Ahead Logging) journal mode, enabling concurrent reads from multiple modules while a writer is active. This is essential in an MCP context where multiple tool calls may read the events table while the Framework module is writing a new session record.

### Database Schema

```sql
-- state.db tables (validated by dragonfly_validate_config)

health              -- Plugin health status snapshots
events              -- Provenance event log (written by all modules on every execution)
checkpoints         -- Named workflow state snapshots
workflow_sessions   -- Active and completed workflow execution state
stories             -- User stories with status lifecycle
```

The `events` table is the most important: it is an append-only provenance log recording every significant action taken by every module. It is the source of truth for the Analytics module's timeline visualization and benchmark analysis.

### Event Log Structure

```sql
events (
  action_id     TEXT PRIMARY KEY,
  timestamp     TEXT NOT NULL,         -- ISO 8601
  concept       TEXT,                  -- Which concept was executing
  action        TEXT,                  -- What action was performed
  status        TEXT,                  -- approved | rejected | skipped | error
  model         TEXT,                  -- LLM model used
  duration_ms   INTEGER,               -- Execution time
  cost_usd      REAL,                  -- Estimated cost
  flow_id       TEXT                   -- Pipeline execution ID
)
```

---

## Tools

### `dragonfly_health_get`

Check plugin health status and database connectivity. Returns a summary of all module availability and database reachability. Use this to diagnose issues before running other tools.

**Parameters:** None.

**Returns:**

```json
{
  "status": "healthy",
  "databases": {
    "state": true,
    "memory": true
  },
  "modules": {
    "ast": true,
    "semantic": true,
    "memory": true,
    "framework": true,
    "analytics": true,
    "bridge": true,
    "evolve": true
  },
  "timestamp": "2026-03-09T11:00:00Z"
}
```

Status values:
- `healthy` — all databases connected, all modules available
- `degraded` — some modules unavailable but core functionality works
- `unhealthy` — database connectivity failure or critical module missing

---

### `dragonfly_checkpoint_save`

Save the current workflow state as a named checkpoint. Checkpoints capture the complete workflow session state at a point in time, enabling rollback to that state if subsequent steps fail or produce unacceptable results.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | Yes | — | Human-readable checkpoint name (e.g., `"after-architecture-approved"`) |
| `story_id` | string | No | none | Associate checkpoint with a specific story |
| `data` | object | No | `{}` | Additional context to persist in the checkpoint |

**Returns:**

```json
{
  "checkpoint_id": "chk_a4f2b7",
  "name": "after-architecture-approved",
  "story_id": "story_7b2c",
  "saved_at": "2026-03-09T11:22:00Z"
}
```

---

### `dragonfly_checkpoint_list`

List available checkpoints, optionally scoped to a specific story.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `story_id` | string | No | none | Filter to checkpoints associated with this story |

**Returns:**

```json
{
  "checkpoints": [
    {
      "id": "chk_a4f2b7",
      "name": "after-architecture-approved",
      "story_id": "story_7b2c",
      "created_at": "2026-03-09T11:22:00Z"
    }
  ],
  "total": 1
}
```

---

### `dragonfly_checkpoint_get`

Retrieve a specific checkpoint by ID or name. Returns full checkpoint data including any `data` object saved at checkpoint time.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `checkpoint_id` | string | No | — | Checkpoint ID (takes precedence over `name`) |
| `name` | string | No | — | Checkpoint name (returns most recent match if multiple exist) |

At least one of `checkpoint_id` or `name` must be provided.

**Returns:**

```json
{
  "id": "chk_a4f2b7",
  "name": "after-architecture-approved",
  "story_id": "story_7b2c",
  "data": {
    "workflow_session": { "current_concept": "implementation", "step_number": 3 }
  },
  "created_at": "2026-03-09T11:22:00Z"
}
```

---

### `dragonfly_checkpoint_restore`

Restore workflow state from a saved checkpoint. Overwrites the current workflow session state with the checkpoint's saved state. The checkpoint itself is preserved — restore does not consume it.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `checkpoint_id` | string | Yes | — | Checkpoint to restore |

**Returns:**

```json
{
  "restored": true,
  "checkpoint_id": "chk_a4f2b7",
  "restored_concept": "implementation",
  "session_id": "sess_9f3a12"
}
```

---

### `dragonfly_story_save`

Save a new story or update an existing one. Stories are the primary work items driving workflow execution. Each story has a lifecycle: `pending` → `in_progress` → `completed`.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `title` | string | Yes | — | Brief, descriptive story title |
| `description` | string | Yes | — | Full story description including context and goals |
| `acceptance_criteria` | string[] | No | `[]` | Explicit conditions that define "done" |
| `priority` | string | No | none | `high`, `medium`, or `low` |
| `story_id` | string | No | none | If provided, updates the existing story with this ID |

**Returns:**

```json
{
  "story_id": "story_7b2c",
  "title": "Add JWT authentication to API",
  "created": true
}
```

`created: false` indicates an update to an existing story.

---

### `dragonfly_story_get`

Retrieve a specific story by ID with its full details including acceptance criteria and status.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `story_id` | string | Yes | — | Story ID |

**Returns:**

```json
{
  "id": "story_7b2c",
  "title": "Add JWT authentication to API",
  "description": "Users need to authenticate via JWT tokens...",
  "acceptance_criteria": [
    "POST /auth/login returns a signed JWT",
    "Protected routes return 401 without valid JWT"
  ],
  "priority": "high",
  "status": "in_progress",
  "created_at": "2026-03-09T10:00:00Z",
  "updated_at": "2026-03-09T11:05:00Z"
}
```

---

### `dragonfly_story_list`

List all stories with summary information, optionally filtered by status.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `status` | string | No | all | Filter: `pending`, `in_progress`, or `completed` |

**Returns:**

```json
{
  "stories": [
    {
      "id": "story_7b2c",
      "title": "Add JWT authentication to API",
      "status": "in_progress",
      "priority": "high",
      "created_at": "2026-03-09T10:00:00Z"
    }
  ],
  "total": 1
}
```

---

### `dragonfly_flow_plan`

Plan the workflow execution sequence for a story. Returns the ordered list of concepts that will execute and identifies any prerequisites that must be satisfied first.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `story_id` | string | Yes | — | Story to generate an execution plan for |

**Returns:**

```json
{
  "story_id": "story_7b2c",
  "planned_concepts": ["story", "architecture", "implementation", "quality", "version"],
  "estimated_steps": 5,
  "prerequisites": ["Story must have status: ready before architecture can begin"]
}
```

---

## Academic Foundation

### Event Sourcing

Fowler, M. (2005). *Event sourcing.* martinfowler.com/eaps/event-sourcing.html

Event sourcing stores the full history of state changes as an immutable sequence of events, rather than storing only the current state. The `events` table in `state.db` implements this pattern: every action taken by every module appends a new event record; no events are ever modified or deleted. The current state of any workflow can be reconstructed by replaying the event sequence. This gives the Analytics module a complete audit trail, enables checkpoint restoration, and means no information is lost even when the system is interrupted mid-workflow.

### CQRS — Command Query Responsibility Segregation

Fowler, M. (2011). *CQRS.* martinfowler.com/bliki/CQRS.html

CQRS separates the write model (commands that change state) from the read model (queries that retrieve state). The State module implements this separation cleanly: `dragonfly_checkpoint_save`, `dragonfly_story_save`, and event writes are commands; `dragonfly_checkpoint_get`, `dragonfly_story_list`, `dragonfly_health_get`, and the Analytics module's timeline reads are queries. SQLite WAL mode is the enabling technology: WAL allows concurrent readers (query side) without blocking writers (command side), which is essential for an MCP server where multiple tools may be called in parallel.

### Sagas — Long-Running Workflow Transactions

Garcia-Molina, H. & Salem, K. (1987). *Sagas.* ACM SIGMOD Record, 16(3), 249–259.

Garcia-Molina and Salem introduced the Saga pattern for long-running transactions that cannot be held in a single ACID transaction: decompose the transaction into a sequence of local transactions, each with a compensating transaction for rollback. The Dragonfly workflow is a saga: each concept execution is a local transaction; checkpoints are the saga's compensation points; `dragonfly_checkpoint_restore` is the compensation operation that rolls back to a known-good state. This is why checkpoints are created at the end of each approved concept step — they establish compensation points for the saga.

### W3C PROV Data Model — Provenance Tracking

Moreau, L. & Missier, P. (Eds.) (2013). *PROV-DM: The PROV data model.* W3C Recommendation. DOI: [10.1145/2816820](https://doi.org/10.1145/2816820)

The PROV data model defines a standard for recording provenance: who did what, to what, when, and why. The `events` table is a direct implementation of PROV's entity-activity-agent model: `concept` is the agent, `action` is the activity, the artifacts produced are the entities, and `timestamp`/`duration_ms`/`cost_usd` are the activity attributes. The Analytics module's `dragonfly_timeline_view` presents this provenance data as a temporal visualization, providing data lineage for debugging and auditing workflows.

### User Story Mapping

Patton, J. (2014). *User Story Mapping: Discover the Whole Story, Build the Right Product.* O'Reilly Media.

Patton's user story mapping technique organizes requirements as a two-dimensional map: user activities along the horizontal axis, and implementation tasks stacked vertically by priority. The `dragonfly_story_save` / `dragonfly_story_get` / `dragonfly_story_list` tools implement the vertical slice of this model — each story is a discrete, independently deliverable unit of user value. The acceptance criteria stored with each story are the concrete, testable conditions from Patton's story format.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DRAGONFLY_STATE_DB_PATH` | `~/.dragonfly/state.db` | Path to the SQLite state database |

---

## Integration with Other Modules

**Analytics module:** The Analytics module reads the `events` table for all its computation — timeline visualization, benchmark analysis, pattern learning, and cost attribution. The State module is the sole writer to `events`; Analytics is the primary reader. Maintaining write discipline (only State writes events) ensures the provenance log is trustworthy.

**Framework module:** `dragonfly_start_workflow` creates a new `workflow_sessions` record. `dragonfly_advance_workflow` updates it and appends to `events`. The Framework module is the heaviest user of the State module's write path.

**Analytics module (`dragonfly_validate_config`):** Validates that `state.db` has all required tables (`health`, `events`, `checkpoints`, `workflow_sessions`, `stories`), is in WAL mode, and is non-empty. `dragonfly_health_get` performs a lighter runtime check of the same conditions.

**Memory module:** Uses a separate `memory.db` at `memoryDbPath`, but follows the same SQLite WAL pattern. The two databases are never joined — they communicate through the module layer, not the database layer.

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/state/db.ts` | Database initialization, schema migration, WAL configuration |
| `src/tools/state/health.ts` | Health check logic |
| `src/tools/state/checkpoints.ts` | Checkpoint save/get/list/restore |
| `src/tools/state/stories.ts` | Story CRUD and status lifecycle |
| `src/tools/state/events.ts` | Provenance event append and query |
| `src/tools/state/index.ts` | MCP tool registration |
