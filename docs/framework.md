# Framework Module

**Module:** `framework`
**Tools:** 8 (`dragonfly_get_concept`, `dragonfly_get_workflow`, `dragonfly_get_agent_prompt`, `dragonfly_get_skills`, `dragonfly_plan_workflow`, `dragonfly_start_workflow`, `dragonfly_advance_workflow`, `dragonfly_get_workflow_state`)
**Feature flag:** None
**Storage:** `stateDbPath` (workflow sessions and history); reads concept/skill/workflow content from `DRAGONFLY_FRAMEWORK_CONTENT_ROOT`
**Always enabled:** Yes

---

## Quick Reference

| Tool | Description | Required Params |
|---|---|---|
| `dragonfly_get_concept` | Retrieve the definition and system prompt for a named concept | `name` |
| `dragonfly_get_workflow` | Retrieve the workflow configuration and concept sequence | None |
| `dragonfly_get_agent_prompt` | Get the full system prompt text for a concept agent | `concept` |
| `dragonfly_get_skills` | List available skill templates, optionally filtered by concept | None |
| `dragonfly_plan_workflow` | Recommend the next workflow steps given current state | None |
| `dragonfly_start_workflow` | Initialize a new workflow session for a story | `story_id` |
| `dragonfly_advance_workflow` | Move workflow forward after a concept step completes | `story_id`, `completed_concept`, `status` |
| `dragonfly_get_workflow_state` | Retrieve current execution state for a workflow session | `story_id` |

---

## Overview

The Framework module implements the WYSIWID (What You See Is What It Does) concept-driven workflow system. It is the orchestration layer of Dragonfly: it defines what a "concept" is, how concepts are sequenced into workflows, and how the agent navigates from one concept to the next.

The module is grounded in Daniel Jackson's formal concept theory. Each concept (story, architecture, implementation, quality, version, security, documentation, verification, code-analysis, context, retrospective) is a self-contained unit of functionality with explicit state, declared preconditions, and defined outputs. The workflow is a sequence of concept invocations connected by synchronization rules — the WYSIWID property holds when the workflow sequence is fully readable without inspecting implementation code.

### Architecture

```
DRAGONFLY_FRAMEWORK_CONTENT_ROOT/
├── concepts/                  # Concept definitions (YAML/MD)
│   ├── story.md
│   ├── architecture.md
│   └── ...
├── workflows/                 # Workflow configurations (YAML)
│   └── default.yaml
└── skills/                    # Skill templates (MD)
    ├── pipeline-planning.md
    └── ...

Framework module
├── Concept loader — reads + caches concept definitions
├── Workflow engine — evaluates sync rules, resolves next concept
├── Agent enricher — injects pipeline context into system prompts
└── State tracker — reads/writes workflow sessions in stateDbPath
```

Concept definitions are plain files read at runtime — they are not compiled into the plugin. This means workflow behavior can be updated by editing markdown files without redeploying the plugin, preserving the WYSIWID legibility property: the behavior is visible in the content files.

---

## Tools

### `dragonfly_get_concept`

Retrieve the definition and metadata for a named concept. Concept definitions describe the role, responsibilities, and system prompt of an agent executing that concept.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | Yes | — | Concept name: `story`, `spec`, `architecture`, `implementation`, `quality`, `version`, `security`, `documentation`, `verification`, `code-analysis`, `context`, `retrospective`, `repair` |

**Returns:**

```json
{
  "name": "architecture",
  "role": "System architect",
  "description": "Design the technical architecture for the feature before implementation begins.",
  "system_prompt": "You are a senior software architect...",
  "default_model": "opus",
  "preconditions": ["story.status == ready"],
  "outputs": ["architecture.md"]
}
```

---

### `dragonfly_get_workflow`

Retrieve the active workflow configuration, including the concept sequence, synchronization rules, and default execution settings.

**Parameters:** None required.

**Returns:**

```json
{
  "name": "default",
  "steps": ["story", "architecture", "implementation", "quality", "version"],
  "sync_rules": [
    { "trigger": "story.approved", "activates": "architecture" },
    { "trigger": "architecture.completed", "activates": "implementation" }
  ],
  "allow_parallel": ["architecture", "security"],
  "default_model": "sonnet"
}
```

---

### `dragonfly_get_agent_prompt`

Get the full, unprocessed system prompt text for a concept's agent. This is the prompt that would be injected when Claude executes that concept's role. Useful for reviewing, debugging, or building on top of existing concept definitions.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `concept` | string | Yes | — | Concept name |

**Returns:** Full system prompt text as a string. The prompt includes the agent role, responsibilities, expected outputs, constraints, and interaction patterns for that concept.

---

### `dragonfly_get_skills`

List available skill templates. Skills are reusable behavioral instructions that can be applied to concept agents. They encode recurring patterns extracted from workflow history or authored manually.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `concept` | string | No | all | Filter skills that apply to a specific concept |

**Returns:**

```json
[
  {
    "name": "pipeline-planning",
    "description": "Use pipeline planning for multi-step development tasks",
    "trigger_keywords": ["implement", "feature", "build", "refactor"],
    "applies_to": ["*"],
    "priority": "high"
  }
]
```

---

### `dragonfly_plan_workflow`

Analyze current state and recommend the next workflow steps. Takes into account the story's status, prior concept history, and task type to recommend the appropriate pipeline DSL and concept sequence.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `story_id` | string | No | none | Story context for state-aware planning |
| `concept` | string | No | none | Override: force recommendation to start from a specific concept |

**Returns:**

```json
{
  "recommended_concept": "architecture",
  "pipeline_dsl": "architecture:opus | implementation | quality | version",
  "reasoning": "Story is approved. Architecture has not been completed. Security review recommended given API surface area.",
  "prerequisites_met": true,
  "prerequisites": ["story.status == ready"],
  "estimated_cost_usd": 0.043
}
```

---

### `dragonfly_start_workflow`

Initialize a new workflow session for a story. Selects the appropriate starting concept, enriches the concept's agent prompt with pipeline context, and creates a tracked workflow session in `stateDbPath`.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `story_id` | string | Yes | — | Story ID to begin executing |

**Returns:**

```json
{
  "session_id": "sess_9f3a12",
  "story_id": "story_7b2c",
  "first_concept": "story",
  "agent_prompt": "You are a product analyst capturing requirements...",
  "pipeline_dsl": "story | architecture:opus | implementation | quality | version",
  "estimated_cost_usd": 0.048,
  "created_at": "2026-03-09T11:00:00Z",
  "memory_context": {
    "found": 3,
    "hint": "3 similar workflow(s) found in memory. Review for relevant patterns before proceeding.",
    "recent": [
      { "task": "Add rate limiting to API", "flow_id": "flow_abc", "score": 0.91 }
    ]
  }
}
```

`memory_context` is only present when `recallSimilarWorkflows` finds matching past tasks. It surfaces similar historical workflows at session start so the first concept agent can reuse proven patterns.

---

### `dragonfly_advance_workflow`

Advance the workflow to the next concept after the current step completes. Evaluates synchronization rules against the completed concept's status, updates the session state, and returns the next concept's enriched agent prompt.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `story_id` | string | Yes | — | Active workflow's story ID |
| `completed_concept` | string | Yes | — | The concept that just finished |
| `status` | string | Yes | — | Outcome: `approved`, `rejected`, or `skipped` |

**Returns:**

```json
{
  "next_concept": "implementation",
  "agent_prompt": "You are an implementation agent...",
  "step_number": 3,
  "total_steps": 5,
  "session_updated": true
}
```

When activating the `quality` concept, the response includes an additional `testing_guidance` field with `run_tests` and `run_tests_with_repair` invocation hints derived from the project's test command.

When a concept fails, the response includes:
```json
{
  "repair_guidance": "Concept 'implementation' failed. Suggested: use run_with_verification or self_debug to diagnose the error, then re-attempt the concept."
}
```

When the workflow completes (all concepts done), the response includes:
```json
{
  "analytics_summary": {
    "total_actions": 47,
    "total_workflows": 12,
    "total_cost_usd": 0.082,
    "quality_approval_rate": 0.91,
    "failure_rate": 0.04
  },
  "bridge_export": {
    "exported": 8,
    "project": "my-api",
    "categories": ["architecture", "decisions"]
  }
}
```

`analytics_summary` comes from `computeBenchmarks` on the current project's event history. `bridge_export` confirms that local memories were automatically pushed to the global store on workflow completion.

If `status: "rejected"`, the workflow may return to a prior concept (e.g., rejected architecture returns to story for requirements refinement). If `status: "skipped"`, the workflow advances past the concept without marking it complete.

---

### `dragonfly_get_workflow_state`

Retrieve the current execution state of a workflow session, including which concept is active, the execution history, and overall completion status.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `story_id` | string | Yes | — | Story ID of the workflow to inspect |

**Returns:**

```json
{
  "session_id": "sess_9f3a12",
  "story_id": "story_7b2c",
  "current_concept": "implementation",
  "step_number": 3,
  "total_steps": 5,
  "status": "in_progress",
  "history": [
    { "concept": "story", "status": "approved", "completed_at": "2026-03-09T11:05:00Z" },
    { "concept": "architecture", "status": "approved", "completed_at": "2026-03-09T11:22:00Z" }
  ],
  "pipeline_dsl": "story | architecture:opus | implementation | quality | version"
}
```

---

## Academic Foundation

### WYSIWID — Concept-Driven Design

Meng, E. & Jackson, D. (2025). *What You See Is What It Does: A structural pattern for legible software.* Proceedings of the ACM SIGPLAN International Symposium on New Ideas, New Paradigms, and Reflections on Programming and Software (Onward! '25), Singapore, pp. 178–193. DOI: [10.1145/3759429.3762628](https://doi.org/10.1145/3759429.3762628). arXiv:2508.14511.

The WYSIWID principle — that the behavior of a system should be legible from reading its structural declarations, not from tracing its implementation — is the central organizing principle of the Framework module. Meng and Jackson propose that software systems should be decomposed into **concepts** (independent, state-bearing units) and **synchronizations** (declarative rules coordinating them). Applied to LLM workflows: each concept is an agent mode with well-defined inputs and outputs; the workflow is a synchronization specification; and the WYSIWID property holds when reading the pipeline DSL tells you exactly what will happen without reading any implementation code. The Framework module is a direct implementation of Meng and Jackson's architecture.

### The Essence of Software — Formal Concept Theory

Jackson, D. (2021). *The Essence of Software: Why Programs Disagree and How to Make Them Agree.* Princeton University Press. ISBN: 978-0691225388.

Jackson's book formalizes concept theory as a foundation for software design. A concept has a name, a purpose, a state machine, and a set of operations with preconditions and postconditions. Concepts are independent — one concept never directly invokes another. Their interactions are expressed through synchronization rules in a separate synchronization layer. This architectural separation is why the Framework module's concept definitions are plain files that never import from each other, and why the workflow sequencing logic lives in `sync_rules` rather than inside individual concept implementations.

### Design by Contract — Preconditions and Postconditions

Meyer, B. (1992). *Applying Design by Contract.* IEEE Computer, 25(10), 40–51. DOI: [10.1109/2.161279](https://doi.org/10.1109/2.161279)

Meyer's Design by Contract formalizes the relationship between a software component's preconditions (what must be true before the component executes) and postconditions (what is guaranteed to be true after). The Framework module enforces this contract at the workflow level: `dragonfly_start_workflow` checks that story prerequisites are met before starting; `dragonfly_advance_workflow` checks that the current concept's postconditions are satisfied before activating the next. The preconditions in `dragonfly_get_concept` and the prerequisites in `dragonfly_plan_workflow` are direct implementations of Meyer's contract pattern.

### Skill-Based Workflow Decomposition

Anderson, J. R. (1982). *Acquisition of cognitive skill.* Psychological Review, 89(4), 369–406. DOI: 10.1037/0033-295X.89.4.369

Anderson's ACT* theory (later ACT-R) proposes that expertise consists of compiled procedural knowledge: repeated problem-solving experience eventually becomes a fast, automatic "production rule" that fires without deliberate reasoning. The skills system in the Framework module implements this: `dragonfly_get_skills` retrieves compiled procedural knowledge that can be injected into agent prompts, short-circuiting the need for the agent to reason from first principles about common patterns. High-confidence skills are the compiled procedures; raw concept definitions are the declarative knowledge from which they were derived.

### Workflow Patterns

van der Aalst, W. M. P., ter Hofstede, A. H. M., Kiepuszewski, B., & Barros, A. P. (2003). *Workflow patterns.* Distributed and Parallel Databases, 14(1), 5–51. DOI: 10.1023/A:1022883727209

Van der Aalst et al. catalogued 20 fundamental workflow routing patterns — sequence, parallel split, synchronization, exclusive choice, simple merge, and others. The Framework module's synchronization rules implement these patterns: sequential concept execution is the sequence pattern; parallel concept groups (architecture + security) are the parallel split + synchronization pattern; `rejected` outcomes triggering concept re-execution are the loop-back pattern. The formal workflow patterns taxonomy ensures the Framework's routing logic is complete and correct.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DRAGONFLY_FRAMEWORK_CONTENT_ROOT` | `~/.dragonfly/content` | Path to the `concepts/`, `workflows/`, and `skills/` content directories |

---

## Integration with Other Modules

**Pipeline module:** The Framework module's `dragonfly_plan_workflow` and `dragonfly_start_workflow` are the integration point for Pipeline DSL generation and execution planning. The Pipeline module provides `parsePipeline`, `validatePipeline`, and `generatePlan`; the Framework module invokes them during workflow initialization and exposes the DSL in workflow state. See `docs/pipeline.md` for the current integration status and planned improvements.

**State module:** Workflow sessions created by `dragonfly_start_workflow` are stored in `stateDbPath` and managed by the State module. `dragonfly_advance_workflow` writes session history as provenance events that the Analytics module reads for timeline visualization.

**Memory module:** `dragonfly_start_workflow` calls `recallSimilarWorkflows` to surface relevant past workflows and includes results in the `memory_context` response field. `dragonfly_plan_workflow` also calls `memory_recall` internally for state-aware planning recommendations.

**Repair module:** When a concept fails, `dragonfly_advance_workflow` includes `repair_guidance` in its response, pointing to the appropriate Repair module tools (`self_debug`, `run_with_verification`). When the `quality` concept is activated, the response includes testing guidance with `run_tests_with_repair` suggestions.

**Analytics module:** `dragonfly_advance_workflow` writes provenance events to `stateDbPath` and, on workflow completion, calls `computeBenchmarks` to include an `analytics_summary` in the response. The Analytics module's `dragonfly_timeline_view` reads these events to visualize workflow execution history.

**Bridge module:** On workflow completion, `dragonfly_advance_workflow` automatically calls `BridgeStore.exportMemories()` and includes a `bridge_export` summary. No explicit `dragonfly_bridge_export` call is required for standard workflows.

**Evolve module:** Skills generated by `evolve_best` (with `save_as_skill: true`) are written to the skills directory read by `dragonfly_get_skills`. The `workflow-planner.ts` includes a `repair` concept in the DSL catalogue, and `spec` is included in medium/large feature workflow DSL templates (`story | spec | architecture | implementation | quality | version`).

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/framework/concepts.ts` | Concept definition loader and cache |
| `src/tools/framework/workflow-engine.ts` | Sync rule evaluation and concept sequencing |
| `src/tools/framework/workflow-planner.ts` | Task classification and DSL recommendation |
| `src/tools/framework/agent-enricher.ts` | Pipeline context injection into agent prompts |
| `src/tools/framework/index.ts` | MCP tool registration |
| `src/tools/framework/types.ts` | WorkflowPlan, WorkflowStep, ConceptDefinition types |
