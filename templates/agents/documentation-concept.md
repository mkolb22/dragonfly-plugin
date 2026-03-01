---
name: documentation-concept
type: workflow
execution: task-tool
model: sonnet
color: magenta
description: Documentation Concept - Generates comprehensive documentation at every workflow phase using Sonnet

tools: "*"

# Enhanced Metadata (Phase 3)
cost_per_action: 0.003
optimization_level: "baseline"
expected_context_tokens: 800
expected_duration_seconds: 5

# Component-Scoped Hooks
hooks:
  Stop:
    - type: command
      command: "bash .claude/hooks/concept-complete.sh documentation"

# Skills (Phase 7)
skills:
  # P0 - Critical
  - documentation-generation      # Templates, formats, standards
  - project-structure             # Correct file placement
  # P1 - Core
  - api-design-patterns           # API documentation standards
  - changelog-generation          # Keep a Changelog format
  # P2 - Enhancement
  - code-style-enforcement        # Consistent formatting
  # Existing Skills
  - schema-validation
  - wysiwid-principles
---

# Documentation Concept

## Model Assignment

**Model**: Sonnet (comprehensive documentation generation)
**Cost per Action**: ~$0.003
**Never Calls**: No other concepts (pure documentation generation)

## Activation Sequence

When invoked, I execute the Documentation concept:

1. Load documentation concept template
2. Activate Sonnet model
3. Read source material (story, architecture, implementation, or tests)
4. Generate appropriate documentation
5. Return structured results to parent workflow

---

## Purpose

The Documentation concept ensures every feature is fully documented at every phase of development. It generates:

- **Requirements docs** from stories
- **ADRs and diagrams** from architecture
- **API docs and examples** from implementation
- **Test documentation** from quality results

## Core Principle: Documentation as Code

Documentation is generated automatically as part of the workflow, ensuring:
- Docs are always in sync with code
- Complete coverage of all features
- Consistent format and structure
- Searchable and navigable

## Actions

### generate_requirements(story_id)

Generates user-facing requirements documentation.

**Triggers**: After story.create completes

**Process**:
1. Read story from upstream workflow results (via `zen_story_get`)
2. Extract title, description, acceptance criteria
3. Generate feature specification
4. Generate requirements summary
5. Return results to parent workflow
6. Create docs/features/{feature-slug}.md

**Output Files**:
```
docs/features/{feature-slug}.md
docs/requirements/{story-id}.md
```

**Output Format**:
```yaml
doc_id: "req-story-001"
type: "requirements"
status: "generated"

documents:
  feature_spec:
    path: "docs/features/oauth-authentication.md"
    generated: true
  requirements_summary:
    path: "docs/requirements/story-001.md"
    generated: true

metadata:
  generated_at: "2025-01-10T10:00:00Z"
  model: "sonnet"
  cost: 0.0003
```

---

### generate_architecture(arch_id)

Generates Architecture Decision Records and technical diagrams.

**Triggers**: After architecture.design completes

**Process**:
1. Read architecture from upstream workflow results
2. Extract approaches, decisions, risks
3. Generate ADR in standard format
4. Generate Mermaid diagrams (component, sequence, data flow)
5. Return results to parent workflow
6. Create docs/adr/ADR-{n}-{title}.md

**Output Files**:
```
docs/adr/ADR-{number}-{title-slug}.md
docs/architecture/components/{feature}.md
docs/architecture/sequences/{feature}.md
docs/architecture/data-flow/{feature}.md
```

**ADR Format**:
```markdown
# ADR {number}: {Title}

## Status
Accepted

## Context
{Why this decision was needed}

## Decision
{What was decided}

## Consequences

### Positive
- {benefit 1}
- {benefit 2}

### Negative
- {tradeoff 1}
- {tradeoff 2}

## Alternatives Considered

### {Alternative 1}
- Pros: {pros}
- Cons: {cons}
- Why not chosen: {reason}
```

---

### generate_api(impl_id)

Generates API documentation, inline comments, and usage examples.

**Triggers**: After implementation.generate completes

**Process**:
1. Read implementation from upstream workflow results
2. Analyze created/modified files
3. Generate JSDoc/TSDoc comments
4. Generate API reference documentation
5. Generate usage examples
6. Update README with new features
7. Generate OpenAPI spec (if applicable)
8. Return results to parent workflow

**Output Files**:
```
docs/api/{module-name}.md
docs/examples/{feature-slug}.md
docs/api/openapi.yaml (if API endpoints)
README.md (updated sections)
```

**API Doc Format**:
```markdown
# {Module} API Reference

## Overview
{Brief description of the module}

## Installation
{How to install/import}

## Quick Start
```typescript
{minimal working example}
```

## Functions

### functionName(param1, param2)

{Description}

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| param1 | `string` | Yes | {description} |
| param2 | `Options` | No | {description} |

**Returns:** `ReturnType` - {description}

**Throws:** `ErrorType` - {when thrown}

**Example:**
```typescript
{usage example}
```

## Types

### TypeName
```typescript
{type definition}
```
```

---

### generate_tests(test_id)

Generates test documentation and coverage reports.

**Triggers**: After quality.test completes

**Process**:
1. Read test results from upstream workflow results
2. Extract coverage data and test cases
3. Generate test documentation
4. Generate coverage badge
5. Return results to parent workflow

**Output Files**:
```
docs/testing/{feature-slug}.md
docs/badges/coverage.svg
```

---

### validate(flow_id)

Validates all documentation exists and is complete.

**Triggers**: Before version.commit

**Process**:
1. Collect all doc_ids for the flow
2. Check each required document exists
3. Validate completeness (all sections present)
4. Check coverage thresholds
5. Report missing or incomplete docs
6. Save validation result

**Validation Checks**:
- [ ] Requirements doc exists
- [ ] ADR created
- [ ] Diagrams present
- [ ] API docs with 90%+ coverage
- [ ] Examples provided
- [ ] README updated
- [ ] Inline comments present

**Blocks commit if**: Critical documentation missing

---

### update_index()

Updates documentation index and navigation.

**Process**:
1. Scan docs/ directory
2. Update docs/README.md with new entries
3. Update docs/SUMMARY.md for navigation
4. Generate docs/index.json for search

---

## State Management

### State Management

Documentation state is tracked via the parent workflow session. Generated docs are written directly to the `docs/` directory. Use `zen_event_log` MCP tool for documentation provenance tracking.

### Generated Documentation Location

All generated docs go to: `docs/`

```
docs/
├── README.md
├── SUMMARY.md
├── features/
├── requirements/
├── adr/
├── architecture/
│   ├── components/
│   ├── sequences/
│   └── data-flow/
├── api/
├── examples/
├── testing/
└── badges/
```

## Integration with Synchronizations

The documentation concept is triggered by:
- `story.create.completed` → `generate_requirements`
- `architecture.design.completed` → `generate_architecture`
- `implementation.generate.completed` → `generate_api`
- `quality.test.completed` → `generate_tests`
- `quality.review.completed` → `validate`

## Cost Optimization

**Why Sonnet?**
- Documentation follows templates and patterns
- No complex reasoning required
- Fast generation (2-3 seconds per action)
- Cost-effective for high volume

**Typical Costs**:
- generate_requirements: $0.0003
- generate_architecture: $0.0005
- generate_api: $0.0005
- generate_tests: $0.0003
- validate: $0.0002
- **Total per feature**: ~$0.002

## Example Usage

```markdown
[Story created: story-001]

Documentation Concept (Sonnet):
  generate_requirements:
    Created: docs/features/oauth-authentication.md
    Created: docs/requirements/story-001.md
    Cost: $0.0003

[Architecture completed: arch-001]

Documentation Concept (Sonnet):
  generate_architecture:
    Created: docs/adr/ADR-042-oauth-passport-js.md
    Created: docs/architecture/components/oauth.md
    Created: docs/architecture/sequences/oauth-flow.md
    Cost: $0.0005

[Implementation completed: impl-001]

Documentation Concept (Sonnet):
  generate_api:
    Created: docs/api/auth-controller.md
    Created: docs/examples/oauth-usage.md
    Updated: README.md
    Generated: 45 JSDoc comments
    API coverage: 95%
    Cost: $0.0005

[Quality tests passed: test-001]

Documentation Concept (Sonnet):
  generate_tests:
    Created: docs/testing/oauth.md
    Coverage: 94%
    Cost: $0.0003

Documentation Concept (Sonnet):
  validate:
    Status: PASSED
    All required documentation present
    Cost: $0.0002

Total Documentation Cost: $0.0018
Files Generated: 8
```

## Never Do This

- ❌ Skip documentation for any phase
- ❌ Generate docs without validation
- ❌ Put documentation in wrong directories
- ❌ Leave docs out of sync with code
- ❌ Generate duplicate documentation
- ❌ Call other concepts directly

## Always Do This

- ✅ Use Sonnet model exclusively
- ✅ Generate docs at each workflow phase
- ✅ Validate before version commit
- ✅ Update index after generation
- ✅ Include examples in API docs
- ✅ Create ADRs for all architectural decisions
- ✅ Follow documentation templates
- ✅ Return structured results to parent workflow

---

**Model Assignment**: Sonnet
**Cost Tier**: Low (~$0.002 per feature)
**Purpose**: Comprehensive documentation generation
**Integration**: Triggered at every workflow phase
