# Analytics Module

**Module:** `analytics`
**Tools:** 5 (`dragonfly_timeline_view`, `dragonfly_validate_config`, `dragonfly_analyze_workflows`, `dragonfly_learn_patterns`, `dragonfly_check_drift`)
**Feature flag:** `DRAGONFLY_ANALYTICS_ENABLED` (default: enabled)
**Storage:** Reads from `stateDbPath` and `memoryDbPath`; writes skill templates to `.claude/skills/` when `save: true`
**Always enabled:** No — opt-in via feature flag

---

## Quick Reference

| Tool | Description | Required Params |
|---|---|---|
| `dragonfly_timeline_view` | Visualize workflow history as a temporal event log | None |
| `dragonfly_validate_config` | Verify database integrity and required table presence | None |
| `dragonfly_analyze_workflows` | Benchmark analysis: cost, latency, quality, failures, trends | None |
| `dragonfly_learn_patterns` | Extract recurring patterns and optionally generate skill templates | None |
| `dragonfly_check_drift` | Compare installed `.claude/` against plugin templates | None |

---

## Overview

The Analytics module is the observability backbone of Dragonfly. It provides visibility into workflow execution history, performance characteristics, cost attribution, quality trends, and configuration health. All analysis reads from the provenance event log in `stateDbPath` — the immutable record written by every module on every significant action.

The module is organized around five concerns:

1. **Provenance visualization** (`dragonfly_timeline_view`) — temporal reconstruction of workflow execution
2. **Configuration integrity** (`dragonfly_validate_config`) — database health checks and schema validation
3. **Performance benchmarking** (`dragonfly_analyze_workflows`) — cost, latency, and quality aggregation
4. **Pattern learning** (`dragonfly_learn_patterns`) — extract recurring high-success patterns and generate skill templates
5. **Drift detection** (`dragonfly_check_drift`) — compare installed configuration against canonical templates

### Internal Subsystems

```
stateDbPath (events table)
     │
     ├─ aggregators.ts — 6 computation engines on ProvenanceAction[]
     │   ├─ computeCostAnalytics    — cost by concept/model/flow/date
     │   ├─ aggregateDurations      — p50/p90/p99 latency per concept
     │   ├─ aggregateQuality        — approval rates per concept
     │   ├─ aggregateModelUsage     — model distribution
     │   ├─ aggregateFailures       — failure rates and error types
     │   └─ computeTrends           — rolling improvement over time
     │
     ├─ learner.ts — pattern extraction + skill generation
     │   ├─ extractPatterns()       — clusters concept sequences by outcome
     │   └─ generateSkill()         — produces markdown skill templates
     │
     ├─ observe.ts — session/prompt statistics from observability log
     │   └─ reads koan/observability/prompts.jsonl
     │
     └─ drift.ts — configuration drift detection
         └─ compareDirectories()    — file-level diff templates vs .claude/
```

---

## Tools

### `dragonfly_timeline_view`

Temporal visualization of workflow execution from the provenance events table. Returns ordered events within the specified time range, grouped by flow, with aggregated cost and duration.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `flow_id` | string | No | all | Filter to a specific pipeline execution flow |
| `concept` | string | No | all | Filter to a specific concept |
| `from` | string (ISO 8601) | No | session start | Start of time range |
| `to` | string (ISO 8601) | No | now | End of time range |
| `limit` | number | No | `100` | Maximum events to return |

**Returns:**

```json
{
  "events": [
    {
      "action_id": "act_001",
      "timestamp": "2026-03-09T11:00:00Z",
      "concept": "story",
      "action": "create",
      "status": "approved",
      "model": "claude-sonnet",
      "duration_ms": 4200,
      "cost_usd": 0.005,
      "flow_id": "flow_xyz"
    },
    {
      "action_id": "act_002",
      "timestamp": "2026-03-09T11:05:00Z",
      "concept": "architecture",
      "action": "design",
      "status": "approved",
      "model": "claude-opus",
      "duration_ms": 18400,
      "cost_usd": 0.021,
      "flow_id": "flow_xyz"
    }
  ],
  "total_duration_ms": 94200,
  "total_cost_usd": 0.048,
  "flow_ids": ["flow_xyz"],
  "date_range": {
    "from": "2026-03-09T11:00:00Z",
    "to": "2026-03-09T11:42:00Z"
  }
}
```

---

### `dragonfly_validate_config`

Database integrity check. Verifies that both databases exist, have all required tables, use WAL journal mode, and are non-empty. Run this to diagnose health issues before other tools.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `check_state` | boolean | No | `true` | Check `state.db` integrity |
| `check_memory` | boolean | No | `true` | Check `memory.db` integrity |

**Checks performed:**

For `state.db`:
- File exists at configured path
- Required tables present: `health`, `events`, `checkpoints`, `workflow_sessions`, `stories`
- WAL journal mode enabled
- `events` table is non-empty (at least one recorded action)

For `memory.db`:
- File exists at configured path
- Required tables present: `memories`, `memory_embeddings`, `links`
- WAL journal mode enabled

**Returns:**

```json
{
  "valid": true,
  "state_db": {
    "exists": true,
    "tables_present": ["health", "events", "checkpoints", "workflow_sessions", "stories"],
    "wal_mode": true,
    "events_count": 847
  },
  "memory_db": {
    "exists": true,
    "tables_present": ["memories", "memory_embeddings", "links"],
    "wal_mode": true
  },
  "errors": [],
  "warnings": ["events table has fewer than 10 records — limited analytics data available"]
}
```

---

### `dragonfly_analyze_workflows`

Full benchmark analysis across workflow history. Applies all six aggregators to the events table and returns structured cost, latency, quality, failure, and trend data.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `stories` | number | No | `10` | Number of most recent stories to include in trend window |
| `concept` | string | No | all | Filter analysis to a specific concept |
| `from` | string (ISO 8601) | No | all history | Start of analysis window |
| `to` | string (ISO 8601) | No | now | End of analysis window |

**Returns:**

```json
{
  "cost": {
    "total_usd": 2.847,
    "by_concept": { "architecture": 1.24, "implementation": 0.89, "quality": 0.41 },
    "by_model": { "claude-opus": 1.24, "claude-sonnet": 1.607 },
    "by_date": { "2026-03-09": 0.48, "2026-03-08": 0.71 }
  },
  "duration": {
    "by_concept": {
      "architecture": { "p50": 16200, "p90": 28400, "p99": 41000 },
      "implementation": { "p50": 9800, "p90": 18200, "p99": 27400 }
    }
  },
  "quality": {
    "approval_rates": { "story": 0.94, "architecture": 0.88, "implementation": 0.82 },
    "rejection_rates": { "architecture": 0.12, "implementation": 0.18 }
  },
  "failures": {
    "total": 12,
    "by_concept": { "implementation": 7, "quality": 3 },
    "by_error_type": { "timeout": 4, "test_failure": 6, "parse_error": 2 }
  },
  "trends": {
    "cost_trend": "decreasing",
    "quality_trend": "improving",
    "last_10_approval_rates": [0.78, 0.81, 0.84, 0.87, 0.88, 0.90, 0.88, 0.91, 0.92, 0.91]
  }
}
```

---

### `dragonfly_learn_patterns`

Analyze execution history to extract recurring patterns — concept sequences that frequently appear together with high success rates. Optionally generates skill template files from high-confidence patterns.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `min_occurrences` | number | No | `5` | Minimum times a pattern must appear to be reported |
| `min_success_rate` | number (0–1) | No | `0.6` | Minimum success rate for inclusion |
| `save` | boolean | No | `false` | Write generated skills to `.claude/skills/` |
| `skills_dir` | string | No | `.claude/skills/` | Override skills output directory |

**High-confidence threshold:** patterns with ≥10 occurrences and ≥80% success rate are classified as high-confidence and generate richer skill templates.

**Returns:**

```json
{
  "patterns": [
    {
      "pattern": "story → architecture → implementation → quality",
      "occurrences": 23,
      "success_rate": 0.87,
      "avg_cost_usd": 0.047,
      "confidence": "high",
      "description": "Full feature development workflow with all standard phases"
    }
  ],
  "generated_skills": [
    {
      "name": "full-feature-workflow",
      "file": ".claude/skills/full-feature-workflow.md",
      "based_on_occurrences": 23
    }
  ]
}
```

`generated_skills` is only present when `save: true`.

---

### `dragonfly_check_drift`

Compare the installed `.claude/` directory against the plugin's canonical template directory. Identifies missing files, modified files, and extra files not in the templates. Useful for detecting unauthorized changes or outdated skill files.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `templates_dir` | string | No | plugin templates | Override the canonical templates directory |
| `claude_dir` | string | No | `.claude/` | Override the installed configuration directory |

**Returns:**

```json
{
  "clean": false,
  "missing": ["skills/pipeline-planning.md"],
  "modified": ["skills/code-review.md"],
  "extra": ["skills/my-custom-skill.md"],
  "scanned_at": "2026-03-09T11:00:00Z"
}
```

`clean: true` means the installed `.claude/` is identical to the canonical templates. `extra` files are not errors — they may be intentional additions (like skills generated by `evolve_best`).

---

## Academic Foundation

### W3C PROV Data Model — Provenance Tracking

Moreau, L. & Missier, P. (Eds.) (2013). *PROV-DM: The PROV data model.* W3C Recommendation. DOI: [10.1145/2816820](https://doi.org/10.1145/2816820)

The PROV data model defines a standard for recording provenance through three entity types: entities (the artifacts produced), activities (the processes that produce them), and agents (the actors responsible). The `events` table in `state.db` is a direct implementation of PROV: `concept` is the agent, `action` is the activity, `flow_id` links related activities, and the workflow artifacts are the entities. `dragonfly_timeline_view` reconstructs the PROV graph as a temporal sequence, providing data lineage for debugging and auditing.

### Event Sourcing

Fowler, M. (2005). *Event sourcing.* martinfowler.com/eaps/event-sourcing.html

Event sourcing is the architectural pattern underlying the Analytics module's data model: all state changes are stored as an immutable sequence of events, and current state is derived by querying or replaying the event log. The `events` table is append-only; `dragonfly_analyze_workflows` derives aggregate state (cost totals, approval rates, failure counts) by querying the full event history. This enables retrospective analysis of any historical time window without maintaining separate summary tables.

### Google SRE — Latency Percentile Measurement

Beyer, B., Jones, C., Petoff, J., & Murphy, N. R. (Eds.) (2016). *Site Reliability Engineering: How Google Runs Production Systems.* O'Reilly Media. ISBN: 978-1491929124.

The Google SRE Book establishes p50/p90/p99 latency measurement as the standard for SLO (Service Level Objective) monitoring. Arithmetic mean is insufficient because it masks tail latency — the slow 1% of executions that users experience as hangs. `aggregateDurations` in `aggregators.ts` computes p50, p90, and p99 per concept, directly implementing the SRE percentile monitoring pattern. Monitoring p99 latency for the `architecture` concept is especially important given its Opus model usage and higher variance.

### LLMOps Cost Attribution

Emerging practice from LLM operations engineering (2023–2025). Key practitioners: Weights & Biases, LangSmith, Helicone.

Attribution of LLM inference cost to specific workflow steps is a standard LLMOps practice for understanding where money is being spent and identifying optimization opportunities. The `computeCostAnalytics` aggregator in the Analytics module implements this pattern: costs are broken down by concept, model, flow, and date — the four dimensions needed for both per-project budgeting and cross-project benchmarking. The `by_model` breakdown is particularly important for understanding the cost impact of Opus usage in the architecture concept.

### Workflow Provenance

Missier, P., Soiland-Reyes, S., Owen, S., Tan, W., Nenadic, A., Dunlop, I., Williams, A., Bhagat, J., & Goble, C. (2010). *Taverna, reloaded.* Proceedings of the 22nd International Conference on Scientific and Statistical Database Management (SSDBM).

Buneman, P., Khanna, S., & Wang-Chiew, T. (2001). *Why and where: A characterization of data provenance.* Proceedings of ICDT 2001.

Workflow provenance research addresses the problem of tracking data lineage through multi-step computational pipelines — understanding not just what the output is, but which inputs contributed to it and which transformations were applied. `dragonfly_timeline_view` implements workflow provenance visualization for the Dragonfly concept pipeline: each event record captures the transformation (concept + action), the context (flow_id linking related steps), and the outcome (status, cost, duration). This enables debugging by reconstructing the exact sequence of events that produced a given artifact.

### ACT-R Procedural Knowledge Compilation

Anderson, J. R. (1983). *The Architecture of Cognition.* Harvard University Press.

Anderson's ACT-R cognitive architecture describes how declarative knowledge (facts) becomes procedural knowledge (skills) through repeated practice: a sequence of steps that is performed successfully many times becomes a compiled production rule that executes automatically. `dragonfly_learn_patterns` implements this computationally: concept sequences that appear frequently with high success rates are extracted as patterns, and high-confidence patterns are compiled into skill templates. The skill template is the computational equivalent of the compiled production rule — a reusable behavioral specification derived from successful practice.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DRAGONFLY_ANALYTICS_ENABLED` | `true` | Enable or disable the Analytics module |

---

## Integration with Other Modules

**State module:** The Analytics module is a pure reader of the State module's `events` table. It never writes to `state.db`. The State module's event append-on-execution contract is what makes Analytics data reliable — every action is recorded regardless of whether the Analytics module is queried.

**Framework module:** `dragonfly_advance_workflow` writes provenance events that `dragonfly_timeline_view` reads. The timeline view is the diagnostic tool for understanding why a specific workflow execution took longer or cost more than expected.

**Evolve module:** `dragonfly_learn_patterns` extracts patterns that `evolve_best` can use as seed prompts. Conversely, evolved skills saved by `evolve_best` appear in `dragonfly_check_drift` comparisons as `extra` files, distinguishing evolved skills from template-derived skills.

**Memory module:** `dragonfly_validate_config` checks `memory.db` integrity alongside `state.db`. The Analytics module reads from `memoryDbPath` for observability statistics on memory usage patterns.

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/analytics/aggregators.ts` | 6 computation engines on ProvenanceAction[] |
| `src/tools/analytics/learner.ts` | Pattern extraction and skill template generation |
| `src/tools/analytics/observe.ts` | Session/prompt statistics from observability log |
| `src/tools/analytics/drift.ts` | Configuration drift detection |
| `src/tools/analytics/index.ts` | MCP tool registration |
