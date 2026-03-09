# Analytics Module

**Module:** `analytics`
**Tools:** 5
**Feature flag:** `DRAGONFLY_ANALYTICS_ENABLED` (default: enabled)
**Storage:** Reads from `state.db` and `memory.db` (read-only)

---

## Overview

The Analytics module is the observability backbone of the Dragonfly plugin. It reads the provenance event log written by every concept execution and surfaces five categories of insight: timeline visualization, configuration integrity, workflow performance benchmarks, pattern learning with skill generation, and configuration drift detection.

Zero LLM calls. Zero embedding calls. All computation is pure SQL + in-memory aggregation on `ProvenanceAction[]`. Scales linearly with event count (~200ms for 10K events on M-series hardware).

---

## Quick Reference

| Tool | Description |
|---|---|
| `dragonfly_timeline_view` | Temporal workflow visualization with timing and cost |
| `dragonfly_validate_config` | Database integrity check (tables, WAL mode, row health) |
| `dragonfly_analyze_workflows` | Full p50/p90/p99 performance benchmarks across all history |
| `dragonfly_learn_patterns` | Extract recurring patterns and generate skill templates |
| `dragonfly_check_drift` | Compare installed .claude/ files against plugin templates |

---

## Tools

### `dragonfly_timeline_view`

Temporal workflow visualization from the `state.db::events` provenance table. Shows ordered events with timing, cost, and flow grouping.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `flow_id` | string | No | Filter to a specific workflow/flow |
| `concept` | string | No | Filter by concept (e.g., "architecture") |
| `from` | string | No | Start date filter (ISO 8601) |
| `to` | string | No | End date filter (ISO 8601) |
| `limit` | number | No | Max entries to return (default: 100) |

**Returns:**
```
{
  entries: [{
    action_id: string,
    timestamp: string,
    concept: string,
    action: string,
    status: string,
    model: string,
    duration_ms: number,
    cost_usd: number | null,
    flow_id: string | null
  }],
  total_duration_ms: number,
  total_cost: number,
  flow_ids: string[],
  date_range: { from: string, to: string }
}
```

---

### `dragonfly_validate_config`

Database integrity check. Verifies required tables exist, WAL journal mode is enabled, and tables are non-empty.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `check_state` | boolean | No | Check state.db integrity (default: true) |
| `check_memory` | boolean | No | Check memory.db integrity (default: true) |

**Checks performed:**
- File existence (error if missing)
- Required tables present:
  - `state.db`: `health`, `events`, `checkpoints`, `workflow_sessions`, `stories`
  - `memory.db`: `memories`, `memory_embeddings`, `links`
- WAL journal mode (warning if not enabled)
- Non-empty table rows (warning if empty)

**Returns:**
```
{
  valid: boolean,
  errors: [{ db, table, message, severity: "error" }],
  warnings: [{ db, table, message, severity: "warning" }],
  databases_checked: string[]
}
```

---

### `dragonfly_analyze_workflows`

Compute full performance benchmarks across all workflow history. Combines six internal aggregators into a unified benchmark report. Use to answer: "What does my system cost?", "Which concepts are slow?", "Is my failure rate trending up?"

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `stories` | number | No | Number of most recent stories for trend window (default: 10) |
| `concept` | string | No | Filter analysis to a specific concept |
| `from` | string | No | Start date filter (ISO 8601) |
| `to` | string | No | End date filter (ISO 8601) |

**Returns:**
```
{
  cost: {
    by_concept: { [concept]: number },
    by_model: { [model]: number },
    total_usd: number,
    time_series: [{ date, cost_usd }]
  },
  duration: {
    by_concept: {
      [concept]: { p50_ms, p90_ms, p99_ms, count }
    }
  },
  quality: {
    approval_rate: number,
    avg_review_cycles: number
  },
  model_usage: {
    [model]: { count, cost_usd, pct }
  },
  failures: {
    failure_rate: number,
    by_concept: { [concept]: number },
    by_error_type: { [type]: number }
  },
  trends: {
    cost_trend: "improving" | "stable" | "degrading",
    duration_trend: string,
    failure_trend: string,
    window: number
  }
}
```

**Internal aggregators (not separately exposed):**
| Aggregator | What It Computes |
|---|---|
| `computeCostAnalytics` | Cost by concept, model, flow_id, date. Time-series. |
| `aggregateDurations` | p50/p90/p99 latency per concept. Outlier detection. |
| `aggregateQuality` | Approval rate, avg review cycles from quality/verification events. |
| `aggregateModelUsage` | Count + cost distribution by model. |
| `aggregateFailures` | Failure rate, retry count, failures by concept and error type. |
| `computeTrends` | Rolling window over N most recent stories: cost/duration/failure trends. |

---

### `dragonfly_learn_patterns`

Extract recurring workflow patterns from execution history and optionally generate skill template files for high-confidence patterns.

**Confidence levels:**
- **High:** ≥10 occurrences + ≥80% success rate
- **Medium:** ≥5 occurrences + ≥60% success rate
- **Low:** below medium threshold

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `min_occurrences` | number | No | Minimum executions to include a pattern (default: 5) |
| `min_success_rate` | number | No | Minimum success rate 0.0–1.0 (default: 0.6) |
| `save` | boolean | No | Write generated skill files to `.claude/skills/` (default: false) |
| `skills_dir` | string | No | Override path for skills directory |

**Returns:**
```
{
  total_patterns: number,
  filtered_patterns: number,
  patterns: [{
    concept: string,
    action: string,
    occurrences: number,
    success_rate: number,
    avg_duration_ms: number,
    avg_cost: number,
    confidence: "high" | "medium" | "low"
  }],
  generated_skills: [{
    name: string,
    content: string,
    saved: boolean,
    path: string | null   // set if save=true and write succeeded
  }]
}
```

---

### `dragonfly_check_drift`

Compare installed `.claude/` files against plugin templates to detect configuration drift. Identifies files that are missing, modified, or extra (no template source).

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `templates_dir` | string | No | Override templates directory (default: plugin's `templates/` directory) |
| `claude_dir` | string | No | Override installed `.claude/` directory (default: `.claude/` in project root) |

**Returns:**
```
{
  clean: boolean,
  missing: [{ path: string, category: string }],    // templates not installed
  modified: [{ path: string, category: string }],   // installed files differing from template
  extra: [{ path: string, category: string }],      // installed files with no template source
  scanned_at: string,
  templates_dir: string,
  claude_dir: string
}
```

---

## Research Basis

| Work | Authors | Year | Relevance |
|---|---|---|---|
| **W3C PROV Data Model** | Moreau & Missier, W3C | 2013, doi.org/10.1145/2816820 | Entity-activity-agent provenance model — the `events` table is a direct implementation; `dragonfly_timeline_view` visualizes this provenance |
| **Event Sourcing** | Martin Fowler | 2005, martinfowler.com/eaps/event-sourcing.html | Immutable event log as analytics source of truth — all aggregations read from the append-only events table |
| **Site Reliability Engineering (SRE Book)** | Beyer, Jones, Petoff & Murphy, Google/O'Reilly | 2016, ISBN 978-1491929124 | p50/p90/p99 latency SLO measurement — `aggregateDurations` implements this pattern exactly |
| **LLMOps cost attribution** | Emerging practice | 2023–2025 | Cost by model/concept is the standard observability pattern for LLM operations; `computeCostAnalytics` implements this |
| **Workflow Provenance** | Missier et al.; Buneman et al. | 2010; 2001 | Timeline view as data lineage for debugging — the academic foundation for `dragonfly_timeline_view` |
| **ACT-R Cognitive Architecture** | Anderson | 1983, Psychological Review | Procedural knowledge compilation from repeated practice — basis for `dragonfly_learn_patterns` and skill generation |

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `DRAGONFLY_ANALYTICS_ENABLED` | `true` | Enable/disable the Analytics module |

---

## Integration

- **State module**: Reads `events` table written by all concept executions — the single data source for all analytics
- **Framework module**: Workflow state written by Framework is visible in `dragonfly_timeline_view`
- **Evolve module**: `dragonfly_learn_patterns` generates skills that Evolve can improve further via prompt evolution
- **All modules**: Every module writes provenance events consumed by Analytics
