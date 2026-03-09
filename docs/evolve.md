# Evolve Module

**Module:** `evolve`
**Tools:** 4
**Feature flag:** `DRAGONFLY_EVOLVE_ENABLED` (default: enabled)
**Storage:** `state.db` (evolution sessions and variants)

---

## Overview

The Evolve module implements genetic algorithm-based prompt optimization. Claude drives the mutation and evaluation loop (generating and scoring variant prompts), while Dragonfly manages population state, selection pressure, and convergence detection. The design is a collaborative human-AI optimization loop — Claude's language understanding guides creative mutation, while the algorithm provides systematic selection and progress tracking.

This implements a hybrid approach validated by three independent research programs: APE (automated prompt generation + scoring), OPRO (LLMs as optimizers), and EvoPrompting (evolutionary operators applied to prompts).

---

## Quick Reference

| Tool | Description |
|---|---|
| `evolve_start` | Create an evolution session and get initial instructions |
| `evolve_submit` | Submit evaluated variants and get next generation instructions |
| `evolve_status` | Check session progress and convergence |
| `evolve_best` | Get the winning variant; optionally save as skill |

---

## Tools

### `evolve_start`

Create an evolution session. Returns instructions for Claude to generate and evaluate the first population of variant prompts.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `concept_name` | string | Yes | What's being optimized (e.g., "code-review-prompt", "bug-triage") |
| `initial_prompt` | string | Yes | Starting prompt to evolve |
| `test_cases` | array | Yes | Fitness evaluation criteria: `[{ input: string, expected: string }]` |
| `population_size` | number | No | Variants per generation (default: 5) |
| `max_generations` | number | No | Maximum generations before stopping (default: 10) |
| `mutation_rate` | number | No | Probability 0-1 of applying a mutation operator (default: 0.7) |

**Returns:**
```
{
  session_id: string,
  generation: 0,
  instructions: string    // directions for Claude to generate + score population_size variants
}
```

**Workflow:** After receiving this response, Claude generates `population_size` variant prompts, evaluates each against the test cases, assigns fitness scores (0.0–1.0), and calls `evolve_submit`.

---

### `evolve_submit`

Submit evaluated variants and advance the evolution. Returns selection results and mutation instructions for the next generation, or a completion message if converged or max generations reached.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | Yes | Evolution session ID |
| `variants` | array | Yes | Evaluated variant prompts: `[{ prompt: string, fitness_score: number (0-1), notes?: string }]` |

**Returns (if active — more generations to run):**
```
{
  generation: number,
  best_fitness: number,
  status: "active",
  parents: [{
    prompt: string,
    fitness: number,
    weaknesses: string
  }],
  instructions: string    // mutation instructions with seed variants for next generation
}
```

**Returns (if converged or completed):**
```
{
  generation: number,
  best_fitness: number,
  status: "converged" | "completed",
  message: string         // "Call evolve_best to get the winning prompt"
}
```

**Selection algorithm:**
1. Tournament selection (k=3): draw 3 random candidates, select the best. Repeat `population_size` times.
2. Elite preservation: top 2 variants always carry forward regardless of tournament results.
3. Deduplication: combine elites + tournament winners into unique parent set.
4. Seed variants: apply mutation operators + crossover to parents to generate concrete starting points for Claude.

---

### `evolve_status`

Check evolution session progress and statistics.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | Yes | Evolution session ID |

**Returns:**
```
{
  session_id: string,
  concept_name: string,
  status: "active" | "converged" | "completed",
  current_generation: number,
  max_generations: number,
  best_fitness: number,
  improvement_pct: number,      // improvement vs. generation 1 baseline
  variants_evaluated: number,
  convergence_window: number[]  // best fitness for last 3 generations
}
```

---

### `evolve_best`

Get the winning variant from an evolution session. Optionally save it as a reusable skill template.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | Yes | Evolution session ID |
| `save_as_skill` | boolean | No | If true, write the winning prompt as a `.claude/skills/{skill_name}.md` file (default: false) |
| `skill_name` | string | No | Override the skill file name (default: `concept_name`, sanitized to kebab-case) |

**Returns:**
```
{
  prompt: string,               // the winning prompt text
  fitness_score: number,        // final fitness (0-1)
  generation: number,           // which generation produced the winner
  improvement_pct: number,      // vs. generation 1 best
  initial_prompt: string,       // the starting prompt for comparison
  total_variants_evaluated: number,
  // if save_as_skill=true:
  skill_saved: boolean,
  skill_path: string            // absolute path to written .md file
}
```

---

## Algorithm Details

### Selection: Tournament (k=3)

Draw 3 variants at random from the current generation, select the one with the highest fitness. Repeat `population_size` times to build the parent pool. Tournament selection provides selection pressure while maintaining diversity — unlike rank selection or fitness-proportionate selection (roulette wheel), it doesn't collapse to a single dominant individual.

### Elite Preservation

Top 2 variants by fitness always survive to the next generation unchanged. This guarantees the best-found solution is never lost to random variation (the "elitism" property).

### Convergence Detection

Evolution has converged if the best fitness hasn't improved by more than 0.01 across 3 consecutive generations. Formally: if `max(fitnessHistory[-3:]) - fitnessHistory[-4] < 0.01`.

### Mutation Operators (EvoPrompting, Chen et al. 2023)

Applied at `mutation_rate` probability. Three operators, chosen uniformly:
1. **Delete**: Remove a random non-first sentence.
2. **Insert**: Inject a focusing instruction at a random position. Candidates: "Be concise and specific." / "Think step by step." / "Focus on the most important aspects." / "Provide concrete examples." / "Prioritize correctness over completeness."
3. **Reorder**: Swap two random non-first sentences.

First sentence is always preserved (assumed to be the core instruction).

### Crossover (EvoPrompting)

Combines the first half of sentences from parent A with the second half from parent B. Outperforms mutation-only evolution in empirical tests (Chen et al., 2023).

### Seed Variants

Pre-mutated starting points provided to Claude alongside parent prompts. Gives Claude concrete variants to refine rather than starting from abstract instructions. Reduces generation variance and speeds convergence.

---

## Usage Pattern

```
1. evolve_start → session_id + initial instructions
2. [Claude generates + scores population_size variants]
3. evolve_submit → next generation instructions OR completion
4. [Repeat steps 2-3 until status != "active"]
5. evolve_best → winning prompt (optionally save as skill)
```

---

## Research Basis

| Work | Authors | Year | Relevance |
|---|---|---|---|
| **APE: Automatic Prompt Engineer** | Zhou et al., University of Toronto | ICLR 2023, arxiv.org/abs/2211.01910 | Automated prompt generation and scoring — foundational approach that Evolve extends with evolutionary operators |
| **OPRO: Optimization by PROmpting** | Yang et al., Google DeepMind | 2023, arxiv.org/abs/2309.03409 | LLMs as optimizers via natural language: "LLMs can follow verbal optimization trajectory descriptions" |
| **EvoPrompting** | Chen et al., NeurIPS | 2023, arxiv.org/abs/2302.14838 | Evolutionary algorithms for prompt optimization: sentence-level mutation operators + crossover — directly implemented here |
| **PromptBreeder** | Fernando et al., Google DeepMind | 2023, arxiv.org/abs/2309.16797 | Self-referential prompt evolution: mutation instructions themselves evolve |
| **DSPy** | Khattab et al., Stanford | 2023, arxiv.org/abs/2310.03714 | Compiling declarative LM programs via automated prompting — Evolve is the manual, interpretable variant |
| **Genetic Algorithms** | John Holland | 1975, "Adaptation in Natural and Artificial Systems" | Foundational GA theory: selection, mutation, crossover, fitness landscapes |
| **Tournament Selection** | Goldberg & Deb | 1991, FOGA | Tournament selection analysis: selection pressure vs. diversity tradeoff |

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `DRAGONFLY_EVOLVE_ENABLED` | `true` | Enable/disable the Evolve module |

---

## Integration

- **State module**: Stores evolution sessions and all variant history in `state.db`
- **Framework module**: Winning prompts can be saved as skill files and loaded by the Framework's skill system
- **Memory module**: Evolved prompts can be stored as memories for cross-session reuse
