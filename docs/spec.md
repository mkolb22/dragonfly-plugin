# Spec Module

**Module:** `spec`
**Tools:** 6 (`dragonfly_spec_save`, `dragonfly_spec_get`, `dragonfly_spec_list`, `dragonfly_spec_generate`, `dragonfly_spec_export`, `dragonfly_spec_import`)
**Feature flag:** None
**Storage:** `stateDbPath` (spec records stored in state database)
**Always enabled:** Yes

---

## Quick Reference

| Tool | Description | Required Params |
|---|---|---|
| `dragonfly_spec_save` | Persist a formal specification with concepts, constraints, and relations | `name`, `description` |
| `dragonfly_spec_get` | Retrieve the latest version of a named specification | `name` |
| `dragonfly_spec_list` | List all stored specifications | None |
| `dragonfly_spec_generate` | Generate code from a specification | `spec_name`, `language` |
| `dragonfly_spec_export` | Export a specification to a JSON or YAML file | `spec_name` |
| `dragonfly_spec_import` | Import a specification from a JSON or YAML file | `file_path` |

---

## Overview

The Spec module manages formal specifications that serve as the contract between requirements and implementation. A specification is a structured definition of the concepts in a system, their properties, the operations they support, the invariants they must maintain, and the relationships between them.

The module is grounded in Daniel Jackson's concept theory and the Alloy formal specification language. Specifications are not documentation — they are machine-readable contracts that drive code generation and serve as the authoritative definition of what a system should do. `dragonfly_spec_generate` transforms a specification into executable code skeletons in any supported language, ensuring the implementation reflects the spec's contracts rather than an ad-hoc interpretation of natural language requirements.

### Architecture

```
dragonfly_spec_save
     │  concepts + constraints + relations
     ▼
stateDbPath (specs table, versioned)
     │
     ├─ dragonfly_spec_get     → retrieve by name (latest version)
     ├─ dragonfly_spec_list    → enumerate all specs
     ├─ dragonfly_spec_generate → spec → typed code skeleton
     ├─ dragonfly_spec_export  → spec → JSON/YAML file
     └─ dragonfly_spec_import  ← JSON/YAML file → spec record
```

Specs are versioned: each call to `dragonfly_spec_save` with an existing name creates a new version. `dragonfly_spec_get` returns the latest version by default.

---

## Tools

### `dragonfly_spec_save`

Save a formal specification. Specifications consist of concept definitions (named entities with properties and operations), system constraints (invariants that must hold), and relations (typed edges between concepts).

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | Yes | — | Unique identifier for this specification |
| `description` | string | Yes | — | Human-readable description of what this spec covers |
| `concepts` | array | No | `[]` | Concept definitions: `[{ name, properties: [{name, type}], operations: [{name, params, preconditions, postconditions}] }]` |
| `constraints` | array | No | `[]` | System-wide invariants: `[{ description, expression }]` |
| `relations` | array | No | `[]` | Relationships between concepts: `[{ from, to, type, cardinality }]` |

**Returns:**

```json
{
  "spec_id": "spec_c9a3f1",
  "name": "user-authentication",
  "version": 1,
  "created_at": "2026-03-09T11:00:00Z"
}
```

**Example concept definition:**

```json
{
  "name": "Session",
  "properties": [
    { "name": "token", "type": "string" },
    { "name": "user_id", "type": "string" },
    { "name": "expires_at", "type": "datetime" }
  ],
  "operations": [
    {
      "name": "create",
      "params": [{ "name": "user_id", "type": "string" }],
      "preconditions": ["user with user_id exists"],
      "postconditions": ["session.token is unique", "session.expires_at = now + 24h"]
    },
    {
      "name": "invalidate",
      "params": [{ "name": "token", "type": "string" }],
      "preconditions": ["session with token exists"],
      "postconditions": ["session is removed"]
    }
  ]
}
```

---

### `dragonfly_spec_get`

Retrieve the latest version of a named specification. Returns the full spec JSON including all concepts, constraints, and relations.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | Yes | — | Specification name |

**Returns:** Full spec JSON object with all concepts, constraints, and relations as saved, plus version metadata.

---

### `dragonfly_spec_list`

List all stored specifications with summary metadata.

**Parameters:** None required.

**Returns:**

```json
[
  {
    "spec_id": "spec_c9a3f1",
    "name": "user-authentication",
    "description": "Formal spec for session-based JWT authentication",
    "version": 2,
    "status": "active",
    "created_at": "2026-03-09T11:00:00Z"
  }
]
```

---

### `dragonfly_spec_generate`

Generate code from a specification. Produces typed code skeletons with operations, precondition checks, and data types in the target language. The generated code is a starting point — it enforces the spec's structure and contracts but does not implement business logic.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `spec_name` | string | Yes | — | Name of the specification to generate from |
| `language` | string | Yes | — | Target language: `typescript`, `javascript`, `python`, `go`, `rust`, `java` |
| `output_path` | string | No | none | If provided, write generated code to this path instead of returning it inline |

**Returns:**

If `output_path` is not provided:
```json
{
  "spec_name": "user-authentication",
  "language": "typescript",
  "code": "export interface Session {\n  token: string;\n  user_id: string;\n  expires_at: Date;\n}\n..."
}
```

If `output_path` is provided:
```json
{
  "spec_name": "user-authentication",
  "language": "typescript",
  "file_path": "src/auth/session.ts",
  "bytes_written": 1842
}
```

---

### `dragonfly_spec_export`

Export a specification to a portable JSON or YAML file. Useful for sharing specs across projects, version-controlling them in a repository, or importing them into another Dragonfly instance.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `spec_name` | string | Yes | — | Specification to export |
| `format` | string | No | `json` | Output format: `json` or `yaml` |
| `output_path` | string | No | none | Destination file path. Defaults to `{spec_name}.{format}` in current directory |

**Returns:**

```json
{
  "spec_name": "user-authentication",
  "format": "json",
  "file_path": "/project/specs/user-authentication.json",
  "bytes_written": 3241
}
```

---

### `dragonfly_spec_import`

Import a specification from a JSON or YAML file. The file must have been produced by `dragonfly_spec_export` or conform to the same schema. If a spec with the same name already exists, a new version is created.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `file_path` | string | Yes | — | Path to the JSON or YAML spec file |

**Returns:**

```json
{
  "spec_name": "user-authentication",
  "spec_id": "spec_d7e1c2",
  "version": 3,
  "imported": true
}
```

---

## Academic Foundation

### Alloy Specification Language

Jackson, D. (2002). *Alloy: A lightweight object modelling notation.* ACM Transactions on Software Engineering and Methodology, 11(2), 256–290. DOI: 10.1145/505145.505149

Alloy is a formal specification language designed for software design analysis. It models systems as sets of objects with relations between them, and uses a constraint solver (the Alloy Analyzer) to verify that specifications are consistent and to find counterexamples to claimed properties. The Spec module's concept definitions with typed properties, operations with preconditions/postconditions, and system-wide constraints are a direct implementation of Alloy's modeling vocabulary, adapted from formal notation to structured JSON for LLM accessibility. The key Alloy insight adopted here is that specifications should be small enough to analyze — focused on essential structure, not implementation detail.

### The Essence of Software — Concept-Based Specification

Jackson, D. (2021). *The Essence of Software: Why Programs Disagree and How to Make Them Agree.* Princeton University Press. ISBN: 978-0691225388.

Jackson's Essence framework argues that software systems fail because their concept definitions are muddled — concepts have conflicting purposes, tangled states, or ambiguous operations. Formal specification forces the designer to be precise: each concept has a single purpose, a well-defined state, and operations with explicit effects. The `dragonfly_spec_save` schema — with named concepts, typed properties, and operations carrying preconditions/postconditions — implements Essence's concept form. A spec written in this format is directly auditable against Jackson's concept quality criteria.

### Design by Contract

Meyer, B. (1992). *Applying Design by Contract.* IEEE Computer, 25(10), 40–51. DOI: [10.1109/2.161279](https://doi.org/10.1109/2.161279)

Meyer's DbC specifies software components through three elements: preconditions (what the caller guarantees before invocation), postconditions (what the component guarantees after invocation), and class invariants (properties that must hold at all observable states). Every operation in a `dragonfly_spec_save` concept definition carries `preconditions` and `postconditions` arrays, implementing DbC's contract structure. `dragonfly_spec_generate` emits these contracts as runtime assertions in the generated code — not just documentation, but executable checks.

### TLA+ — Temporal Logic Specification

Lamport, L. (2002). *Specifying Systems: The TLA+ Language and Tools for Hardware and Software Engineers.* Addison-Wesley.

TLA+ models systems as sequences of states and state transitions, using temporal logic operators to express safety properties (nothing bad ever happens) and liveness properties (something good eventually happens). The `constraints` array in `dragonfly_spec_save` corresponds to TLA+'s safety invariants — conditions that must hold in all reachable states. While the Spec module does not execute a TLA+ model checker, the constraint vocabulary is designed to be expressible in TLA+ for formal verification by downstream tools.

### OpenAPI Specification 3.0

OpenAPI Initiative. (2021). *OpenAPI Specification 3.0.3.* https://spec.openapis.org/oas/v3.0.3

OpenAPI's structured API description format — operations with named parameters, typed schemas, and explicit response contracts — influenced the Spec module's operation schema design. The `relations` array between concepts reflects OpenAPI's approach to linking resource types. For API-centric projects, `dragonfly_spec_generate` can produce OpenAPI-compatible type definitions from the spec's concept properties, making specs directly usable as API contract documentation.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| *(none module-specific)* | — | Specs stored in `stateDbPath` from plugin config |

---

## Integration with Other Modules

**Framework module:** The `architecture` concept in the workflow produces design artifacts that map directly to spec concepts and relations. A natural workflow pattern is: architecture concept produces a design → `dragonfly_spec_save` formalizes it → `dragonfly_spec_generate` produces typed skeletons → implementation concept fills in the logic.

**State module:** Specs are stored in `stateDbPath` alongside stories and workflow sessions. The spec lifecycle (save → generate → export) is tracked in the provenance `events` table.

**Testing module:** `dragonfly_spec_generate` produces code with precondition assertions. `generate_unit_tests` can read those assertions to derive test cases — a precondition violation is a test case for the error path; a postcondition guarantee is an assertion to verify.

**Bridge module:** Specs exported via `dragonfly_spec_export` are strong candidates for Bridge-level sharing. A reusable authentication spec generalizes across projects better than any episodic memory and can be imported with `dragonfly_spec_import` in any project using Dragonfly.

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/spec/store.ts` | Spec persistence and versioning in stateDbPath |
| `src/tools/spec/generator.ts` | Code generation from concept definitions |
| `src/tools/spec/serializer.ts` | JSON/YAML export and import |
| `src/tools/spec/index.ts` | MCP tool registration |
