# Koan - State Storage

This directory contains all state for your Zen WYSIWID architecture.

## Structure

- `stories/` - Story concept state (requirements, acceptance criteria)
- `architecture/` - Architecture decisions and technical designs
- `implementations/` - Code artifacts and implementation records
- `reviews/` - Quality reviews and test results
- `provenance/` - Action tracking and flow analysis
  - `flows/` - Complete workflow traces
  - `actions/` - Individual action logs
- `session-state/` - Current session context snapshots and checkpoints
- `anchors/` - Immutable context that survives compression
- `health/` - Context health monitoring and grounding logs
- `memory/` - Semantic memory storage
  - `semantic/` - Long-term facts and knowledge
  - `procedural/` - How-to knowledge and workflows
  - `episodes/` - Session summaries

## File-Based State

All state is stored as YAML or Markdown files for:
- Easy inspection and debugging
- Git-trackable history
- Human-readable format
- LLM-friendly structure

## Provenance Tracking

Every action creates a provenance entry with:
- `action_id` - Unique identifier
- `concept` - Which concept performed the action
- `model` - Which AI model was used (haiku/sonnet)
- `triggered_by` - Parent action (or null if user-initiated)
- `cost` - Token usage and cost in USD
- `flow_id` - Workflow identifier linking related actions

Use the `/trace <action_id>` command to explore provenance chains.

## Safety Features

- `anchors/rules.anchor.yaml` - Immutable rules that survive compression
- `anchors/safety.anchor.yaml` - Safety constraints and blocked patterns
- `health/status.yaml` - Context health monitoring
- `health/grounding.log` - Log of dangerous command interceptions

## Semantic Memory

Store and retrieve persistent knowledge:
- `/remember "fact"` - Store a memory
- `/recall query` - Retrieve memories
- `/checkpoint` - Save session state
- `/restore` - Restore from checkpoint

Memory is organized by type (semantic, procedural) and category
(architecture, conventions, patterns, workflows, debugging).
