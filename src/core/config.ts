/**
 * Configuration Management
 * Centralized, type-safe configuration with environment variable support
 */

/**
 * Environment variable helpers
 */
function envOr(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function envInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function envFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function envBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]?.toLowerCase();
  if (!value) return defaultValue;
  return value === "true" || value === "1" || value === "yes";
}

function envArray(key: string, defaultValue: string[]): string[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Server configuration
 */
export interface DragonflyConfig {
  // Server
  serverName: string;
  serverVersion: string;

  // Paths
  projectRoot: string;
  indexPath: string;

  // AST Indexing
  astMaxFileSize: number;
  astExcludePatterns: string[];
  astIncrementalDefault: boolean;

  // Semantic Search
  embeddingModel: string;
  embeddingDimensions: number;
  semanticChunkSize: number;
  semanticChunkOverlap: number;
  semanticMaxResults: number;
  semanticMinSimilarity: number;

  // Memory System
  memoryEnabled: boolean;
  memoryDbPath: string;
  memoryDecayGraceDays: number;
  memoryDecayBaseRate: number;
  memoryDecayThreshold: number;
  memoryAutoLinkThreshold: number;

  // Framework
  frameworkEnabled: boolean;
  frameworkContentRoot: string;

  // State Store
  stateEnabled: boolean;
  stateDbPath: string;

  // Evolution
  evolveEnabled: boolean;

  // Spec
  specEnabled: boolean;

  // Repair
  repairEnabled: boolean;
  repairMaxIterations: number;
  repairTimeout: number;
  repairHistoryLimit: number;

  // Knowledge Graph
  kgEnabled: boolean;
  kgSemanticWeight: number;
  kgKeywordWeight: number;
  kgGraphWeight: number;
  kgCommunityWeight: number;

  // Analytics
  analyticsEnabled: boolean;

  // Pipeline
  pipelineEnabled: boolean;

  // Bridge
  bridgeEnabled: boolean;
  bridgeGlobalMemoryPath: string;

  // Feature Flags
  debugMode: boolean;
  verboseLogging: boolean;
}

/**
 * Default configuration with environment overrides
 */
export function getConfig(): DragonflyConfig {
  const projectRoot = envOr("PROJECT_ROOT", process.cwd());

  return {
    // Server
    serverName: envOr("DRAGONFLY_SERVER_NAME", "dragonfly-server"),
    serverVersion: envOr("DRAGONFLY_SERVER_VERSION", "1.0.0"),

    // Paths
    projectRoot,
    indexPath: envOr("DRAGONFLY_INDEX_PATH", `${projectRoot}/data/index`),

    // AST Indexing
    astMaxFileSize: envInt("DRAGONFLY_AST_MAX_FILE_SIZE", 1024 * 1024), // 1MB
    astExcludePatterns: envArray("DRAGONFLY_AST_EXCLUDE", [
      "node_modules",
      ".git",
      "dist",
      "build",
      "__pycache__",
      ".pytest_cache",
      "coverage",
    ]),
    astIncrementalDefault: envBool("DRAGONFLY_AST_INCREMENTAL", true),

    // Semantic Search
    embeddingModel: envOr("DRAGONFLY_EMBEDDING_MODEL", "all-MiniLM-L6-v2"),
    embeddingDimensions: envInt("DRAGONFLY_EMBEDDING_DIMS", 384),
    semanticChunkSize: envInt("DRAGONFLY_CHUNK_SIZE", 512),
    semanticChunkOverlap: envInt("DRAGONFLY_CHUNK_OVERLAP", 50),
    semanticMaxResults: envInt("DRAGONFLY_MAX_RESULTS", 10),
    semanticMinSimilarity: envFloat("DRAGONFLY_MIN_SIMILARITY", 0.3),

    // Memory System
    memoryEnabled: envBool("DRAGONFLY_MEMORY_ENABLED", true),
    memoryDbPath: envOr("DRAGONFLY_MEMORY_DB_PATH", `${projectRoot}/data/memory.db`),
    memoryDecayGraceDays: envInt("DRAGONFLY_MEMORY_DECAY_GRACE_DAYS", 7),
    memoryDecayBaseRate: envFloat("DRAGONFLY_MEMORY_DECAY_BASE_RATE", 0.05),
    memoryDecayThreshold: envFloat("DRAGONFLY_MEMORY_DECAY_THRESHOLD", 0.1),
    memoryAutoLinkThreshold: envFloat("DRAGONFLY_MEMORY_AUTO_LINK_THRESHOLD", 0.3),

    // Framework — templates/ is bundled in this repository
    frameworkEnabled: envBool("DRAGONFLY_FRAMEWORK_ENABLED", true),
    frameworkContentRoot: envOr("DRAGONFLY_FRAMEWORK_CONTENT_ROOT", `${projectRoot}/templates`),

    // State Store
    stateEnabled: envBool("DRAGONFLY_STATE_ENABLED", true),
    stateDbPath: envOr("DRAGONFLY_STATE_DB_PATH", `${projectRoot}/data/state.db`),

    // Evolution
    evolveEnabled: envBool("DRAGONFLY_EVOLVE_ENABLED", true),

    // Spec
    specEnabled: envBool("DRAGONFLY_SPEC_ENABLED", true),

    // Repair
    repairEnabled: envBool("DRAGONFLY_REPAIR_ENABLED", true),
    repairMaxIterations: envInt("DRAGONFLY_REPAIR_MAX_ITER", 5),
    repairTimeout: envInt("DRAGONFLY_REPAIR_TIMEOUT", 120000),
    repairHistoryLimit: envInt("DRAGONFLY_REPAIR_HISTORY", 100),

    // Knowledge Graph
    // Weights tuned for code intelligence per AST-derived KG RAG research (2026):
    // - Keyword increased (exact symbol name matching critical for code)
    // - Graph increased (structural proximity is the key differentiator for code)
    // - Semantic slightly reduced (code relies more on exact names than semantic similarity)
    // - Community reduced (validated for NL docs, unvalidated for code)
    // All weights are overridable via environment variables.
    kgEnabled: envBool("DRAGONFLY_KG_ENABLED", true),
    kgSemanticWeight: envFloat("DRAGONFLY_KG_SEMANTIC_WEIGHT", 0.35),
    kgKeywordWeight: envFloat("DRAGONFLY_KG_KEYWORD_WEIGHT", 0.35),
    kgGraphWeight: envFloat("DRAGONFLY_KG_GRAPH_WEIGHT", 0.25),
    kgCommunityWeight: envFloat("DRAGONFLY_KG_COMMUNITY_WEIGHT", 0.05),

    // Analytics
    analyticsEnabled: envBool("DRAGONFLY_ANALYTICS_ENABLED", true),

    // Pipeline
    pipelineEnabled: envBool("DRAGONFLY_PIPELINE_ENABLED", true),

    // Bridge
    bridgeEnabled: envBool("DRAGONFLY_BRIDGE_ENABLED", true),
    bridgeGlobalMemoryPath: envOr(
      "DRAGONFLY_BRIDGE_GLOBAL_MEMORY_PATH",
      `${process.env.HOME || "/tmp"}/.dragonfly/global-memory`,
    ),

    // Feature Flags
    debugMode: envBool("DRAGONFLY_DEBUG", false),
    verboseLogging: envBool("DRAGONFLY_VERBOSE", false),
  };
}

import { createResettableLazyLoader } from "../utils/lazy.js";

const configLoader = createResettableLazyLoader(() => getConfig());

/**
 * Get or create config instance
 */
export const config = configLoader.get;

/**
 * Reset config (for testing)
 */
export const resetConfig = configLoader.reset;

/**
 * Log config summary (for debugging)
 */
export function logConfig(cfg: DragonflyConfig = config()): void {
  console.error(`[dragonfly] Configuration:`);
  console.error(`  Server: ${cfg.serverName} v${cfg.serverVersion}`);
  console.error(`  Project: ${cfg.projectRoot}`);
  console.error(`  Index: ${cfg.indexPath}`);
  console.error(`  State: ${cfg.stateDbPath}`);
  console.error(`  Memory: ${cfg.memoryDbPath}`);
  console.error(`  Features:`);
  console.error(`    - Debug: ${cfg.debugMode}`);
}
