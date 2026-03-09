# Pipeline Module

**Module:** `pipeline`
**Tools:** 2 (`dragonfly_compose`, `dragonfly_flow_plan`)
**Feature flag:** `DRAGONFLY_PIPELINE_ENABLED` (default: `true`)
**Storage:** None — pure computation, no I/O
**Always enabled:** No — opt-in via feature flag or always-on default

---

## Academic Foundation: The WYSIWID Paper

The Pipeline module is grounded in peer-reviewed research from MIT CSAIL:

**"What You See Is What It Does: A Structural Pattern for Legible Software"**
Eagon Meng & Daniel Jackson — MIT CSAIL, Electrical Engineering and Computer Science
*Proceedings of the 2025 ACM SIGPLAN International Symposium on New Ideas, New Paradigms, and Reflections on Programming and Software (Onward! '25)*
Singapore, October 20–24, 2025, pages 178–193
DOI: [10.1145/3759429.3762628](https://doi.org/10.1145/3759429.3762628)
arXiv: [2508.14511](https://arxiv.org/abs/2508.14511)

Daniel Jackson is a Professor of EECS at MIT, Associate Director of MIT CSAIL, and author of *The Essence of Software*.

### The WYSIWID Principle

Traditional software architecture scatters a feature's logic across multiple files and modules — what Jackson calls the **feature fragmentation problem**. To understand what the system does when you invoke a feature, you must trace execution across a dozen layers. The behavior is hidden inside the code.

WYSIWID (What You See Is What It Does) proposes a structural pattern that inverts this:

> **Concepts** — self-contained, independent units of functionality with explicit state.
> **Synchronizations** — declarative rules that coordinate concepts, making their interactions visible.
> **The behavior of the system is legible from reading the synchronization rules alone.**

Applied to LLM-assisted development, this means:
- A **concept** is a workflow phase (story, architecture, implementation, quality) with its own state, inputs, and outputs
- A **synchronization** is a YAML rule declaring when one concept triggers another
- The **pipeline DSL** is a compact notation for expressing which concepts run, in what order, with what model constraints

The WYSIWID property is preserved when: you can read the pipeline DSL and know exactly what will happen, in what order, at what cost, with what preconditions — without reading the implementation code.

### Why WYSIWID Matters for LLM Workflows

Five reasons from the research applied to our context:

1. **Explicit dependencies are analyzable.** An LLM can reason about a DSL string like `story | architecture:opus | parallel(implementation, security) | quality | version` without reading hundreds of lines of orchestration code.

2. **Predictable behavior from reading rules.** Any developer reading the synchronization rules or pipeline DSL knows exactly what happens next. No hidden state, no implicit triggers.

3. **Independent concepts reduce coupling.** Concepts never call each other directly — they communicate through file-based state, orchestrated by sync rules. This makes each concept independently testable and replaceable.

4. **Complete provenance.** Every concept execution leaves a typed artifact (story file, architecture file, implementation record). The trail is readable.

5. **Declarative state enables reasoning.** Preconditions are explicit: architecture requires a ready story; implementation requires a completed architecture. These constraints are checkable before execution, not discovered after failure.

---

## What the Pipeline Module Does

The Pipeline module provides two tools that implement the planning layer of the WYSIWID architecture:

1. **`dragonfly_compose`** — Parse, validate, and render pipeline DSL strings
2. **`dragonfly_flow_plan`** — Generate a structured execution plan from a DSL with cost/duration estimates, dependency resolution, and precondition checking

The Pipeline module is **pure computation** — no database, no network, no file I/O. Every call completes in < 1ms. The MCP round-trip overhead (stdio IPC) exceeds the actual computation time.

---

## Concepts Reference

The Pipeline recognizes 11 concepts. Each concept corresponds to an agent that executes it.

| Concept | Default Action | Default Model | Agent | Base Cost |
|---|---|---|---|---|
| `story` | create | sonnet | story-concept | $0.005 |
| `architecture` | design | **opus** | architecture-concept | $0.020 |
| `implementation` | generate | sonnet | implementation-concept | $0.010 |
| `quality` | review | sonnet | quality-concept | $0.008 |
| `version` | commit | sonnet | version-concept | $0.002 |
| `security` | threat_model | sonnet | security-concept | $0.010 |
| `documentation` | generate | sonnet | documentation-concept | $0.005 |
| `verification` | verify | sonnet | verification-concept | $0.008 |
| `code-analysis` | context | sonnet | code-analysis-concept | $0.003 |
| `context` | compress | sonnet | context-concept | $0.001 |
| `retrospective` | analyze | sonnet | retrospective-concept | $0.003 |

**Model cost multipliers:** haiku 0.2×, sonnet 1.0×, opus 5.0×

**Architecture always uses Opus** — the research rationale: architectural decisions require deep reasoning and have the highest downstream cost if wrong. The Opus multiplier (5×) is justified by the cost of rework from poor architectural decisions.

### Concept Aliases

Shorthand aliases for common concepts:

| Alias | Resolves To |
|---|---|
| `arch` | `architecture` |
| `impl` | `implementation` |
| `verify` | `verification` |
| `docs` | `documentation` |
| `sec` | `security` |
| `retro` | `retrospective` |
| `qa` | `quality` |
| `ship` | `version` |

---

## DSL Syntax Reference

### Basic Sequential Pipeline

Concepts separated by `|` execute in order. Each must complete before the next begins.

```
story | architecture | implementation | quality | version
```

### Parallel Execution

Multiple concepts in `parallel(...)` execute simultaneously. Duration is `MAX` of the group, not `SUM`.

```
story | parallel(architecture, security) | implementation | quality | version
```

### Model Hints

Override the default model for a concept using `:model` notation.

```
architecture:opus | implementation:sonnet | verification:haiku
```

Valid models: `opus`, `sonnet`, `haiku`

### Pass Counts

Run a concept multiple times using `[N]` notation. Multiplies cost and duration by N.

```
verification[2] | quality[3]
```

Typical range: 1–3. Counts > 5 trigger a validation warning.

### Custom Actions

Override the default action for a concept using `.action` notation.

```
quality.review | quality.test | security.threat_model
```

### Annotations

Append `@slo:profile` and `@errors:policy` to the pipeline string.

```
story | architecture | implementation @slo:standard @errors:graceful
```

**SLO profiles:** `architecture`, `verification`, `implementation`, `quality`, `quick`, `context`, `mcp`, `zero`, `test_generation`, `execution_loop`, `coverage`, `security`, `documentation`, `standard`, `fast`, `thorough`

**Error policies:** `graceful`, `strict`, `lenient`, `best_effort`

### Full Extended Syntax

Combine all features:

```
story | parallel(arch:opus, sec) | impl:sonnet | verification[2]:sonnet | qa @slo:standard @errors:graceful
```

### Parsing Order (within a concept reference)

Right-to-left: `concept.action[passes]:model`

1. Extract model (after last `:` if it matches a known model name)
2. Extract passes (content of `[N]`)
3. Extract action (after `.`)
4. Resolve concept name and aliases

---

## Validation Rules

### Errors (pipeline is invalid, cannot be planned)

| Rule | Example that fails |
|---|---|
| Empty pipeline | `""` |
| Unknown concept | `story \| unknownstep` |
| Unknown model | `architecture:gpt4` |
| `parallel()` with fewer than 2 concepts | `parallel(story)` |

### Warnings (pipeline is valid but suspicious)

| Warning | Condition |
|---|---|
| Unusual pass count | `verification[8]` (> 5) |
| Duplicate concept | `story \| story \| implementation` |
| Story not first | `architecture \| story` |
| Implementation before architecture | `implementation \| architecture` |
| Unknown SLO profile | `@slo:nonexistent` |
| Unknown error policy | `@errors:unknown` |

---

## Tools

### `dragonfly_compose`

Parse, validate, render, or list concepts for a pipeline DSL.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `dsl` | string | Yes | Pipeline DSL string |
| `action` | enum | No | `parse`, `validate`, `render`, `list_concepts` (default: `validate`) |

**Actions:**

`parse` — Tokenize and parse the DSL into a structured Pipeline object with steps and annotations.

`validate` — Parse and validate. Returns errors (blocking) and warnings (advisory).

`render` — Parse, validate, and render as an ASCII flow diagram. Example:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ① story
      ↓
  ② ┌─ architecture (opus)
     └─ security
      ↓
  ③ implementation
      ↓
  ④ quality
      ↓
  ⑤ version
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

`list_concepts` — Returns all known concepts, aliases, models, and syntax examples. Useful for exploring available options.

**When to use:** Before `dragonfly_flow_plan` to validate a DSL string. Or to visualize a pipeline for review.

---

### `dragonfly_flow_plan`

Generate a full execution plan from a pipeline DSL.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `dsl` | string | Yes | Pipeline DSL string |
| `story_id` | string | No | Story ID for precondition resolution |
| `from_step` | number | No | Start from step N (resume from checkpoint) |

**Returns:** An `ExecutionPlan` object containing:

```typescript
{
  plan_id: string,               // "plan-XXXXX"
  pipeline_dsl: string,          // original input
  story_id?: string,
  created_at: string,
  status: "valid" | "invalid" | "ready",
  steps: ExecutionStep[],
  validation: ValidationResult,
  estimated_cost_usd: number,
  estimated_duration_ms: number,
  start_from_step?: number
}
```

**Each `ExecutionStep`:**

```typescript
{
  step_number: number,
  concept: string,
  action: string,
  model?: string,
  passes: number,
  preconditions: PreconditionSpec[],
  blocked_by?: number[],         // step numbers that must complete first
  parallel_with?: number[],      // step numbers running simultaneously
  instructions: string           // human-readable step description
}
```

**Precondition types:**

| Type | Checks |
|---|---|
| `file_exists` | A required artifact file exists |
| `status_equals` | An artifact's status field matches expected value |
| `field_not_empty` | A required field has a value |

**Per-concept preconditions:**

| Concept | Requires |
|---|---|
| story | Nothing |
| architecture | story file exists + story.status == "ready" |
| implementation | architecture file exists + architecture.status == "completed" |
| quality | implementation file exists + implementation.files_changed not empty |
| version | review file exists + review.status == "approved" |
| security, verification, code-analysis, documentation, context, retrospective | Nothing (can run standalone) |

**Duration calculation:** Parallel groups use `MAX(durations)`, not `SUM`. Sequential groups use `SUM`.

**Example output for `"story | parallel(architecture, security) | implementation"`:**

```json
{
  "plan_id": "plan-a1b2c",
  "estimated_cost_usd": 0.048,
  "estimated_duration_ms": 125000,
  "steps": [
    { "step_number": 1, "concept": "story", "action": "create", "model": "sonnet", "passes": 1, "blocked_by": [], "instructions": "Step 1: story.create" },
    { "step_number": 2, "concept": "architecture", "action": "design", "model": "opus", "passes": 1, "blocked_by": [1], "parallel_with": [3], "instructions": "Step 2 (parallel): architecture.design" },
    { "step_number": 3, "concept": "security", "action": "threat_model", "model": "sonnet", "passes": 1, "blocked_by": [1], "parallel_with": [2], "instructions": "Step 3 (parallel): security.threat_model" },
    { "step_number": 4, "concept": "implementation", "action": "generate", "model": "sonnet", "passes": 1, "blocked_by": [2, 3], "instructions": "Step 4: implementation.generate" }
  ]
}
```

---

## Integration Assessment

### Current State: Critical Integration Gap

The Pipeline module is **not integrated** into the Framework module's workflow orchestration. Two parallel planning systems exist with no connection:

**System 1 — Framework's `workflow-planner.ts`:**
- Uses hardcoded switch statements keyed on task type (`bugfix`, `feature`, `refactor`, `docs`)
- Keyword matching for classification (`"fix"`, `"bug"` → bugfix)
- Hardcoded concept sequences per task type
- No DSL generation, no validation, no preconditions
- Returns `WorkflowPlan` with `WorkflowStep[]`

**System 2 — Pipeline module:**
- DSL-driven: `parsePipeline()` → `validatePipeline()` → `generatePlan()`
- Full validation with errors and warnings
- Precondition checking per concept
- Parallel execution modeling
- Cost/duration estimates with model multipliers
- Returns `ExecutionPlan` with `ExecutionStep[]`

**The result:** `dragonfly_compose` and `dragonfly_flow_plan` are **never automatically invoked**. They are standalone tools that Claude must be explicitly told to use. The WYSIWID principle is violated — the workflow behavior is hidden in switch statements, not readable from a DSL.

### The Design Goal

Per the WYSIWID principle, **concepts should be invoked automatically based on declared rules, not through imperative calls**. The goal is:

- Claude recognizes a task is multi-step → automatically composes the appropriate pipeline DSL
- The DSL is validated and an execution plan generated before any concept runs
- Concepts execute in order per the plan, with preconditions checked
- The user sees the DSL and can understand the entire workflow at a glance

This is the difference between:
- **Current:** "Please call dragonfly_compose with `story | architecture | implementation`"
- **Goal:** Claude analyzes the task, generates the DSL internally, validates it, presents the plan, then executes each concept automatically

---

## Improved Design: Pipeline-Driven Framework

### Change 1: Unify Planning Through Pipeline DSL

**Problem:** `workflow-planner.ts` uses hardcoded switch statements instead of Pipeline DSL.

**Fix:** Add `recommendDsl()` to generate the appropriate DSL from task classification, then route through Pipeline's `parsePipeline` + `generatePlan`.

**File:** `src/tools/framework/workflow-planner.ts`

```typescript
import { parsePipeline, validatePipeline } from "../pipeline/composer.js";
import { generatePlan } from "../pipeline/planner.js";

/**
 * Recommend a pipeline DSL string from task type and complexity.
 * This is the WYSIWID-compliant planning layer — behavior is visible
 * from the DSL string, not buried in switch statements.
 */
function recommendDsl(taskType: TaskType, complexity: string): string {
  switch (taskType) {
    case "bugfix":
      if (complexity === "large") return "story | architecture | implementation | quality | version";
      if (complexity === "small") return "implementation | quality";
      return "implementation | quality | version";

    case "docs":
      return "documentation";

    case "refactor":
      if (complexity === "large") return "story | architecture | implementation | quality | version";
      if (complexity === "medium") return "architecture | implementation | quality | version";
      return "implementation | quality | version";

    case "feature":
    default:
      if (complexity === "large") return "story | parallel(architecture, security) | implementation | quality | version";
      if (complexity === "small") return "story | implementation | quality";
      return "story | architecture | implementation | quality | version";
  }
}

export async function planWorkflow(task: string, context?: string): Promise<WorkflowPlan> {
  const taskType = classifyTask(task);
  let complexity = estimateComplexity(task, context);
  // ... memory recall ...

  // Generate WYSIWID-compliant DSL
  const dsl = recommendDsl(taskType, complexity);
  const pipeline = parsePipeline(dsl);
  const validation = validatePipeline(pipeline);
  const executionPlan = generatePlan(pipeline, validation);

  // Map ExecutionStep[] → WorkflowStep[] (enrich with agent + skills)
  const steps: WorkflowStep[] = executionPlan.steps.map(step => buildStepFromExecution(step));

  return {
    task,
    taskType,
    complexity,
    pipelineDsl: dsl,                    // NEW: visible DSL
    steps,
    skippedSteps: [],
    totalEstimatedCost: executionPlan.estimated_cost_usd,
    estimatedDurationMs: executionPlan.estimated_duration_ms,  // NEW: duration
    reasoning: `...`,
  };
}
```

**Impact:**
- `dragonfly_plan_workflow` now returns the DSL alongside the plan — Claude can read it
- Planning is WYSIWID-compliant: the DSL IS the workflow declaration
- Concept definitions and cost estimates stay in one place (Pipeline module)
- Eliminates hardcoded switch statement duplication

### Change 2: Expose DSL in `WorkflowPlan` Type

**File:** `src/tools/framework/types.ts`

Add to `WorkflowPlan`:
```typescript
export interface WorkflowPlan {
  task: string;
  taskType: string;
  complexity: "small" | "medium" | "large";
  pipelineDsl: string;           // NEW: the WYSIWID-legible pipeline
  estimatedDurationMs: number;   // NEW: from Pipeline planner
  steps: WorkflowStep[];
  skippedSteps: Array<{ concept: string; reason: string }>;
  totalEstimatedCost: number;
  reasoning: string;
}
```

### Change 3: Update Tool Descriptions

**File:** `src/tools/framework/index.ts`

Update `dragonfly_plan_workflow` description:
```typescript
description: "Analyze a task and compose a WYSIWID-compliant pipeline DSL, then generate a validated execution plan with cost/duration estimates, parallel execution modeling, and precondition checking. Returns the pipeline DSL string alongside the step-by-step plan so the workflow is legible at a glance.",
```

Update `dragonfly_start_workflow` description:
```typescript
description: "Compose and validate a pipeline for the task, start a tracked workflow session, and return the enriched first concept step. The pipeline DSL is automatically recommended based on task type and complexity — no manual composition required. Concepts execute sequentially per the WYSIWID plan.",
```

### Change 4: Auto-Invoke Pipeline in Agent System Prompts

**Problem:** Concept agents (story-concept.md, architecture-concept.md, etc.) don't know they're executing within a pipeline context. They can't reference the plan or know what comes next.

**Fix:** When `dragonfly_start_workflow` enriches an agent prompt, inject the pipeline DSL and step context:

```typescript
// In enrichAgentPrompt(), add pipeline context section:
if (pipelineDsl && currentStepNumber && totalSteps) {
  body = `## Pipeline Context\n\nYou are executing step ${currentStepNumber} of ${totalSteps} in this workflow:\n\`\`\`\n${pipelineDsl}\n\`\`\`\n\n---\n\n${body}`;
}
```

**Impact:** Every concept agent sees the full pipeline — it knows what came before, what comes after, and can tailor its output to hand off cleanly to the next concept.

### Change 5: Make Pipeline Automatic for Multi-Step Tasks

**Problem:** Claude must be explicitly told to use `dragonfly_compose` or `dragonfly_start_workflow` for multi-step work. For simple tasks, Claude often just starts doing the work without any pipeline orchestration.

**Fix:** Update the `dragonfly_plan_workflow` tool description to trigger automatically:

```typescript
description: "...(auto-trigger guidance)... For any task requiring more than one concept (feature development, refactoring, bug investigation, multi-file changes), call this tool FIRST to get an optimized execution plan before starting work.",
```

And add a skill that guides Claude to use pipeline planning for complex tasks:

**New skill: `templates/skills/pipeline-planning.md.template`**
```markdown
---
name: pipeline-planning
description: Use pipeline planning for multi-step development tasks
trigger_keywords: ["implement", "feature", "build", "refactor", "add", "create", "fix", "design"]
applies_to: ["*"]
priority: high
---

For any task requiring multiple workflow phases, call dragonfly_plan_workflow FIRST.

This generates a WYSIWID-compliant pipeline that shows the complete workflow:
- Which concepts execute (story, architecture, implementation, quality, etc.)
- In what order and whether any run in parallel
- Cost and duration estimates upfront
- Preconditions checked before execution

Then call dragonfly_start_workflow to begin execution.

The pipeline DSL in the response tells you everything about the workflow at a glance:
`story | architecture:opus | parallel(implementation, security) | quality | version`
```

---

## Compute Efficiency Analysis

### Is the Pipeline compute-efficient in MCP?

**Yes — it is among the lightest operations in the plugin.**

What each Pipeline call actually computes:
- DSL parsing: regex tokenization over a short string — microseconds
- Validation: array `.includes()` lookups — microseconds
- Plan generation: object construction + simple arithmetic — microseconds
- BFS dependency resolution: over at most ~15 steps — microseconds

The MCP IPC round-trip (~1–10ms) is the dominant cost, not the computation. The Pipeline module adds zero observable latency from the user's perspective.

### Can Apple Silicon Hardware Help?

**No — and this is the correct answer for this module.**

| Hardware | Targets | Pipeline uses? |
|---|---|---|
| ANE (Neural Engine) | CoreML/ONNX inference | No ML inference |
| Metal GPU | Parallel matrix compute | No matrix math |
| AMX (matrix coprocessor) | BLAS vector operations | No vector ops |
| Performance CPU cores | Single-threaded compute | ✅ Already used |

The Pipeline is pure synchronous JavaScript logic. The P-cores on Apple Silicon are already the optimal hardware. There is no workload to accelerate.

**Contrast:** The Semantic, Memory, and Knowledge Graph modules DO benefit from ANE (~5× speedup on embedding generation). Pipeline does not embed, does not search, does not do inference.

### Should Pipeline be External (CLI) or MCP?

**MCP is the correct placement.** Comparison:

| | MCP tool call | CLI subprocess |
|---|---|---|
| Per-call overhead | 1–10ms | 10–50ms (subprocess spawn) |
| Output | Structured JSON | Text requiring parsing |
| Claude integration | Direct | Via Bash tool + parsing |
| Session sharing | Same process | Separate process |

The CLI approach (`koan compose` / `koan flow` in zen) is useful for developer tooling but adds subprocess overhead and loses structured output. As an MCP tool, the Pipeline returns typed JSON that Claude can reason about directly.

---

## Recommended Workflow Pattern

After the planned integration improvements, the typical workflow becomes:

```
1. User: "Add authentication to the API"

2. Claude automatically calls dragonfly_plan_workflow
   → Returns: pipeline DSL + step plan + cost estimate
   → DSL: "story | architecture:opus | parallel(implementation, security) | quality | version"
   → Estimated cost: $0.058, duration: ~3 minutes

3. Claude presents the plan for confirmation (or proceeds if autonomous)

4. dragonfly_start_workflow
   → Creates session, enriches story-concept agent with pipeline context
   → Returns: first step instructions with full pipeline context

5. [story-concept agent executes]
   → Captures requirements, creates story artifact

6. dragonfly_advance_workflow (outcome: success)
   → Evaluates sync rules
   → Returns: architecture-concept enriched prompt (second step)
   → Parallel: architecture + security start simultaneously

7. [architecture-concept and security-concept execute in parallel]

8. dragonfly_advance_workflow × 2 (both complete)
   → Returns: implementation-concept step

9. [implementation-concept executes]

10. Continue through quality → version → done
```

**The key change:** Claude does not need to be told "use the pipeline." The tool descriptions and planning skill ensure pipeline planning happens automatically for multi-step tasks. Concepts are orchestrated by the plan, not by explicit user instruction at each step.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DRAGONFLY_PIPELINE_ENABLED` | `true` | Enable/disable the module |

No other configuration. The Pipeline is stateless and configurationless by design — consistent with the WYSIWID principle that behavior comes from the declared rules, not from configuration.

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/pipeline/types.ts` | DSL types, ExecutionPlan, PreconditionSpec |
| `src/tools/pipeline/composer.ts` | Parser, validator, renderer |
| `src/tools/pipeline/planner.ts` | Execution plan generator with cost/duration |
| `src/tools/pipeline/preconditions.ts` | Per-concept precondition definitions |
| `src/tools/pipeline/index.ts` | MCP tool registration |
| `src/tools/framework/workflow-planner.ts` | Task classifier (to be integrated with Pipeline) |

---

## Research Citations

- Meng, E. & Jackson, D. (2025). *What You See Is What It Does: A Structural Pattern for Legible Software.* Proceedings of Onward! '25. DOI: 10.1145/3759429.3762628
- Jackson, D. (2021). *The Essence of Software: Why Programs Disagree and How to Make Them Agree.* Princeton University Press.
- Meyer, B. (1992). *Applying Design by Contract.* IEEE Computer.
- Moreau, L. & Missier, P. (2013). *PROV-DM: The PROV Data Model.* W3C Recommendation.
