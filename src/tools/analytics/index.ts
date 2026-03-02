/**
 * Analytics Module
 * 2 MCP tools for workflow timeline visualization and configuration validation.
 */

import { existsSync } from "fs";
import Database from "better-sqlite3";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { requireAnalytics } from "../../utils/guards.js";
import { config } from "../../core/config.js";
import { AnalyticsStore } from "./store.js";
import type { Concept, Model, ProvenanceFilter, TimelineEntry, TimelineView } from "./types.js";

const dispatcher = createDispatcher();
const getStore = createLazyLoader(() => new AnalyticsStore(config().stateDbPath));

export const tools: Tool[] = [
  {
    name: "dragonfly_timeline_view",
    description:
      "Temporal workflow visualization from provenance. Shows ordered events with timing, costs, and flow grouping.",
    inputSchema: {
      type: "object",
      properties: {
        flow_id: { type: "string", description: "Filter to a specific workflow/flow" },
        concept: { type: "string", description: "Filter by concept" },
        from: { type: "string", description: "Start date (ISO 8601)" },
        to: { type: "string", description: "End date (ISO 8601)" },
        limit: { type: "number", description: "Max entries to return (default: 100)" },
      },
    },
  },
  {
    name: "dragonfly_validate_config",
    description:
      "Validate configuration files and database integrity. Checks state.db and memory.db tables and data consistency.",
    inputSchema: {
      type: "object",
      properties: {
        check_state: {
          type: "boolean",
          description: "Check state.db integrity (default: true)",
        },
        check_memory: {
          type: "boolean",
          description: "Check memory.db integrity (default: true)",
        },
      },
    },
  },
];

// ─── Handlers ──────────────────────────────────────────────────

dispatcher
  .register(
    "dragonfly_timeline_view",
    requireAnalytics(async (args) => {
      const store = getStore();
      const filter = buildFilter(args);
      const actions = store.loadProvenance(filter);
      const limit = a.number(args, "limit", 100);

      if (actions.length === 0) {
        return successResponse({ message: "No provenance actions found", filter });
      }

      const entries: TimelineEntry[] = actions.slice(0, limit).map((act) => ({
        action_id: act.action_id,
        timestamp: act.timestamp,
        concept: act.concept,
        action: act.action,
        status: act.status,
        model: act.model,
        duration_ms: act.duration_ms,
        cost_usd: act.cost?.cost_usd,
        flow_id: act.flow_id,
      }));

      const flowIds = [...new Set(entries.map((e) => e.flow_id).filter(Boolean) as string[])];
      const timestamps = entries.map((e) => e.timestamp).sort();

      const view: TimelineView = {
        entries,
        total_duration_ms: entries.reduce((s, e) => s + (e.duration_ms || 0), 0),
        total_cost: entries.reduce((s, e) => s + (e.cost_usd || 0), 0),
        flow_ids: flowIds,
        date_range: {
          from: timestamps[0] || "",
          to: timestamps[timestamps.length - 1] || "",
        },
      };

      return successResponse(view);
    }),
  )
  .register(
    "dragonfly_validate_config",
    requireAnalytics(async (args) => {
      const cfg = config();
      const checkState = a.boolean(args, "check_state", true);
      const checkMemory = a.boolean(args, "check_memory", true);

      const errors: Array<{ db: string; table: string; message: string; severity: string }> = [];
      const warnings: Array<{ db: string; table: string; message: string; severity: string }> = [];

      if (checkState) {
        validateDb(cfg.stateDbPath, "state.db", [
          "health", "events", "checkpoints", "workflow_sessions", "stories",
        ], errors, warnings);
      }

      if (checkMemory) {
        validateDb(cfg.memoryDbPath, "memory.db", [
          "memories", "memory_embeddings", "links",
        ], errors, warnings);
      }

      return successResponse({
        valid: errors.length === 0,
        errors,
        warnings,
        databases_checked: [
          ...(checkState ? ["state.db"] : []),
          ...(checkMemory ? ["memory.db"] : []),
        ],
      });
    }),
  );

// ─── Helpers ──────────────────────────────────────────────────

function buildFilter(args: Record<string, unknown>): ProvenanceFilter {
  const filter: ProvenanceFilter = {};

  const from = a.stringOptional(args, "from");
  const to = a.stringOptional(args, "to");
  if (from || to) {
    filter.dateRange = {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    };
  }

  const concept = a.stringOptional(args, "concept");
  if (concept) filter.concepts = [concept as Concept];

  const model = a.stringOptional(args, "model");
  if (model) filter.models = [model as Model];

  const flowId = a.stringOptional(args, "flow_id");
  if (flowId) filter.flowId = flowId;

  return filter;
}

function validateDb(
  dbPath: string,
  dbName: string,
  requiredTables: string[],
  errors: Array<{ db: string; table: string; message: string; severity: string }>,
  warnings: Array<{ db: string; table: string; message: string; severity: string }>,
): void {
  if (!existsSync(dbPath)) {
    errors.push({ db: dbName, table: "", message: `Database file not found: ${dbPath}`, severity: "error" });
    return;
  }

  try {
    const db = new Database(dbPath, { readonly: true });

    try {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      ).all() as Array<{ name: string }>;

      const tableNames = new Set(tables.map((t: { name: string }) => t.name));

      for (const required of requiredTables) {
        if (!tableNames.has(required)) {
          errors.push({
            db: dbName,
            table: required,
            message: `Required table '${required}' not found`,
            severity: "error",
          });
        }
      }

      // Check WAL mode
      const journal = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
      if (journal[0]?.journal_mode !== "wal") {
        warnings.push({
          db: dbName,
          table: "",
          message: "Database not using WAL journal mode (recommended for concurrent access)",
          severity: "warning",
        });
      }

      // Check row counts for basic health
      for (const table of requiredTables) {
        if (tableNames.has(table)) {
          const count = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
          if (count.c === 0) {
            warnings.push({
              db: dbName,
              table,
              message: `Table '${table}' is empty`,
              severity: "warning",
            });
          }
        }
      }
    } finally {
      db.close();
    }
  } catch (err) {
    errors.push({
      db: dbName,
      table: "",
      message: `Failed to open database: ${err instanceof Error ? err.message : String(err)}`,
      severity: "error",
    });
  }
}

export const analyticsModule = createModule(tools, dispatcher);
export * from "./types.js";
export { AnalyticsStore } from "./store.js";
