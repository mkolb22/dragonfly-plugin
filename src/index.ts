#!/usr/bin/env node

/**
 * Dragonfly MCP Plugin
 * Opus-powered server providing code intelligence, semantic search, memory, and workflow orchestration
 *
 * Modules (66 tools total):
 * - AST (7 tools) - Code intelligence through AST analysis
 * - Semantic (3 tools) - Semantic search with embeddings
 * - Memory (4 tools) - Persistent semantic memory
 * - Framework (8 tools) - Workflow orchestration
 * - State (8 tools) - Health, checkpoints, stories, migration
 * - Evolve (4 tools) - Prompt optimization
 * - Spec (6 tools) - Specification DSL for code generation
 * - Testing (6 tools) - Test generation, execution, and coverage
 * - Repair (5 tools) - Self-repair and iterative refinement
 * - Knowledge Graph (7 tools) - Entity/relation management with hybrid search + AST bridge
 * - Analytics (2 tools) - Cost and performance observability
 * - Pipeline (2 tools) - Composition DSL parsing and execution planning
 * - Bridge (4 tools) - Cross-project memory export, import, search
 */

import { createServer, runServer } from "./core/server.js";
import type { ToolModule, ToolResponse } from "./core/types.js";

// Import tool modules
import { astModule } from "./tools/ast/index.js";
import { semanticModule } from "./tools/semantic/index.js";
import { memoryModule } from "./tools/memory/index.js";
import { frameworkModule } from "./tools/framework/index.js";
import { stateModule } from "./tools/state/index.js";
import { evolveModule } from "./tools/evolve/index.js";
import { specModule } from "./tools/spec/index.js";
import { testingModule } from "./tools/testing/index.js";
import { repairModule } from "./tools/repair/index.js";
import { knowledgeModule } from "./tools/knowledge/index.js";
import { analyticsModule } from "./tools/analytics/index.js";
import { pipelineModule } from "./tools/pipeline/index.js";
import { bridgeModule } from "./tools/bridge/index.js";

// All modules
const modules: ToolModule[] = [
  astModule,
  semanticModule,
  memoryModule,
  frameworkModule,
  stateModule,
  evolveModule,
  specModule,
  testingModule,
  repairModule,
  knowledgeModule,
  analyticsModule,
  pipelineModule,
  bridgeModule,
];

// Aggregate all tools and build O(1) lookup map
const allTools = modules.flatMap((m) => m.tools);

const toolMap = new Map<string, ToolModule>();
for (const mod of modules) {
  for (const tool of mod.tools) {
    toolMap.set(tool.name, mod);
  }
}

// Create unified tool handler
async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const mod = toolMap.get(name);
  if (mod) {
    return mod.handleToolCall(name, args);
  }

  return {
    content: [{ type: "text" as const, text: `Error: Unknown tool: ${name}` }],
    isError: true,
  };
}

// Create and run server
const server = createServer({
  name: "dragonfly-server",
  version: "1.0.0",
  tools: allTools,
  handleToolCall,
});

runServer(server)
  .then(() => console.error(`Dragonfly MCP Plugin running (${allTools.length} tools available)`))
  .catch(console.error);
