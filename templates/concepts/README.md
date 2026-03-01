# Zen Concepts

Concepts are independent, stateful services that perform specific actions. They are the building blocks of the Zen WYSIWID architecture.

## Core Principle: Concepts Never Call Concepts

This is the foundational rule of Zen:

❌ **Wrong**: Architecture concept calls Implementation concept
✅ **Right**: Architecture completes → Synchronization triggers Implementation

This enforces true modularity and makes system behavior predictable from reading synchronization rules.

## The 10 Concepts

### 1. Story (Sonnet) - Requirements Capture
- **File**: `story.md`
- **Model**: Sonnet
- **Purpose**: Capture and validate user requirements
- **Actions**: create, validate, query
- **State**: `koan/stories/`
- **Never knows**: How to implement, architect, or test

**When to use**: User requests a new feature or bug fix

### 2. Architecture (Opus) - System Design
- **File**: `architecture.md`
- **Model**: Opus ⭐
- **Purpose**: Design technical solutions and make architectural decisions
- **Actions**: design, evaluate, revise, clarify
- **State**: `koan/architecture/`
- **Never knows**: How to write code or run tests

**When to use**: Story is validated and ready for design

**Why Opus?**: Requires deep reasoning, trade-off analysis, pattern synthesis

### 3. Implementation (Sonnet) - Code Generation
- **File**: `implementation.md`
- **Model**: Sonnet
- **Purpose**: Generate code from technical specifications
- **Actions**: generate, refactor, document
- **State**: `koan/implementations/`
- **Never knows**: Architectural decisions (follows specs exactly)

**When to use**: Architecture is complete and risk is acceptable

**Why Sonnet?**: Clear specs make implementation straightforward

### 4. Quality (Sonnet) - Review & Testing
- **File**: `quality.md`
- **Model**: Sonnet
- **Purpose**: Review code, run tests, validate acceptance criteria
- **Actions**: review, test, validate
- **State**: `koan/reviews/`
- **Never knows**: How to fix issues (reports them for Implementation)

**When to use**: Implementation is complete

**Why Sonnet?**: Pattern matching and rule-based validation

### 5. Version (Sonnet) - Git Operations
- **File**: `version.md`
- **Model**: Sonnet
- **Purpose**: Manage version control, commits, branches
- **Actions**: branch, commit, push, tag
- **State**: `koan/versions/`
- **Never knows**: Code quality (commits only after Quality approves)

**When to use**: Quality review passes

**Why Sonnet?**: Straightforward git commands

### 6. Context (Sonnet) - Context Window Management
- **File**: `context.md`
- **Model**: Sonnet
- **Purpose**: Manage Claude Code context window
- **Actions**: snapshot, estimate, compress, preserve
- **State**: `koan/session-state/`
- **Never knows**: Feature logic (focuses on context health)

**When to use**: Workflow boundaries, context warnings

**Why Sonnet?**: Token counting and compression

### 7. Code-Analysis (Sonnet) - Codebase Context
- **File**: `code-analysis.md`
- **Model**: Sonnet
- **Purpose**: Gather codebase context via MCP tools
- **Actions**: context
- **State**: `koan/code-analysis/`
- **Never knows**: How to design or implement (gathers context only)

**When to use**: Before architecture, to understand existing patterns

**Why Sonnet?**: MCP tool orchestration is straightforward

### 8. Verification (Sonnet) - Multi-Pass Review
- **File**: `verification.md`
- **Model**: Sonnet
- **Purpose**: Independent multi-pass verification for accuracy
- **Actions**: verify_architecture, verify_implementation
- **State**: `koan/verification/`
- **Never knows**: How to fix issues (reports findings only)

**When to use**: High-risk architectures, complex implementations

**Why Sonnet?**: Pattern matching and independent review

### 9. Security (Sonnet) - Security Assurance
- **File**: `security.md`
- **Model**: Sonnet
- **Purpose**: Threat modeling, vulnerability scanning, commit gates
- **Actions**: threat_model, validate_architecture, scan_implementation, verify_commit
- **State**: `koan/security/`
- **Never knows**: How to fix vulnerabilities (blocks until fixed)

**When to use**: All features (parallel with story), before commits

**Why Sonnet?**: Security pattern detection and OWASP validation

### 10. Documentation (Sonnet) - Comprehensive Docs
- **File**: `documentation.md`
- **Model**: Sonnet
- **Purpose**: Generate documentation at every workflow phase
- **Actions**: generate, update_index
- **State**: `koan/documentation/`
- **Never knows**: Implementation details (documents from specs)

**When to use**: After each major workflow phase

**Why Sonnet?**: Technical writing from specifications

## Concept Anatomy

Each concept has:

1. **Frontmatter**: Metadata (name, model, state location, cost tier)
2. **Purpose**: Why this concept exists
3. **Actions**: What operations it can perform
4. **Model Rationale**: Why this model was chosen
5. **Integration Points**: How it fits in workflows
6. **Anti-Patterns**: Common mistakes to avoid
7. **Provenance**: How actions are tracked
8. **Examples**: Usage demonstrations

## Model Assignment Strategy

### Sonnet (9/10 concepts) - Balanced Execution
- Story capture (template filling)
- Code analysis (MCP-based codebase exploration)
- Verification (multi-pass review)
- Code generation from specs (pattern following)
- Quality checks (pattern matching)
- Security scanning (vulnerability detection)
- Git operations (command execution)
- Context management (token counting)
- Documentation generation (comprehensive docs)

**Rationale**: These tasks benefit from balanced performance and capability

### Opus (1/10 concepts) - Deep Reasoning
- Architecture design (multi-step reasoning)
- Trade-off evaluation (complex analysis)
- Novel problem solving (synthesis)

**Rationale**: Investment in deep reasoning prevents costly mistakes downstream

## Cost Breakdown per Feature

```
Story (Sonnet):           $0.003  (5%)
Code-Analysis (Sonnet):   $0.003  (5%)
Architecture (Opus):      $0.015  (25%) ⭐
Verification (Sonnet):    $0.003  (5%)
Implementation (Sonnet):  $0.003  (5%)
Quality x2 (Sonnet):      $0.006  (10%)
Security (Sonnet):        $0.003  (5%)
Version (Sonnet):         $0.003  (5%)
Context (Sonnet):         $0.003  (5%)
Documentation (Sonnet):   $0.003  (5%)
────────────────────────────────────────
Total:                   ~$0.045
```

**Key Insight**: Architecture is the largest investment but prevents rework that would be far more expensive.

## Invocation

Concepts are invoked via Claude Code's Task tool:

```markdown
I'll use the story concept to capture this requirement.
[Invokes Task tool with:
  - subagent_type: "story-concept"
  - model: "sonnet"
  - prompt: {inputs}
]
```

## State Files

Each concept stores state in `koan/`:

```yaml
# koan/stories/story-001.yaml
story_id: "story-001"
created_at: "2025-11-09T20:00:00Z"
title: "Add dark mode support"
description: "..."
acceptance_criteria: [...]
status: "ready"
```

**Benefits:**
- Human-readable
- Git-trackable
- LLM-friendly
- Easy debugging

## Provenance

Every concept action creates provenance:

```yaml
# koan/provenance/actions/act-001.yaml
action_id: "act-001"
concept: "story"
model: "sonnet"
action: "create"
triggered_by: null  # User-initiated
```

## Anti-Patterns

### ❌ Concept Calling Concept
```python
# DON'T DO THIS
class ArchitectureConcept:
    def design(self, story):
        # ...
        impl = ImplementationConcept()
        impl.generate(self)  # ❌ Direct call
```

✅ **Do this instead:**
```yaml
# synchronizations/feature-development.yaml
- when: {concept: architecture, status: completed}
  then: {concept: implementation, action: generate}
```

### ❌ Concept with Knowledge of Others
```markdown
# implementation.md
After generating code, I'll call the quality concept to review it.
```

✅ **Do this instead:**
```markdown
# implementation.md
After generating code, I'll set status="completed".
(Quality will be triggered by impl-to-quality synchronization)
```

### ❌ Wrong Model Assignment
```yaml
# Using Opus for routine tasks
implementation:
  model: "opus"  # ❌ Overkill for clear specs
```

✅ **Do this instead:**
```yaml
# Use Sonnet for routine tasks
implementation:
  model: "sonnet"  # ✅ Clear specs → straightforward code
```

## Customization

You can customize concepts for your project:

1. **Add actions**: Add new actions to existing concepts
2. **Adjust state format**: Change YAML structure for your needs
3. **Change model**: Override model for specific concepts (with justification)
4. **Add validations**: Enhance quality checks for your domain

**But never:**
- Remove the "never calls concepts" principle
- Skip provenance tracking
- Hide behavior in imperative code

## Validation

Zen enforces concept discipline:

```bash
# Check for concept-to-concept calls (should find none)
grep -r "concept.*\..*(" .claude/concepts/

# Verify provenance completeness
ls koan/provenance/actions/ | wc -l  # Should match action count

# Validate model assignments
grep "model:" .claude/config.yaml
```

## Learning Path

1. **Start with Story**: Create a feature with `/feature`
2. **Observe Architecture**: See how Opus designs the solution
3. **Watch Implementation**: See how Sonnet generates code from specs
4. **Review Quality**: See pattern-based validation
5. **Track Provenance**: Use `/trace` to see the complete chain

## Questions?

- **"When should I add a new concept?"** - When you have a truly independent concern that doesn't belong in existing concepts
- **"Can concepts share code?"** - No. Duplicate code is better than hidden coupling
- **"Why can't concepts call each other?"** - Because it makes behavior unpredictable and breaks legibility
- **"Is Sonnet really sufficient?"** - For routine tasks with clear specs, absolutely. Try it!

## Next Steps

- Read individual concept files for detailed documentation
- Review `.claude/synchronizations/feature-development.yaml` to see how concepts are orchestrated
- Try `/feature "Your idea"` and watch the workflow
- Use `/trace` to see the complete provenance chain
