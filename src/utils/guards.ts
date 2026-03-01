/**
 * Config Guard Middleware
 * Replaces repeated config-check boilerplate at the start of tool handlers
 */

import type { HandlerFn } from "../core/dispatcher.js";
import { errorResponse } from "./responses.js";
import { config } from "../core/config.js";

/**
 * Wrap a handler with a config guard. If the guard check fails,
 * returns an error response without calling the handler.
 */
export function withConfigGuard(
  check: (cfg: ReturnType<typeof config>) => boolean,
  message: string,
  handler: HandlerFn,
): HandlerFn {
  return async (args) => {
    const cfg = config();
    if (!check(cfg)) {
      return errorResponse(message);
    }
    return handler(args);
  };
}

/** Guard that requires memory to be enabled */
export const requireMemory = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.memoryEnabled,
    "Memory system is disabled. Set DRAGONFLY_MEMORY_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires framework module to be enabled */
export const requireFramework = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.frameworkEnabled,
    "Framework module is disabled. Set DRAGONFLY_FRAMEWORK_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires state store to be enabled */
export const requireState = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.stateEnabled,
    "State store is disabled. Set DRAGONFLY_STATE_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires evolution to be enabled */
export const requireEvolve = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.evolveEnabled,
    "Evolution is disabled. Set DRAGONFLY_EVOLVE_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires spec module to be enabled */
export const requireSpec = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.specEnabled,
    "Spec module is disabled. Set DRAGONFLY_SPEC_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires repair module to be enabled */
export const requireRepair = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.repairEnabled,
    "Repair is disabled. Set DRAGONFLY_REPAIR_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires knowledge graph to be enabled */
export const requireKnowledgeGraph = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.kgEnabled,
    "Knowledge graph is disabled. Set DRAGONFLY_KG_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires analytics module to be enabled */
export const requireAnalytics = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.analyticsEnabled,
    "Analytics is disabled. Set DRAGONFLY_ANALYTICS_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires pipeline module to be enabled */
export const requirePipeline = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.pipelineEnabled,
    "Pipeline is disabled. Set DRAGONFLY_PIPELINE_ENABLED=true to enable.",
    handler,
  );

/** Guard that requires bridge module to be enabled */
export const requireBridge = (handler: HandlerFn) =>
  withConfigGuard(
    (cfg) => cfg.bridgeEnabled,
    "Bridge is disabled. Set DRAGONFLY_BRIDGE_ENABLED=true to enable.",
    handler,
  );
