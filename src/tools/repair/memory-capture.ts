/**
 * Repair Memory Capture
 *
 * Persists successful repair events as evolve test cases in the memory store.
 * Accumulated test cases are surfaced by evolve_start when use_memory_test_cases:true,
 * turning real project failures into evolve training data over time.
 *
 * Fire-and-forget — callers use `.catch(() => {})` and never await.
 */

import { createLazyLoader } from "../../utils/lazy.js";
import { MemoryStore } from "../memory/store.js";
import { config } from "../../core/config.js";

const getMemoryStore = createLazyLoader(() => new MemoryStore(config().memoryDbPath));

export interface EvolveTestCaseInput {
  /** Error context presented to the skill as input (code snippet + error) */
  input: string;
  /** Fix approach that resolved or addressed the error — the expected output */
  expected: string;
  /** Language the error occurred in */
  language: string;
  /** Error category (e.g. "type_error", "test_failure", "null_reference") */
  errorType: string;
  /** Workflow concept where the error occurred — informs which skill to evolve */
  conceptHint: string;
  /** True if the fix was confirmed to work (run_with_verification passed, etc.) */
  resolved: boolean;
}

/**
 * Store a repair event as an evolve test case.
 * Confidence reflects resolution certainty: 0.9 when confirmed resolved, 0.6 when suggested only.
 */
export async function captureEvolveTestCase(params: EvolveTestCaseInput): Promise<void> {
  const cfg = config();
  if (!cfg.memoryEnabled) return;

  const store = getMemoryStore();
  store.insertMemory({
    type: "episodic",
    content: JSON.stringify({ input: params.input, expected: params.expected }),
    summary: `${params.errorType} repair in ${params.language} — ${params.resolved ? "confirmed fix" : "suggested fix"} for ${params.conceptHint}`,
    confidence: params.resolved ? 0.9 : 0.6,
    source: "repair",
    category: "evolve-test-case",
    tags: ["evolve-test-case", params.language, params.errorType, params.conceptHint].filter(
      (t) => t.length > 0,
    ),
    archived: false,
  });
}
