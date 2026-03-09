/**
 * Bridge Module
 * 4 MCP tools for cross-project memory export, import, search, and listing.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { successResponse, errorResponse, args as a } from "../../utils/responses.js";
import { createDispatcher, createModule } from "../../core/dispatcher.js";
import { createLazyLoader } from "../../utils/lazy.js";
import { requireBridge } from "../../utils/guards.js";
import { config } from "../../core/config.js";
import { BridgeStore } from "./store.js";
import { MemoryStore } from "../memory/store.js";

const dispatcher = createDispatcher();
const getStore = createLazyLoader(() => new BridgeStore(config().bridgeGlobalMemoryPath));

export const tools: Tool[] = [
  {
    name: "dragonfly_bridge_export",
    description: "Export project memories to the global memory store (~/.dragonfly/global-memory/). Deduplicates by memory ID. Use min_confidence to export only high-quality memories.",
    inputSchema: {
      type: "object",
      properties: {
        project_name: { type: "string", description: "Project name for grouping (e.g., 'bodhi', 'zen')" },
        min_confidence: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Minimum confidence level to export (default: 'low' — exports all). Use 'high' to export only well-established patterns.",
        },
      },
      required: ["project_name"],
    },
  },
  {
    name: "dragonfly_bridge_import",
    description: "Import relevant memories from the global store into the current project. Filters by query and/or source project. Set commit:true to write matched memories directly to local memory.db.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query to filter memories" },
        project: { type: "string", description: "Import only from this project" },
        commit: {
          type: "boolean",
          description: "If true, write matched memories to local memory.db (default: false — preview only)",
        },
        limit: { type: "number", description: "Maximum memories to import per category (default: 5)" },
      },
    },
  },
  {
    name: "dragonfly_bridge_search",
    description: "Keyword search across the global memory store, matching content and tags. Uses substring matching (not semantic similarity). Results ranked by match type (content > tag) and confidence.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        project: { type: "string", description: "Filter to a specific project" },
        limit: { type: "number", description: "Maximum results (default: 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "dragonfly_bridge_list",
    description: "List available memories in the global store, grouped by category.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Filter to a specific project" },
      },
    },
  },
];

// ─── Handlers ────────────────────────────────────────────────

dispatcher
  .register(
    "dragonfly_bridge_export",
    requireBridge(async (args) => {
      const projectName = a.string(args, "project_name", "");
      if (!projectName) return errorResponse("project_name is required");

      const minConfidence = a.stringOptional(args, "min_confidence");
      const store = getStore();
      const memoryDbPath = config().memoryDbPath;
      const result = store.exportMemories(memoryDbPath, projectName, minConfidence ?? undefined);

      if (result.exported === 0 && result.skipped === 0) {
        return successResponse({ message: "No local memories to export" });
      }
      if (result.exported === 0) {
        return successResponse({ message: `All ${result.skipped} memories already exported`, skipped: result.skipped });
      }

      return successResponse({
        message: `${result.exported} memories exported from ${projectName}`,
        ...result,
      });
    }),
  )
  .register(
    "dragonfly_bridge_import",
    requireBridge(async (args) => {
      const query = a.stringOptional(args, "query");
      const project = a.stringOptional(args, "project");
      const commit = a.boolean(args, "commit", false);
      const limit = a.number(args, "limit", 5);

      const store = getStore();
      const global = store.loadGlobalMemories();

      // Collect matching memories
      let totalFound = 0;
      const categories: string[] = [];
      const matches: Array<{ category: string; content: string; confidence: string }> = [];
      const allMatches: Array<{ category: string; content: string; confidence: string; tags: string[]; source: string }> = [];

      for (const [category, memories] of global) {
        let candidates = project ? memories.filter((m) => m.project === project) : memories;

        if (query) {
          const q = query.toLowerCase();
          candidates = candidates.filter((m) =>
            m.content.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)),
          );
        }

        if (candidates.length > 0) {
          totalFound += candidates.length;
          categories.push(category);
          for (const c of candidates.slice(0, limit)) {
            matches.push({ category, content: c.content, confidence: c.confidence });
            allMatches.push({ category, content: c.content, confidence: c.confidence, tags: c.tags, source: c.source });
          }
        }
      }

      // Commit matched memories to local memory.db if requested
      let committed = 0;
      if (commit && allMatches.length > 0) {
        const confidenceMap: Record<string, number> = { high: 0.85, medium: 0.6, low: 0.3 };
        try {
          const memStore = new MemoryStore(config().memoryDbPath);
          for (const m of allMatches) {
            memStore.insertMemory({
              type: "semantic",
              content: m.content,
              confidence: confidenceMap[m.confidence] ?? 0.5,
              source: `bridge:${m.source}`,
              category: m.category,
              tags: m.tags,
              archived: false,
            });
            committed++;
          }
        } catch (err) {
          return errorResponse(`Failed to commit memories: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return successResponse({
        found: totalFound,
        categories,
        preview: matches,
        ...(commit ? { committed, message: committed > 0 ? `Committed ${committed} memories to local memory.db` : "No memories committed" } : {
          message: totalFound > 0
            ? `Found ${totalFound} memories across ${categories.length} categories. Set commit:true to write to local memory.db.`
            : "No matching memories found in global store",
        }),
      });
    }),
  )
  .register(
    "dragonfly_bridge_search",
    requireBridge(async (args) => {
      const query = a.string(args, "query", "");
      if (!query) return errorResponse("query is required");

      const project = a.stringOptional(args, "project");
      const limit = a.number(args, "limit", 20);

      const store = getStore();
      const results = store.searchMemories(query, project || undefined);
      const limited = results.slice(0, limit);

      return successResponse({
        query,
        total: results.length,
        results: limited.map((r) => ({
          category: r.category,
          match_type: r.matchType,
          confidence: r.memory.confidence,
          content: r.memory.content,
          tags: r.memory.tags,
          project: r.memory.project,
        })),
      });
    }),
  )
  .registerQuick(
    "dragonfly_bridge_list",
    requireBridge(async (args) => {
      const project = a.stringOptional(args, "project");

      const store = getStore();
      const categories = store.listMemories(project || undefined);

      if (categories.length === 0) {
        return successResponse({ message: "No global memories found", categories: [] });
      }

      const totalMemories = categories.reduce((s, c) => s + c.count, 0);

      return successResponse({
        total: totalMemories,
        category_count: categories.length,
        categories: categories.map((c) => ({
          category: c.category,
          count: c.count,
          preview: c.memories.slice(0, 3).map((m) =>
            m.content.length > 70 ? m.content.slice(0, 70) + "..." : m.content,
          ),
        })),
      });
    }),
  );

export const bridgeModule = createModule(tools, dispatcher);
