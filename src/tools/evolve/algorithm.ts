/**
 * Evolution Algorithm
 * Tournament selection, elite preservation, and convergence detection.
 */

import type { EvolutionVariant } from "./types.js";

/**
 * Tournament selection: pick k random candidates, return the best.
 * Repeat `count` times to get multiple parents.
 */
export function tournamentSelect(
  variants: EvolutionVariant[],
  count: number,
  k: number = 3,
): EvolutionVariant[] {
  const parents: EvolutionVariant[] = [];
  for (let i = 0; i < count; i++) {
    const candidates: EvolutionVariant[] = [];
    for (let j = 0; j < k; j++) {
      candidates.push(variants[Math.floor(Math.random() * variants.length)]);
    }
    candidates.sort((a, b) => (b.fitnessScore ?? 0) - (a.fitnessScore ?? 0));
    parents.push(candidates[0]);
  }
  return parents;
}

/**
 * Get elite variants (top N by fitness) that always survive to the next generation.
 */
export function getElites(
  variants: EvolutionVariant[],
  count: number = 2,
): EvolutionVariant[] {
  return [...variants]
    .sort((a, b) => (b.fitnessScore ?? 0) - (a.fitnessScore ?? 0))
    .slice(0, count);
}

/**
 * Check if evolution has converged.
 * Converged = best fitness hasn't improved by more than `threshold`
 * for `window` consecutive generations.
 */
export function checkConvergence(
  fitnessHistory: number[],
  window: number = 3,
  threshold: number = 0.01,
): boolean {
  if (fitnessHistory.length < window + 1) return false;

  const recent = fitnessHistory.slice(-window);
  const baseline = fitnessHistory[fitnessHistory.length - window - 1];

  return recent.every((f) => f - baseline < threshold);
}

/**
 * Apply deterministic sentence-level mutation operators to a prompt.
 * Based on EvoPrompting (Chen et al., 2023) — delete, insert, or reorder sentences.
 * The mutationRate parameter (previously unused) now controls operator application probability.
 *
 * @param prompt - The prompt text to mutate
 * @param rate - Probability of applying a mutation (0.0–1.0)
 * @returns Mutated prompt, or original if rate not triggered or prompt too short
 */
export function applyMutation(prompt: string, rate: number): string {
  if (Math.random() > rate) return prompt;

  const sentences = prompt.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return prompt;

  const op = Math.random();

  if (op < 0.33 && sentences.length > 2) {
    // Delete: remove a random non-first sentence
    const idx = 1 + Math.floor(Math.random() * (sentences.length - 1));
    return sentences.filter((_, i) => i !== idx).join(" ");
  } else if (op < 0.66) {
    // Insert: add a focusing instruction at a random position
    const inserts = [
      "Be concise and specific.",
      "Think step by step.",
      "Focus on the most important aspects.",
      "Provide concrete examples.",
      "Prioritize correctness over completeness.",
    ];
    const insert = inserts[Math.floor(Math.random() * inserts.length)];
    const idx = Math.floor(Math.random() * sentences.length);
    const result = [...sentences];
    result.splice(idx, 0, insert);
    return result.join(" ");
  } else {
    // Reorder: swap two non-first sentences
    if (sentences.length < 3) return prompt;
    const i = 1 + Math.floor(Math.random() * (sentences.length - 1));
    const j = 1 + Math.floor(Math.random() * (sentences.length - 1));
    const result = [...sentences];
    [result[i], result[j]] = [result[j], result[i]];
    return result.join(" ");
  }
}

/**
 * Crossover: combine sentence-halves from two parent prompts.
 * Based on EvoPrompting finding that crossover outperforms mutation-only.
 * Takes the first half of sentences from parentA, second half from parentB.
 *
 * @returns Crossed prompt, or parentA if either parent is too short to split
 */
export function crossover(parentA: string, parentB: string): string {
  const sentA = parentA.split(/(?<=[.!?])\s+/).filter(Boolean);
  const sentB = parentB.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentA.length < 2 || sentB.length < 2) return parentA;
  const splitA = Math.ceil(sentA.length / 2);
  const splitB = Math.floor(sentB.length / 2);
  return [...sentA.slice(0, splitA), ...sentB.slice(splitB)].join(" ");
}

/**
 * Build mutation instructions for the next generation.
 * Includes pre-mutated seed variants when provided, giving Claude
 * deterministic starting points to refine further.
 */
export function buildMutationInstructions(
  parents: EvolutionVariant[],
  conceptName: string,
  populationSize: number,
  seedVariants?: string[],
): { parents: Array<{ prompt: string; fitness: number; weaknesses: string }>; instructions: string } {
  const parentInfo = parents.map((p) => ({
    prompt: p.prompt,
    fitness: p.fitnessScore ?? 0,
    weaknesses: p.notes ?? "No specific weaknesses noted",
  }));

  const seedSection = seedVariants && seedVariants.length > 0
    ? [
        ``,
        `Pre-mutated seed variants (start from these or improve further):`,
        ...seedVariants.map((s, i) => `  Seed ${i + 1}: "${s.slice(0, 120)}${s.length > 120 ? "..." : ""}"`),
      ]
    : [];

  const instructions = [
    `Generate ${populationSize} variant prompts for "${conceptName}".`,
    `Use these top-performing parents as starting points:`,
    ...parentInfo.map((p, i) =>
      `  Parent ${i + 1} (fitness: ${p.fitness.toFixed(2)}): "${p.prompt.slice(0, 100)}..."${p.weaknesses !== "No specific weaknesses noted" ? ` — Weakness: ${p.weaknesses}` : ""}`,
    ),
    ...seedSection,
    ``,
    `For each variant:`,
    `1. Take a parent (or seed) prompt and modify it to improve weaknesses`,
    `2. Keep the parts that scored well`,
    `3. Evaluate each variant against the test cases`,
    `4. Call evolve_submit with the scored variants`,
  ].join("\n");

  return { parents: parentInfo, instructions };
}
