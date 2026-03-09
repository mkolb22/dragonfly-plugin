/**
 * Workflow Planner
 * Task classification, complexity estimation, and workflow step recommendations.
 *
 * Uses the Pipeline module (WYSIWID — Meng & Jackson, MIT CSAIL, ACM Onward! '25)
 * to compose, validate, and plan workflows from DSL strings. The switch-statement
 * per task type is replaced by a declarative DSL lookup table — the DSL is the
 * single source of truth for what each workflow does.
 */

import type { WorkflowPlan, WorkflowStep } from "./types.js";
import { getContentLoader } from "./content-loader.js";
import { config } from "../../core/config.js";
import { recallSimilarWorkflows } from "./workflow-intelligence.js";
import { parsePipeline, validatePipeline } from "../pipeline/composer.js";
import { generatePlan } from "../pipeline/planner.js";

/**
 * Task types with classification keywords
 */
type TaskType = "bugfix" | "feature" | "refactor" | "docs";

const TASK_KEYWORDS: Record<TaskType, string[]> = {
  bugfix: ["fix", "bug", "broken", "error", "crash", "issue", "wrong", "fail", "not working"],
  docs: ["document", "docs", "readme", "documentation", "jsdoc", "comments", "describe"],
  refactor: ["refactor", "clean up", "restructure", "reorganize", "simplify", "extract", "rename"],
  feature: [], // default fallback
};

/**
 * Complexity indicators
 */
const LARGE_INDICATORS = [
  "system",
  "architecture",
  "redesign",
  "migration",
  "overhaul",
  "framework",
  "infrastructure",
  "multi-service",
  "cross-cutting",
];

const SMALL_INDICATORS = [
  "typo",
  "rename",
  "simple",
  "small",
  "quick",
  "minor",
  "single",
  "one",
  "just",
];

/**
 * Concept pipeline definitions
 * Maps concept name to agent, model, and base cost
 */
interface ConceptDef {
  agent: string;
  model: string;
  baseCost: number;
}

const CONCEPTS: Record<string, ConceptDef> = {
  story: { agent: "story-concept", model: "sonnet", baseCost: 0.003 },
  architecture: { agent: "architecture-concept", model: "opus", baseCost: 0.015 },
  implementation: { agent: "implementation-concept", model: "sonnet", baseCost: 0.008 },
  quality: { agent: "quality-concept", model: "sonnet", baseCost: 0.005 },
  documentation: { agent: "documentation-concept", model: "sonnet", baseCost: 0.003 },
  version: { agent: "version-concept", model: "sonnet", baseCost: 0.002 },
  security: { agent: "security-concept", model: "sonnet", baseCost: 0.004 },
  spec: { agent: "spec-concept", model: "sonnet", baseCost: 0.005 },
};

/**
 * Pipeline DSL templates — the declarative source of truth for each workflow shape.
 * These strings are parsed by the Pipeline module (parsePipeline → validatePipeline
 * → generatePlan), which produces execution-ready step sequences with duration and
 * cost estimates. Edit here to change what any workflow does — no switch statements.
 *
 * DSL syntax: concept | concept | parallel(a, b) @slo:profile @errors:policy
 */
const DSL_TEMPLATES: Record<TaskType, Record<"small" | "medium" | "large", string>> = {
  bugfix: {
    small: "implementation | quality @slo:fast @errors:graceful",
    medium: "implementation | quality | version @slo:standard",
    large: "story | parallel(architecture, code-analysis) | implementation | quality | version @slo:standard",
  },
  docs: {
    small: "documentation @slo:fast",
    medium: "documentation @slo:standard",
    large: "documentation @slo:standard",
  },
  refactor: {
    small: "implementation | quality | version @slo:fast",
    medium: "architecture | implementation | quality | version @slo:standard",
    large: "story | architecture | implementation | quality | version @slo:thorough",
  },
  feature: {
    small: "story | implementation | quality | version @slo:standard",
    medium: "story | architecture | implementation | quality | version @slo:standard",
    large: "story | parallel(architecture, security) | implementation | quality | version @slo:thorough",
  },
};

/**
 * Human-readable reasons for each step by task type.
 * Used in WorkflowStep.reason for LLM-facing context.
 */
const STEP_REASONS: Record<TaskType, Partial<Record<string, string>>> = {
  bugfix: {
    story: "Capture bug report details and reproduction steps",
    architecture: "Analyze root cause in system context",
    "code-analysis": "Gather codebase context for root cause analysis",
    implementation: "Implement the fix",
    quality: "Verify fix with tests and review",
    version: "Commit and tag the fix",
  },
  docs: {
    documentation: "Generate or update documentation",
  },
  refactor: {
    story: "Capture refactoring goals and constraints",
    architecture: "Design target structure",
    "code-analysis": "Analyze current code structure",
    implementation: "Execute refactoring",
    quality: "Verify behavior preserved",
    version: "Commit refactored code",
  },
  feature: {
    story: "Capture requirements and acceptance criteria",
    architecture: "Design technical approach",
    security: "Security review for large feature",
    implementation: "Build the feature",
    quality: "Review and test",
    version: "Commit and version",
  },
};

const DEFAULT_STEP_REASONS: Record<string, string> = {
  story: "Capture requirements",
  architecture: "Design technical approach",
  implementation: "Build the solution",
  quality: "Review and test",
  version: "Commit and version",
  security: "Security review",
  "code-analysis": "Gather codebase context",
  documentation: "Generate documentation",
  context: "Manage context window",
  verification: "Independent verification pass",
  retrospective: "Analyze workflow",
};

function getStepReason(concept: string, taskType: TaskType): string {
  return STEP_REASONS[taskType][concept] || DEFAULT_STEP_REASONS[concept] || `Execute ${concept}`;
}

function getSkipReason(concept: string, taskType: TaskType): string {
  if (taskType === "docs") return `Documentation task — ${concept} not required`;
  if (taskType === "bugfix" && concept === "story") return "Simple bugfix — requirements are clear";
  if (taskType === "bugfix" && concept === "architecture") return "No architectural changes needed for bugfix";
  if (taskType === "bugfix" && concept === "security") return "Standard bugfix — no security review needed";
  if (taskType === "refactor" && concept === "story") return "Refactoring scope is clear";
  if (taskType === "refactor" && concept === "security") return "Refactor — no new security surface";
  return `Skipped for ${taskType} workflow efficiency`;
}

/**
 * Classify a task description into a task type
 */
function classifyTask(task: string): TaskType {
  const lower = task.toLowerCase();
  for (const [type, keywords] of Object.entries(TASK_KEYWORDS) as Array<[TaskType, string[]]>) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return type;
    }
  }
  return "feature";
}

/**
 * Estimate task complexity from description and optional context
 */
function estimateComplexity(task: string, context?: string): "small" | "medium" | "large" {
  const text = `${task} ${context || ""}`.toLowerCase();

  if (LARGE_INDICATORS.some((ind) => text.includes(ind))) return "large";
  if (SMALL_INDICATORS.some((ind) => text.includes(ind))) return "small";

  // Heuristic: longer descriptions suggest more complexity
  const wordCount = task.split(/\s+/).length;
  if (wordCount > 30) return "large";
  if (wordCount < 8) return "small";

  return "medium";
}

/**
 * Build a workflow step from a concept definition
 */
function buildStep(order: number, conceptName: string, reason: string): WorkflowStep {
  const def = CONCEPTS[conceptName];
  if (!def) {
    return {
      order,
      concept: conceptName,
      agent: `${conceptName}-concept`,
      model: "sonnet",
      skills: [],
      estimatedCost: 0.005,
      reason,
    };
  }

  // Look up skills from content loader
  const loader = getContentLoader();
  const agentSkills = loader.getSkillsForAgent(def.agent);

  return {
    order,
    concept: conceptName,
    agent: def.agent,
    model: def.model,
    skills: agentSkills.map((s) => s.name),
    estimatedCost: def.baseCost,
    reason,
  };
}

/**
 * Plan a workflow for a given task.
 *
 * Classifies the task, selects a Pipeline DSL string, then routes through
 * parsePipeline → validatePipeline → generatePlan (Pipeline module) to produce
 * a structured, validated execution sequence. The DSL is surfaced in the result
 * as `pipelineDsl` — readable intent, no hidden switch statements.
 */
export async function planWorkflow(task: string, context?: string): Promise<WorkflowPlan> {
  const taskType = classifyTask(task);
  let complexity = estimateComplexity(task, context);

  // Consult memory for similar past workflows
  let memoryReasoning = "";
  const cfg = config();
  if (cfg.memoryEnabled) {
    try {
      const insight = await recallSimilarWorkflows(task);
      if (insight.suggestedComplexity && insight.similarTasks.length >= 2) {
        complexity = insight.suggestedComplexity;
        memoryReasoning = ` Memory: ${insight.reasoning}`;
      }
    } catch { /* graceful degradation */ }
  }

  // Resolve Pipeline DSL for this task type + complexity
  const dsl = DSL_TEMPLATES[taskType][complexity];

  // Parse, validate, and plan through the Pipeline module
  const pipeline = parsePipeline(dsl);
  const validation = validatePipeline(pipeline);
  const executionPlan = generatePlan(pipeline, validation);

  // Map Pipeline execution steps to WorkflowSteps
  const steps: WorkflowStep[] = [];
  const includedConcepts = new Set<string>();
  let stepOrder = 1;

  for (const pipelineStep of pipeline.steps) {
    for (const ref of pipelineStep.conceptRefs) {
      const reason = pipelineStep.type === "parallel"
        ? `Parallel with ${pipelineStep.conceptRefs.filter(r => r.concept !== ref.concept).map(r => r.concept).join(", ")} — ${getStepReason(ref.concept, taskType)}`
        : getStepReason(ref.concept, taskType);
      steps.push(buildStep(stepOrder++, ref.concept, reason));
      includedConcepts.add(ref.concept);
    }
  }

  // Compute skipped steps = concepts not in this pipeline
  const skippedSteps = Object.keys(CONCEPTS)
    .filter((c) => !includedConcepts.has(c))
    .map((c) => ({ concept: c, reason: getSkipReason(c, taskType) }));

  const totalEstimatedCost = steps.reduce((sum, s) => sum + s.estimatedCost, 0);

  const validationNote = validation.warnings.length > 0
    ? ` Warnings: ${validation.warnings.join("; ")}.`
    : "";

  const reasoning = [
    `Classified as "${taskType}" task with ${complexity} complexity.`,
    `Pipeline: ${dsl}.`,
    validationNote,
    steps.length > 0
      ? `Recommending ${steps.length}-step workflow.`
      : "No steps recommended.",
    skippedSteps.length > 0
      ? `Skipping ${skippedSteps.length} step(s) for efficiency.`
      : "",
    memoryReasoning,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    task,
    taskType,
    complexity,
    steps,
    skippedSteps,
    totalEstimatedCost: Math.round(totalEstimatedCost * 1000) / 1000,
    reasoning,
    pipelineDsl: dsl,
    estimatedDurationMs: executionPlan.estimated_duration_ms,
  };
}
