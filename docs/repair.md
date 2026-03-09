# Repair Module

**Module:** `repair`
**Tools:** 5 (`run_with_verification`, `self_debug`, `iterative_refine`, `run_tests_with_repair`, `get_repair_history`)
**Feature flag:** None
**Storage:** Session repair history stored in-memory per session; optionally persisted to `stateDbPath`
**Always enabled:** Yes

---

## Quick Reference

| Tool | Description | Required Params |
|---|---|---|
| `run_with_verification` | Execute code, capture errors, return repair suggestions | `code`, `language` |
| `self_debug` | Diagnose a failing code + error pair and suggest a fix | `code`, `error`, `language` |
| `iterative_refine` | Apply multi-pass improvements to code, verifying each change | `code`, `language`, `goals` |
| `run_tests_with_repair` | Run tests; if failing, provide targeted repair suggestions | `testCommand` |
| `get_repair_history` | Retrieve repair attempt history for the current session | None |

---

## Overview

The Repair module provides self-healing code execution: run code, detect errors, diagnose root causes, and suggest targeted fixes — iteratively, until the code is correct or the maximum iteration count is reached. It closes the generate-execute-verify loop that makes LLM-assisted coding effective on non-trivial problems.

The module distinguishes three modes of repair:
- **Reactive diagnosis** (`self_debug`): given code and an error, explain what went wrong and how to fix it
- **Iterative refinement** (`iterative_refine`): apply a sequence of improvements toward stated goals, verifying after each pass
- **Test-driven repair** (`run_tests_with_repair`): run the test suite, identify which tests fail, and surface targeted fixes for each failure

All three modes use execution feedback — the actual runtime output or test results — as the signal, not static analysis. This is the key insight from the research: LLMs guided by execution feedback outperform LLMs guided by code review alone.

---

## Tools

### `run_with_verification`

Execute code in the specified language, capture any runtime errors or test failures, and return both the execution result and repair suggestions if errors occurred.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `code` | string | Yes | — | Source code to execute |
| `language` | string | Yes | — | Language: `typescript`, `javascript`, `python`, `go`, `rust`, `java` |
| `testCommand` | string | No | none | Optional test command to run after execution |
| `maxIterations` | number | No | `3` | Maximum repair-and-retry cycles |
| `timeout` | number | No | `30000` | Execution timeout in milliseconds |
| `cwd` | string | No | temp directory | Working directory for execution |

**Returns:**

```json
{
  "success": false,
  "output": "",
  "error": "TypeError: Cannot read properties of undefined (reading 'id')\n    at getUserById (service.ts:45)",
  "exit_code": 1,
  "duration_ms": 234,
  "repair_suggestions": [
    {
      "diagnosis": "getUserById returns undefined when user is not found, but the caller dereferences the result without a null check.",
      "fix": "Add a null check after getUserById: `if (!user) throw new NotFoundError(id);`",
      "confidence": 0.91
    }
  ]
}
```

---

### `self_debug`

Given code and an error message or stack trace, diagnose the root cause and provide a concrete fix suggestion. Optionally includes additional context files to improve diagnosis accuracy.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `code` | string | Yes | — | The failing source code |
| `error` | string | Yes | — | Error message, exception, or stack trace |
| `language` | string | Yes | — | Language of the code |
| `contextFiles` | string[] | No | `[]` | Paths to related files that provide context (imports, types, dependencies) |

**Returns:**

```json
{
  "root_cause": "The `expires_at` field is stored as a Unix timestamp integer in the database but the code attempts to call `.toISOString()` on it as if it were a Date object.",
  "fix": "Wrap the value when reading from the database: `new Date(row.expires_at * 1000).toISOString()`",
  "affected_line": 67,
  "confidence": 0.88,
  "alternative_fixes": [
    "Store expires_at as an ISO string in the database instead of a Unix timestamp"
  ]
}
```

---

### `iterative_refine`

Apply multiple improvement passes to code, executing or testing after each pass to verify the change did not break existing behavior. Each pass targets one or more of the stated `goals`.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `code` | string | Yes | — | Source code to improve |
| `language` | string | Yes | — | Code language |
| `goals` | string[] | Yes | — | Improvement goals, e.g. `["add error handling", "add input validation", "improve readability"]` |
| `testCommand` | string | No | none | Test command to run after each pass to verify correctness |
| `maxPasses` | number | No | `5` | Maximum improvement passes |

**Returns:**

```json
{
  "final_code": "...",
  "passes": [
    {
      "pass_number": 1,
      "goal_addressed": "add error handling",
      "changes_summary": "Added try-catch around database call, throws DatabaseError on failure",
      "tests_passed": true,
      "test_output": "All 12 tests passing"
    },
    {
      "pass_number": 2,
      "goal_addressed": "add input validation",
      "changes_summary": "Added Zod schema validation for input parameters",
      "tests_passed": true,
      "test_output": "All 12 tests passing"
    }
  ],
  "goals_completed": ["add error handling", "add input validation"],
  "goals_skipped": ["improve readability"]
}
```

---

### `run_tests_with_repair`

Run the test suite and, if tests fail, provide targeted repair suggestions for each failing test. Optionally retries after applying suggestions.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `testCommand` | string | Yes | — | Test command to execute |
| `cwd` | string | No | project root | Working directory |
| `maxAttempts` | number | No | `3` | Maximum repair-and-retry cycles |
| `sourceFiles` | string[] | No | `[]` | Source files that should be considered for repair suggestions |

**Returns:**

```json
{
  "final_status": "partial",
  "passed": 50,
  "failed": 2,
  "attempts": 2,
  "repairs": [
    {
      "test": "getUserById throws NotFoundError for unknown ID",
      "diagnosis": "Function throws TypeError instead of NotFoundError — the error type is wrong.",
      "suggested_fix": "Change `throw new Error(...)` to `throw new NotFoundError(...)` at line 45 of service.ts",
      "applied": true,
      "resolved": true
    }
  ]
}
```

`final_status`: `passing` (all tests pass), `partial` (some fixed, some still failing), `failed` (no improvement after all attempts).

---

### `get_repair_history`

Retrieve the history of repair attempts for the current session. Useful for understanding what has been tried, what worked, and what failed — informing future repair strategies.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `session_id` | string | No | current session | Session to retrieve history for |

**Returns:**

```json
{
  "session_id": "sess_9f3a12",
  "attempts": [
    {
      "attempt_id": "rep_001",
      "tool": "run_with_verification",
      "error_type": "TypeError",
      "strategy": "null check insertion",
      "success": true,
      "timestamp": "2026-03-09T11:35:00Z"
    }
  ],
  "total_attempts": 3,
  "success_rate": 0.67
}
```

---

## Academic Foundation

### AlphaCode — Execution-Based Code Generation Verification

Li, Y., Choi, D., Chung, J., Kushman, N., Schrittwieser, J., Leblond, R., et al. (2022). *Competition-level code generation with AlphaCode.* Science, 378(6624), 1092–1097. DOI: 10.1126/science.abq1158

AlphaCode (DeepMind) achieved competitive programmer performance by combining LLM-based code generation with large-scale execution-based filtering: generate thousands of candidate solutions, execute each against test cases, keep only those that pass. The key insight is that execution is a cheap, reliable oracle — it doesn't require a separate evaluator model. The Repair module applies this at a practical scale: instead of generating thousands of candidates, it generates one solution, executes it, uses the execution feedback to guide targeted repair, and iterates. The `run_with_verification` tool is the practical implementation of AlphaCode's execution loop.

### Self-Debugging — LLMs Using Execution Feedback

Chen, X., Lin, M., Schärli, N., & Zhou, D. (2023). *Teaching large language models to self-debug.* arXiv:2304.05128. https://arxiv.org/abs/2304.05128

Chen et al. demonstrate that LLMs can significantly improve their code generation accuracy by using execution feedback to iteratively refine output — a technique they call self-debugging. Three modes are studied: simple execution (run code, check if it passes), rubber duck debugging (explain the code to oneself), and code explanation (generate a natural language explanation then correct the code). The `self_debug` tool implements the execution feedback mode; `iterative_refine` implements the iterative correction loop. The study shows 2–3 pass self-debugging achieves comparable accuracy to generating 10× more solutions without feedback.

### Reflexion — Verbal Reinforcement Learning

Shinn, N., Cassano, F., Gopinath, A., Narasimhan, K., & Yao, S. (2023). *Reflexion: Language agents with verbal reinforcement learning.* NeurIPS 2023. arXiv:2303.11366. https://arxiv.org/abs/2303.11366

Reflexion replaces gradient-based reinforcement learning with verbal feedback: after each failed attempt, the agent generates a textual "reflection" on why it failed and what to try differently. These reflections are stored and prepended to subsequent attempts. The `get_repair_history` tool implements Reflexion's memory mechanism — recording what was attempted and whether it succeeded. The `iterative_refine` tool's per-pass `changes_summary` is the verbal reflection that informs the next pass.

### SWE-bench — Software Engineering Agents

Jimenez, C. E., Yang, J., Wettig, A., Yao, S., Pei, K., Press, O., & Narasimhan, K. (2024). *SWE-bench: Can language models resolve real-world GitHub issues?* ICLR 2024. arXiv:2310.06770. https://arxiv.org/abs/2310.06770

SWE-bench is a benchmark of 2,294 real GitHub issues paired with their resolution pull requests. It evaluates agents on their ability to identify the root cause, locate the relevant code, implement a fix, and pass the associated tests. The benchmark reveals that the hardest aspect is not generating a plausible fix — it is verifying that the fix is correct. `run_tests_with_repair` directly addresses this: it uses the test suite as the verification oracle, the same criterion SWE-bench uses to score agent solutions.

### Automated Program Repair — Systematic Survey

Monperrus, M. (2018). *Automatic software repair: A bibliography.* ACM Computing Surveys, 51(1), 1–24. DOI: 10.1145/3105906

Monperrus catalogues automated repair techniques across three families: generate-and-validate (produce patches, test them), semantic repair (use program specifications to guide patch generation), and learning-based repair (learn fix patterns from historical bugs). The Repair module implements all three: `run_with_verification` is generate-and-validate; `self_debug` with `contextFiles` is specification-guided (using the spec as context); and the `repair_history` mechanism enables learning from past successful fixes within a session.

### GenProg — Generate-and-Validate Patch Synthesis

Le Goues, C., Nguyen, T., Forrest, S., & Weimer, W. (2012). *GenProg: A generic method for automatic software repair.* IEEE Transactions on Software Engineering, 38(1), 54–72. DOI: 10.1109/TSE.2011.104

GenProg introduced the generate-and-validate paradigm for automated repair: use genetic programming to mutate buggy code (delete statements, copy-and-paste snippets, insert code), validate each candidate against the test suite, and iterate. The `maxIterations` parameter in `run_with_verification` and `maxAttempts` in `run_tests_with_repair` implement GenProg's iteration bound. The practical constraint GenProg established — that repair loops must be bounded because test execution is expensive — motivated the default limits in this module.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| *(none module-specific)* | — | No module-specific configuration |

---

## Integration with Other Modules

**Testing module:** `run_tests_with_repair` is a direct extension of `run_tests` from the Testing module. When `run_tests` returns failures, `run_tests_with_repair` adds the diagnostic and repair layer. The `sourceFiles` parameter enables cross-module lookup via the AST module's `find_references`.

**AST module:** `self_debug` uses `get_symbol_info` with `includeBody: true` and `find_references` to gather context for diagnosis when `contextFiles` are provided. Understanding the full call chain is essential for diagnosing errors that originate in a different layer from where they manifest.

**Framework module:** The `implementation` and `quality` concepts in the workflow invoke the Repair module when execution or test failures are detected. `iterative_refine` is the primary tool for the implementation concept's multi-pass code improvement loop.

**Analytics module:** Repair attempt outcomes are written to the provenance `events` table. The Analytics module tracks repair success rates and most common error types across workflow history, surfacing patterns for `dragonfly_learn_patterns`.

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/repair/executor.ts` | Code execution with timeout and environment isolation |
| `src/tools/repair/debugger.ts` | Root cause analysis and fix suggestion |
| `src/tools/repair/refiner.ts` | Iterative multi-pass improvement loop |
| `src/tools/repair/history.ts` | Session repair history tracking |
| `src/tools/repair/index.ts` | MCP tool registration |
