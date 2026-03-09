# AST Module

**Module:** `ast`
**Tools:** 7 (`index_project`, `find_symbol`, `get_symbol_info`, `find_references`, `get_call_graph`, `find_implementations`, `get_file_symbols`)
**Feature flag:** None
**Storage:** `stateDbPath` (AST index and symbol records)
**Always enabled:** Yes

---

## Quick Reference

| Tool | Description | Required Params |
|---|---|---|
| `index_project` | Build or rebuild the AST symbol index | None |
| `find_symbol` | Fuzzy-search for a symbol by name | `name` |
| `get_symbol_info` | Retrieve metadata and signature for a known symbol | `file`, `symbol` |
| `find_references` | Find all usage sites of a symbol | `file`, `symbol` |
| `get_call_graph` | Traverse the call graph from a function outward | `file`, `symbol` |
| `find_implementations` | Locate all implementations of an interface or abstract class | `file`, `symbol` |
| `get_file_symbols` | List every symbol defined in a single file | `file` |

---

## Overview

The AST module provides structural, syntax-aware analysis of source code. It builds and maintains an indexed representation of every symbol across the project — functions, classes, methods, interfaces, types, and variables — and exposes that representation through seven tools covering discovery, navigation, and dependency analysis.

Unlike text-search tools, the AST module understands code structure. It knows that `getUserById` in `auth/service.ts` is a function, that it implements the `UserService` interface, and that it is called by `handleLogin` in `routes/auth.ts`. This structural understanding enables precise answers to questions that grep cannot answer reliably.

### Architecture

```
Source files
     │
     ▼
Tree-sitter parsers (per language)
     │  incremental, error-tolerant
     ▼
Symbol extractor
     │  name, kind, file, line, signature
     ▼
AST index (stateDbPath)
     │  symbols + call edges + implementation edges
     ▼
Query layer
     │
     ├─ find_symbol (fuzzy name lookup)
     ├─ get_symbol_info (single symbol detail)
     ├─ find_references (reference graph traversal)
     ├─ get_call_graph (call edge BFS/DFS)
     ├─ find_implementations (interface → class mapping)
     └─ get_file_symbols (file-scoped listing)
```

Indexing is incremental by default: only files modified since the last index build are re-parsed. The index stores both symbol metadata and directional edges (call graph, implementation graph), enabling graph traversal without re-parsing.

Supported languages: TypeScript, JavaScript, Python, Go, Rust, Java, C.

---

## Tools

### `index_project`

Build or rebuild the AST symbol index for the project. Must be called before any query tool can return results. Subsequent calls with `incremental: true` (the default) skip unchanged files, making re-indexing fast.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `paths` | string[] | No | entire project | Restrict indexing to specific directories or files |
| `languages` | string[] | No | all supported | Filter by language: `typescript`, `javascript`, `python`, `go`, `rust`, `java`, `c` |
| `incremental` | boolean | No | `true` | Only re-index files changed since last run |

**Returns:**

```json
{
  "files_indexed": 142,
  "symbols_found": 3871,
  "duration_ms": 840,
  "incremental": true,
  "skipped_unchanged": 98
}
```

---

### `find_symbol`

Find a symbol by name with fuzzy matching. Returns all symbols whose name matches, optionally filtered by kind.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | string | Yes | — | Symbol name to search. Supports partial and fuzzy matches |
| `kind` | string | No | all | Filter: `function`, `class`, `method`, `variable`, `interface`, `type` |
| `limit` | number | No | `10` | Maximum results to return |

**Returns:** Array of match objects:

```json
[
  {
    "name": "getUserById",
    "kind": "function",
    "file": "src/auth/service.ts",
    "line": 42,
    "signature": "getUserById(id: string): Promise<User>"
  }
]
```

---

### `get_symbol_info`

Get detailed metadata about a specific symbol at a known location. Optionally includes the full source body.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `file` | string | Yes | — | Path to the file containing the symbol |
| `symbol` | string | Yes | — | Symbol name |
| `includeBody` | boolean | No | `false` | Include source code of the symbol body |

**Returns:**

```json
{
  "name": "getUserById",
  "kind": "function",
  "file": "src/auth/service.ts",
  "line": 42,
  "signature": "getUserById(id: string): Promise<User>",
  "doc_comment": "Retrieves a user record by primary key.",
  "body": "async function getUserById(id: string): Promise<User> { ... }"
}
```

The `body` field is only present when `includeBody: true`.

---

### `find_references`

Find all sites where a symbol is referenced across the project. Useful for impact analysis before renaming, modifying, or deleting a symbol.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `file` | string | Yes | — | File where the symbol is defined |
| `symbol` | string | Yes | — | Symbol name |
| `includeDefinition` | boolean | No | `false` | Include the definition site in results |

**Returns:** Array of reference locations:

```json
[
  { "file": "src/routes/auth.ts", "line": 17, "context": "const user = await getUserById(req.params.id);" },
  { "file": "src/routes/admin.ts", "line": 88, "context": "const target = await getUserById(targetId);" }
]
```

---

### `get_call_graph`

Traverse the call graph outward from a function or method to the specified depth. Returns a tree of what the target function calls, and what those callees call, recursively.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `file` | string | Yes | — | File containing the root function |
| `symbol` | string | Yes | — | Function or method name |
| `depth` | number | No | `2` | How many levels of callees to traverse |

**Returns:** Call graph tree:

```json
{
  "root": "handleLogin",
  "file": "src/routes/auth.ts",
  "callees": [
    {
      "name": "getUserById",
      "file": "src/auth/service.ts",
      "callees": [
        { "name": "db.query", "file": "src/db/client.ts", "callees": [] }
      ]
    },
    {
      "name": "generateToken",
      "file": "src/auth/jwt.ts",
      "callees": []
    }
  ]
}
```

---

### `find_implementations`

Find all classes or types that implement a given interface or extend an abstract class. Essential for understanding polymorphism and locating concrete behavior behind an abstraction.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `file` | string | Yes | — | File where the interface or abstract class is defined |
| `symbol` | string | Yes | — | Interface or abstract class name |

**Returns:**

```json
[
  { "name": "PostgresUserStore", "file": "src/db/postgres.ts", "line": 12 },
  { "name": "InMemoryUserStore", "file": "src/test/mocks.ts", "line": 5 }
]
```

---

### `get_file_symbols`

List every symbol defined in a file. Useful for understanding the public API of a module or finding entry points before deeper analysis.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `file` | string | Yes | — | Path to the source file |

**Returns:**

```json
[
  { "name": "UserService", "kind": "interface", "line": 3 },
  { "name": "getUserById", "kind": "function", "line": 42 },
  { "name": "createUser", "kind": "function", "line": 67 },
  { "name": "deleteUser", "kind": "function", "line": 91 }
]
```

---

## Academic Foundation

### Tree-sitter — Incremental, Error-Tolerant Parsing

Brunsfeld, M. et al. (2018). *Tree-sitter: A new parsing system for programming tools.* GitHub. https://tree-sitter.github.io/tree-sitter/

Tree-sitter is the parsing engine underlying the AST module's symbol extraction. It produces concrete syntax trees for 40+ languages with two critical properties for tooling: (1) **incremental parsing** — when a file changes, only the affected subtree is re-parsed, not the entire file; (2) **error tolerance** — it produces a best-effort parse tree even for syntactically invalid code, meaning the index remains useful during active editing. These properties make `index_project` with `incremental: true` practical for continuous background indexing during development.

### Language Server Protocol — Reference and Navigation Semantics

Microsoft. (2016). *Language Server Protocol Specification.* https://microsoft.github.io/language-server-protocol/

The LSP defines a standard protocol between editors and language intelligence servers, establishing operations including `textDocument/definition`, `textDocument/references`, `textDocument/documentSymbol`, and `callHierarchy/incomingCalls`. The `find_references`, `find_symbol`, `get_file_symbols`, and `get_call_graph` tools in this module are direct implementations of LSP query semantics, adapted from an interactive editor context to a programmatic MCP context. The LSP specification serves as the semantic contract for what these queries should return.

### Program Dependence Graphs — Call Graph Theory

Ferrante, J., Ottenstein, K. J., & Warren, J. D. (1987). *The program dependence graph and its use in optimization.* ACM Transactions on Programming Languages and Systems, 9(3), 319–349. https://doi.org/10.1145/24039.24041

The call graph produced by `get_call_graph` is a directed subgraph of the full Program Dependence Graph (PDG). Ferrante et al. formalized the PDG as the union of control dependence and data dependence edges, proving that PDG structure is the minimal representation needed to understand how a change in one node propagates to dependent nodes. The depth-bounded BFS traversal in `get_call_graph` implements Ferrante et al.'s reachability analysis on the call-edge subgraph.

### Graph Traversal — PageRank and Code Graph Ranking

Brin, S. & Page, L. (1998). *The anatomy of a large-scale hypertextual web search engine.* Computer Networks and ISDN Systems, 30(1–7), 107–117.

The ranking of fuzzy symbol matches in `find_symbol` applies graph-theoretic relevance principles analogous to PageRank: symbols referenced by more callers are ranked higher in tie-breaking scenarios. The web graph / code graph analogy holds precisely: files are pages, import statements are links, and highly-referenced symbols are hubs.

### AST-Derived Knowledge Graph RAG

arXiv preprint. (2026). *AST-derived Knowledge Graph RAG achieves 95.6% accuracy on code QA.* arXiv:2601.08773. https://arxiv.org/html/2601.08773

This 2026 study demonstrates that code question-answering systems using AST-derived structural graphs achieve 95.6% accuracy — substantially outperforming systems using text-only or embedding-only retrieval. The finding validates the AST module's role as a structural complement to the Semantic module's embedding-based search. Hybrid retrieval (AST structure + semantic embeddings) is the architecture underpinning Dragonfly's code intelligence pipeline.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| *(none module-specific)* | — | Index data stored at path from `stateDbPath` in plugin config |

---

## Integration with Other Modules

**Semantic module:** The AST index and the semantic embedding index are complementary. AST tools answer structural questions ("what does this function call?"); Semantic tools answer meaning questions ("find code related to authentication"). `find_symbol` + `get_symbol_info` are typically called after `semantic_search` narrows the result set to a handful of files.

**Testing module:** `get_call_graph` and `find_references` feed directly into `generate_unit_tests` — understanding what a function calls determines what needs to be mocked, and reference analysis identifies integration points that require integration tests.

**Repair module:** `get_symbol_info` with `includeBody: true` provides the exact source code passed to `self_debug` and `iterative_refine`. `find_references` provides the blast radius of a proposed change.

**Knowledge Graph module:** The AST module's symbol and call-edge data is one of the primary ingestion sources for `kg_ingest_ast`, which elevates flat symbol records into a queryable entity-relationship graph.

**Analytics module:** `find_untested_files` in the Testing module cross-references file lists with the AST symbol index to identify files that define symbols but lack corresponding test files.

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/ast/indexer.ts` | Tree-sitter parsing and symbol extraction |
| `src/tools/ast/graph.ts` | Call graph and implementation edge construction |
| `src/tools/ast/query.ts` | Fuzzy search and reference lookup |
| `src/tools/ast/index.ts` | MCP tool registration |
