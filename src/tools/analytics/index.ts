/**
 * Analytics Module
 * 5 MCP tools for workflow observability: timeline visualization, configuration
 * validation, performance benchmarks, pattern learning, and drift detection.
 *
 * Research basis:
 * - W3C PROV Data Model (Moreau & Missier, 2013) — provenance tracking via events table
 * - Google SRE Book (Beyer et al.) — p50/p90/p99 latency SLO measurement
 * - LLMOps cost attribution patterns (2023–2025) — cost by model/concept
 */

import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import Database from "better-sqlite3";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { requireAnalytics } from "../../utils/guards.js";
import { config } from "../../core/config.js";
import { AnalyticsStore } from "./store.js";
import { computeBenchmarks } from "./aggregators.js";
import { extractPatterns, generateSkill } from "./learner.js";
import { compareDirectories } from "./drift.js";
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
      "Validate configuration files and database integrity. Checks state.db and memory.db for required tables, WAL journal mode, and non-empty table health.",
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
  {
    name: "dragonfly_analyze_workflows",
    description:
      "Compute performance benchmarks across all workflow history: cost by concept/model, p50/p90/p99 latency per concept, approval rates, failure rates, and rolling cost/duration/failure trends. Based on W3C PROV provenance tracking — reads the events table written by every concept execution. Use this to understand what your workflows cost, which concepts are slow or unreliable, and whether trends are improving.",
    inputSchema: {
      type: "object",
      properties: {
        stories: {
          type: "number",
          description: "Number of most recent stories for trend analysis (default: 10)",
        },
        concept: {
          type: "string",
          description: "Filter analysis to a specific concept (e.g., 'architecture', 'implementation')",
        },
        from: { type: "string", description: "Start date filter (ISO 8601)" },
        to: { type: "string", description: "End date filter (ISO 8601)" },
      },
    },
  },
  {
    name: "dragonfly_learn_patterns",
    description:
      "Extract recurring workflow patterns from execution history and optionally generate skill templates for high-confidence patterns. High confidence = ≥10 occurrences with ≥80% success rate. Patterns with ≥5 occurrences and ≥60% success are medium confidence. Generated skills capture observed timing, cost, and model usage — making the system self-documenting. Set save:true to write skill files directly to the .claude/skills/ directory.",
    inputSchema: {
      type: "object",
      properties: {
        min_occurrences: {
          type: "number",
          description: "Minimum executions to include a pattern (default: 5)",
        },
        min_success_rate: {
          type: "number",
          description: "Minimum success rate 0.0–1.0 (default: 0.6)",
        },
        save: {
          type: "boolean",
          description: "If true, write generated skill files to .claude/skills/ (default: false)",
        },
        skills_dir: {
          type: "string",
          description: "Override path for skills directory (default: .claude/skills/ relative to project root)",
        },
      },
    },
  },
  {
    name: "dragonfly_check_drift",
    description:
      "Compare installed .claude/ files against plugin templates to detect configuration drift. Identifies: missing (templates not yet installed), modified (installed files that differ from template source), and extra (files in .claude/ with no template origin). Run after plugin updates to know exactly what changed and what needs reinstalling.",
    inputSchema: {
      type: "object",
      properties: {
        templates_dir: {
          type: "string",
          description: "Override templates directory path (default: plugin's templates/ directory)",
        },
        claude_dir: {
          type: "string",
          description: "Override installed .claude/ directory path (default: .claude/ in project root)",
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
  )
  .registerQuick(
    "dragonfly_analyze_workflows",
    requireAnalytics(async (args) => {
      try {
        const store = getStore();
        const filter = buildFilter(args);
        const actions = store.loadProvenance(filter);

        if (actions.length === 0) {
          return successResponse({ message: "No workflow history found. Run some workflows first.", filter });
        }

        const stories = a.number(args, "stories", 10);
        const benchmarks = computeBenchmarks(actions, { stories });
        return successResponse(benchmarks);
      } catch (err) {
        return errorResponse(`Failed to analyze workflows: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  )
  .registerQuick(
    "dragonfly_learn_patterns",
    requireAnalytics(async (args) => {
      try {
        const store = getStore();
        const actions = store.loadProvenance({});
        const minOccurrences = a.number(args, "min_occurrences", 5);
        const minSuccessRate = a.number(args, "min_success_rate", 0.6);
        const save = a.boolean(args, "save", false);

        const allPatterns = extractPatterns(actions);
        const filtered = allPatterns.filter(
          (p) => p.occurrences >= minOccurrences && p.success_rate >= minSuccessRate,
        );

        const generatedSkills: Array<{ name: string; content: string; saved: boolean; path?: string }> = [];

        for (const pattern of filtered) {
          const skill = generateSkill(pattern);
          const entry: { name: string; content: string; saved: boolean; path?: string } = {
            name: skill.name,
            content: skill.content,
            saved: false,
          };

          if (save) {
            try {
              const skillsDir = a.stringOptional(args, "skills_dir")
                ?? join(process.cwd(), ".claude", "skills");
              mkdirSync(skillsDir, { recursive: true });
              const filePath = join(skillsDir, `${skill.name}.md`);
              const frontmatter = [
                "---",
                `name: ${skill.name}`,
                `description: "${skill.description}"`,
                `applies_to: []`,
                `trigger_keywords: [${pattern.concept}, ${pattern.action}]`,
                "---",
                "",
              ].join("\n");
              writeFileSync(filePath, frontmatter + skill.content, "utf-8");
              entry.saved = true;
              entry.path = filePath;
            } catch (writeErr) {
              // Non-fatal — include skill in output even if save fails
            }
          }

          generatedSkills.push(entry);
        }

        // Surface evolve hint for high-confidence patterns so users can optimize them
        const highConfidence = filtered.filter((p) => p.occurrences >= 10 && p.success_rate >= 0.8);
        const evolveHint = highConfidence.length > 0
          ? {
              message: `${highConfidence.length} high-confidence pattern(s) ready for prompt optimization.`,
              suggested_concepts: [...new Set(highConfidence.map((p) => p.concept))],
              workflow: "Call evolve_start with concept_name and initial_prompt=<skill content>, evaluate variants across generations, then call evolve_best with save_as_skill:true to replace the skill template with the optimized version.",
            }
          : undefined;

        return successResponse({
          total_patterns: allPatterns.length,
          filtered_patterns: filtered.length,
          patterns: filtered,
          generated_skills: generatedSkills,
          ...(evolveHint ? { evolve_hint: evolveHint } : {}),
        });
      } catch (err) {
        return errorResponse(`Failed to learn patterns: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  )
  .registerQuick(
    "dragonfly_check_drift",
    requireAnalytics(async (args) => {
      try {
        const cfg = config();

        // Templates dir: plugin's templates/ directory
        const defaultTemplatesDir = resolve(
          new URL(import.meta.url).pathname,
          "../../../../templates",
        );
        const templatesDir = a.stringOptional(args, "templates_dir") ?? defaultTemplatesDir;

        // Installed dir: .claude/ in project root
        const claudeDir = a.stringOptional(args, "claude_dir")
          ?? join(cfg.frameworkContentRoot || process.cwd(), "..", ".claude");

        if (!existsSync(templatesDir)) {
          return errorResponse(`Templates directory not found: ${templatesDir}`);
        }

        const report = compareDirectories(templatesDir, claudeDir);

        return successResponse({
          clean: report.modified.length === 0 && report.missing.length === 0,
          missing: report.missing.map((d) => ({ path: d.relativePath, category: d.category })),
          modified: report.modified.map((d) => ({ path: d.relativePath, category: d.category })),
          extra: report.added.map((d) => ({ path: d.relativePath, category: d.category })),
          scanned_at: report.scanned_at,
          templates_dir: templatesDir,
          claude_dir: claudeDir,
        });
      } catch (err) {
        return errorResponse(`Failed to check drift: ${err instanceof Error ? err.message : String(err)}`);
      }
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
