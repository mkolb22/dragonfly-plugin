# Evolve Module

**Module:** `evolve`
**Tools:** 4 (`evolve_start`, `evolve_submit`, `evolve_status`, `evolve_best`)
**Feature flag:** `DRAGONFLY_EVOLVE_ENABLED` (default: enabled)
**Storage:** `stateDbPath` (evolution sessions and variant history)
**Always enabled:** No — opt-in via feature flag

---

## Quick Reference

| Tool | Description | Required Params |
|---|---|---|
| `evolve_start` | Initialize an evolution session for prompt optimization | `concept_name`, `initial_prompt`, `test_cases` |
| `evolve_submit` | Submit evaluated variants to advance the evolution | `session_id`, `variants` |
| `evolve_status` | Check session progress and convergence state | `session_id` |
| `evolve_best` | Retrieve the winning variant, optionally saving as a skill | `session_id` |

---

## Overview

The Evolve module implements genetic algorithm-based prompt optimization. It applies evolutionary computation — selection, crossover, mutation, and fitness evaluation — to the problem of finding the best version of a system prompt for a given task.

The architecture splits responsibility between the module and Claude. Dragonfly manages state, implements selection algorithms, applies mutation operators, tracks convergence, and persists variant history. Claude generates variant content, evaluates fitness by running variants against test cases, and scores each variant. This division is principled: Dragonfly handles the combinatorial bookkeeping efficiently; Claude contributes the semantic judgment that no algorithm can replace.

### Evolutionary Loop

```
evolve_start
     │  concept_name + initial_prompt + test_cases
     │  population_size, max_generations, mutation_rate
     ▼
Generation 0: seed variants (pre-mutated from initial prompt)
     │
Claude: evaluate each variant against test_cases → fitness_score
     │
evolve_submit (variants + scores)
     │
     ├─ Tournament selection (k=3) → select parents
     ├─ Elite preservation (top 2 always survive)
     ├─ Crossover (first half A + second half B)
     ├─ Mutation at mutation_rate:
     │   • Delete a sentence
     │   • Insert a focusing instruction
     │   • Reorder sentences
     ▼
Next generation: parent seeds + new variants
     │
     └─ [repeat until convergence or max_generations]
     ▼
evolve_best: winning variant + fitness history
```

**Convergence criterion:** Best fitness unchanged by more than 0.01 for 3 consecutive generations.

---

## Tools

### `evolve_start`

Initialize an evolution session. Returns generation 0 seed variants for Claude to evaluate. The seeds are pre-mutated from the initial prompt — they give Claude concrete variants to score rather than asking Claude to generate variants from scratch.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `concept_name` | string | Yes | — | What is being optimized, e.g. `"code-review-prompt"`, `"architecture-agent"` |
| `initial_prompt` | string | Yes | — | Starting prompt to evolve from |
| `test_cases` | array | Yes | — | Evaluation cases: `[{ input: string, expected: string }]` |
| `population_size` | number | No | `5` | Number of variants per generation |
| `max_generations` | number | No | `10` | Maximum generations before forced completion |
| `mutation_rate` | number (0–1) | No | `0.7` | Probability of applying a mutation operator to each variant |
| `use_memory_test_cases` | boolean | No | `false` | When `true`, appends accumulated `evolve-test-case` memories (repair events captured by the Repair module) to `test_cases`. Uses real project failures as evolution training data. Requires `memoryEnabled: true`. |

**Returns:**

```json
{
  "session_id": "evo_a3f7c2",
  "generation": 0,
  "test_cases_total": 7,
  "memory_test_cases_loaded": 4,
  "instructions": "Generate 5 variant prompts for \"code-review-prompt\". Start from this initial prompt: \"...\"\n\nEvaluate each variant against these 7 test case(s):\n  1. Input: \"Review this function: ...\" → Expected: \"Identifies the off-by-one error\"\n  ...\n\nFor each variant, assign a fitness_score from 0.0 to 1.0 based on how well it meets the expected outputs. Then call evolve_submit with the session_id and scored variants."
}
```

---

### `evolve_submit`

Submit Claude's scored variants to advance the evolution to the next generation. Dragonfly applies selection, crossover, and mutation to produce the next generation's seed variants for Claude to evaluate.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `session_id` | string | Yes | — | Evolution session ID |
| `variants` | array | Yes | — | Evaluated variants: `[{ prompt: string, fitness_score: number (0–1), notes?: string }]` |

**Returns (if evolution is active — more generations to run):**

```json
{
  "status": "active",
  "generation": 2,
  "best_fitness_so_far": 0.84,
  "parents": [
    "You are a code reviewer. Always begin by understanding the intent...",
    "You are a code reviewer. Structure feedback as: 1) Critical 2) Suggestions..."
  ],
  "seed_variants": [
    "You are a code reviewer. Always begin by understanding the intent. Structure feedback as: 1) Critical...",
    "You are a code reviewer. Structure feedback as: 1) Critical 2) Suggestions. Focus on the most impactful issues first..."
  ],
  "mutation_instructions": "Apply semantic mutations: try adding a constraint, removing a vague instruction, or reordering the guidance. Maintain the core meaning.",
  "instructions": "Evaluate each seed variant against all test cases, score fitness 0.0–1.0, then call evolve_submit again."
}
```

**Returns (if converged or completed):**

```json
{
  "status": "completed",
  "reason": "converged",
  "generations_run": 5,
  "best_fitness": 0.91,
  "instructions": "Call evolve_best to retrieve the winning variant."
}
```

---

### `evolve_status`

Check the current state of an evolution session without advancing it.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `session_id` | string | Yes | — | Evolution session ID |

**Returns:**

```json
{
  "session_id": "evo_a3f7c2",
  "concept_name": "code-review-prompt",
  "status": "active",
  "current_generation": 3,
  "max_generations": 10,
  "best_fitness": 0.87,
  "initial_fitness": 0.62,
  "improvement_pct": 40.3,
  "variants_evaluated": 20,
  "convergence_window": [0.84, 0.87, 0.87],
  "converged": false
}
```

`convergence_window` shows the best fitness for the last 3 generations. Convergence triggers when all three values are within 0.01 of each other.

---

### `evolve_best`

Retrieve the winning variant from a completed or converged evolution session. Optionally save the winning prompt as a skill file in `.claude/skills/`.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `session_id` | string | Yes | — | Evolution session to retrieve the winner from |
| `save_as_skill` | boolean | No | `false` | Write the winning prompt to `.claude/skills/` as a skill template |
| `skill_name` | string | No | `{concept_name}` | Override the skill file name |

**Returns:**

```json
{
  "prompt": "You are an expert code reviewer. Always begin by understanding the intent before critiquing. Structure feedback as: 1) Critical issues that affect correctness 2) Suggestions for improvement 3) What is done well. Be specific and actionable.",
  "fitness_score": 0.91,
  "generation": 4,
  "improvement_pct": 46.8,
  "initial_prompt": "You are a code reviewer. Find bugs and suggest improvements.",
  "total_variants_evaluated": 25,
  "skill_saved": true,
  "skill_path": "/Users/kolb/.dragonfly/content/../.claude/skills/code-review-prompt.md"
}
```

`skill_saved` and `skill_path` are only present when `save_as_skill: true`.

---

## Algorithm Details

### Tournament Selection

For each parent slot (repeated `population_size` times): select `k=3` variants at random from the current generation, return the one with the highest `fitness_score`. This produces selection pressure without eliminating low-fitness variants entirely — they can still be selected if they happen to be in a favorable tournament draw.

### Elite Preservation

The top 2 variants by `fitness_score` always survive to the next generation unchanged. This ensures the best solution found so far is never lost to mutation or crossover variance.

### Crossover

Take the first half of sentences from parent A and the second half from parent B. This implements single-point crossover at the sentence boundary closest to the midpoint. Crossover is applied to pairs of selected parents.

### Mutation Operators

Applied at `mutation_rate` probability to each variant. Three operators (from EvoPrompting, Chen et al. 2023):
1. **Delete**: Remove one sentence at random
2. **Insert**: Add a focusing instruction (e.g., "Be specific and actionable", "Think step by step")
3. **Reorder**: Shuffle the order of two randomly selected sentences

### Fitness Scoring Guidance

`fitness_score` should be in [0, 1] where:
- `0.0` — variant completely fails the test cases
- `0.5` — variant partially achieves the expected outputs
- `1.0` — variant fully and reliably achieves all expected outputs

Claude assigns scores; Dragonfly does not validate or normalize them. Consistent scoring within a session produces better selection; inconsistent scoring produces noisy evolution.

---

## Academic Foundation

### Automatic Prompt Engineer (APE)

Zhou, Y., Muresanu, A. I., Han, Z., Paster, K., Pitis, S., Chan, H., & Ba, J. (2022). *Large language models are human-level prompt engineers.* ICLR 2023. arXiv:2211.01910. https://arxiv.org/abs/2211.01910

APE (University of Toronto) frames prompt optimization as a program synthesis problem: generate candidate instructions, evaluate them on a dataset, select the best. APE demonstrated that LLM-generated prompts can match or exceed human-written prompts on benchmark tasks. The key contribution is the fitness evaluation protocol: measure prompt quality by running it against a standardized set of input-output pairs. The `test_cases` parameter in `evolve_start` directly implements APE's evaluation protocol — each test case is an input-output pair used to score prompt fitness.

### OPRO — Optimization by PROmpting

Yang, C., Wang, X., Lu, Y., Liu, H., Le, Q. V., Zhou, D., & Chen, X. (2023). *Large language models as optimizers.* arXiv:2309.03409. https://arxiv.org/abs/2309.03409

OPRO (Google DeepMind) uses an LLM as an optimizer: present the LLM with the current best solutions and their scores, ask it to generate a new improved solution. The LLM acts as both the generator and the optimizer. The Evolve module adopts OPRO's insight — that LLMs can improve prompts given feedback about what worked — but structures the optimization loop with genetic algorithm operators rather than pure LLM generation, providing more systematic exploration of the search space.

### EvoPrompting — Evolutionary Algorithms for Prompt Optimization

Chen, S., Hou, Y., Cui, Y., Chen, B., Su, J., & Fu, J. (2023). *EvoPrompting: Language models for code-level neural architecture search.* NeurIPS 2023. arXiv:2302.14838. https://arxiv.org/abs/2302.14838

EvoPrompting applies evolutionary computation to prompt optimization at the sentence level. The key contributions adopted by the Evolve module are: (1) sentence-level mutation operators (delete, insert, reorder) that preserve semantic coherence while exploring the prompt space; (2) crossover at sentence boundaries; (3) LLM-based fitness evaluation. EvoPrompting demonstrated that evolutionary operators at the sentence level outperform character-level or word-level operators for prompt optimization because sentences are the natural units of semantic meaning in instructions.

### PromptBreeder — Self-Referential Prompt Evolution

Fernando, C., Banarse, D., Michalewski, H., Osindero, S., & Rocktäschel, T. (2023). *PromptBreeder: Self-referential self-improvement via prompt evolution.* arXiv:2309.16797. https://arxiv.org/abs/2309.16797

PromptBreeder (Google DeepMind) extends prompt evolution to be self-referential: the mutation instructions themselves are evolved alongside the task prompts. The module's `mutation_instructions` field in `evolve_submit` responses implements a simplified version of this — the mutation guidance adapts based on what kinds of changes have proven productive in prior generations.

### DSPy — Compiling LM Programs via Automated Prompting

Khattab, O., Singhvi, A., Maheshwari, P., Zhang, Z., Shrivastava, M., Poeta, F., Hashlamoun, B., Timbrel, K., Guu, K., Hancock, B., & Potts, C. (2023). *DSPy: Compiling declarative language model calls into self-improving pipelines.* arXiv:2310.03714. https://arxiv.org/abs/2310.03714

DSPy (Stanford) frames LM pipeline optimization as a compilation problem: declare the pipeline in terms of modules and metrics, then compile it by automatically tuning the prompts for each module. The Evolve module addresses the same problem for individual prompts: given a task description (test cases) and a starting point (initial prompt), find the optimal prompt. DSPy uses gradient-free optimization with a different selection mechanism; the Evolve module uses genetic algorithms. Both validate against held-out test sets.

### Genetic Algorithms — Foundational Theory

Holland, J. H. (1975). *Adaptation in Natural and Artificial Systems: An Introductory Analysis with Applications to Biology, Control, and Artificial Intelligence.* University of Michigan Press. (2nd ed.: MIT Press, 1992.)

Holland's foundational GA framework establishes the schema theorem: short, high-fitness, low-order schemata (building blocks) receive exponentially increasing representation in successive generations. Applied to prompt evolution: short, effective instructional sentences are the building blocks; crossover combines proven sentences from two parents; selection amplifies sentences that contribute to high fitness. The tournament selection (k=3), elite preservation (top 2), and single-point crossover at sentence boundaries in the Evolve module are direct implementations of Holland's canonical GA.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DRAGONFLY_EVOLVE_ENABLED` | `true` | Enable or disable the Evolve module |

---

## Integration with Other Modules

**Framework module:** Skills saved by `evolve_best` (with `save_as_skill: true`) are written to `.claude/skills/` and immediately available to `dragonfly_get_skills`. This is the primary feedback loop: evolved prompts become framework skills that improve all future concept executions using that prompt.

**Memory module:** The `use_memory_test_cases` parameter reads accumulated `evolve-test-case` memories (category `"evolve-test-case"`) from `memory.db` via `MemoryStore.listByCategory()`. These are repair events stored by the Repair module, giving the evolution real project failure data rather than only hand-crafted test cases. Evolved winning prompts are also candidates for `memory_store` with `type: "procedural"`.

**Repair module (feedback loop):** The Repair module's `memory-capture.ts` automatically stores every repair event as an `evolve-test-case` memory. When `use_memory_test_cases: true` is passed to `evolve_start`, those entries are loaded and appended to the test cases, turning accumulated bug history into a fitness evaluation dataset. This creates a closed feedback loop: bugs encountered in real workflows improve the Skills that guide future implementations.

**Analytics module:** `dragonfly_learn_patterns` emits an `evolve_hint` when high-confidence patterns (≥10 occurrences, ≥80% success rate) are found, listing which concept Skills are ready for prompt optimization and providing a suggested `evolve_start` workflow.

**State module:** Evolution session state (current generation, variant history, fitness scores) is persisted in `stateDbPath`, enabling sessions to survive plugin restarts and be resumed with `evolve_submit`.

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/evolve/store.ts` | `EvolveStore` — SQLite session + variant persistence, `getBestVariant`, `getVariants`, `insertVariants` |
| `src/tools/evolve/algorithm.ts` | Tournament selection (k=3), elite preservation, crossover, mutation operators, convergence check, `buildMutationInstructions` |
| `src/tools/evolve/types.ts` | `TestCase` and related type definitions |
| `src/tools/evolve/index.ts` | MCP tool registration and all handler logic |
