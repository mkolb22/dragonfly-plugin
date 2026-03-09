# Testing Module

**Module:** `testing`
**Tools:** 6 (`generate_unit_tests`, `generate_integration_tests`, `run_tests`, `analyze_coverage`, `find_untested_files`, `get_test_command`)
**Feature flag:** None
**Storage:** None (pure computation + filesystem reads; coverage reports read from `coverageDir`)
**Always enabled:** Yes

---

## Quick Reference

| Tool | Description | Required Params |
|---|---|---|
| `generate_unit_tests` | Generate unit test templates for a source file or code snippet | `language` (+ `sourceFile` or `code`) |
| `generate_integration_tests` | Generate integration test templates for a module or API | `entryPoint`, `language` |
| `run_tests` | Execute tests and return structured pass/fail results | `command` |
| `analyze_coverage` | Parse coverage reports and identify gaps | None |
| `find_untested_files` | Identify source files with no corresponding test file | None |
| `get_test_command` | Auto-detect the appropriate test runner command | None |

---

## Overview

The Testing module provides test generation, execution, and coverage analysis. It handles the full test lifecycle: detecting which files lack tests, generating test templates from source code, running the test suite, and analyzing coverage gaps.

Test generation is template-based — the module produces well-structured test files with appropriate imports, test cases scaffolded from the source's function signatures and inferred behaviors, and suggested assertion patterns. The generated tests require filling in concrete expected values; they are a starting point, not a complete test suite.

The module is language- and framework-agnostic. It detects the test framework from project configuration files (`package.json`, `pytest.ini`, `go.mod`, etc.) and generates tests in the corresponding idiom.

---

## Tools

### `generate_unit_tests`

Generate a unit test template for a source file or code snippet. The template includes imports, test cases for each exported symbol, and suggested assertions based on function signatures and inferred side effects.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `sourceFile` | string | No | — | Path to source file to generate tests for. Mutually exclusive with `code` |
| `code` | string | No | — | Inline source code to generate tests for. Mutually exclusive with `sourceFile` |
| `language` | string | Yes | — | Source language: `typescript`, `javascript`, `python`, `go`, `rust`, `java` |
| `framework` | string | No | auto-detected | Test framework: `jest`, `vitest`, `mocha`, `pytest`, `go-test`, `cargo-test` |
| `coverageTarget` | number | No | `80` | Target coverage percentage to aim for in the generated test cases |

At least one of `sourceFile` or `code` must be provided.

**Returns:**

```json
{
  "test_file": "src/auth/__tests__/service.test.ts",
  "code": "import { getUserById } from '../service';\n\ndescribe('getUserById', () => {\n  it('returns user when id exists', async () => {\n    const result = await getUserById('user-123');\n    expect(result).toBeDefined();\n    expect(result.id).toBe('user-123');\n  });\n\n  it('throws when user not found', async () => {\n    await expect(getUserById('nonexistent')).rejects.toThrow();\n  });\n});",
  "framework": "jest",
  "suggested_cases": [
    "returns user for valid ID",
    "throws NotFoundError for unknown ID",
    "throws ValidationError for malformed ID"
  ]
}
```

---

### `generate_integration_tests`

Generate integration test templates covering the interactions between a module's entry point and its dependencies. Integration tests verify that components work correctly together, where unit tests verify them in isolation.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `entryPoint` | string | Yes | — | Main module, API endpoint, or service entry point to test |
| `dependencies` | string[] | No | `[]` | External dependencies to mock (e.g., `["database", "email-service"]`) |
| `scenarios` | string[] | No | auto-generated | Test scenario descriptions to include |
| `language` | string | Yes | — | Target language |

**Returns:**

```json
{
  "test_file": "src/auth/__integration__/login.test.ts",
  "code": "describe('POST /auth/login integration', () => {\n  beforeEach(async () => {\n    await db.migrate.latest();\n  });\n  ...\n});",
  "mocked_dependencies": ["database"],
  "scenarios": [
    "valid credentials return JWT token",
    "invalid password returns 401",
    "rate limiting blocks after 5 failures"
  ]
}
```

---

### `run_tests`

Execute the test suite using the specified command and return structured results. Captures stdout/stderr, parses test runner output into pass/fail counts, and optionally collects coverage.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `command` | string | Yes | — | Test command to execute, e.g. `npm test`, `pytest`, `go test ./...` |
| `cwd` | string | No | project root | Working directory for test execution |
| `coverage` | boolean | No | `false` | Collect coverage data during test run |
| `filter` | string | No | none | Test name filter (passed to test runner's filter/grep argument) |
| `timeout` | number | No | `120000` | Maximum execution time in milliseconds |

**Returns:**

```json
{
  "passed": 47,
  "failed": 2,
  "skipped": 3,
  "total": 52,
  "duration_ms": 8340,
  "failing_tests": [
    {
      "name": "getUserById throws NotFoundError for unknown ID",
      "file": "src/auth/__tests__/service.test.ts",
      "error": "Expected function to throw NotFoundError but got TypeError"
    }
  ],
  "coverage_pct": 74.3,
  "exit_code": 1
}
```

`coverage_pct` is only present when `coverage: true`.

---

### `analyze_coverage`

Parse existing coverage reports and identify files and line ranges with insufficient test coverage. Reads from the standard coverage output directory produced by most test runners (`istanbul`, `nyc`, `coverage.py`, `go cover`).

**Parameters:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `coverageDir` | string | No | `coverage/` | Path to coverage report directory |

**Returns:**

```json
{
  "overall_pct": 74.3,
  "statement_pct": 76.1,
  "branch_pct": 68.4,
  "function_pct": 81.2,
  "uncovered_files": [
    {
      "file": "src/auth/password-reset.ts",
      "coverage_pct": 0.0,
      "uncovered_lines": "1-89"
    },
    {
      "file": "src/payments/refund.ts",
      "coverage_pct": 23.4,
      "uncovered_lines": "45-67, 89-102"
    }
  ]
}
```

---

### `find_untested_files`

Identify source files in the project that have no corresponding test file. Uses naming convention matching (`service.ts` → `service.test.ts`, `service.spec.ts`) and directory structure conventions (`__tests__/`, `test/`) to determine test pairing.

**Parameters:** None required.

**Returns:**

```json
{
  "untested_files": [
    "src/auth/password-reset.ts",
    "src/payments/webhook-handler.ts",
    "src/utils/rate-limiter.ts"
  ],
  "total_source_files": 42,
  "files_with_tests": 39,
  "coverage_pct": 92.9
}
```

---

### `get_test_command`

Auto-detect the appropriate test command for the current project by inspecting project configuration files.

**Parameters:** None required.

**Returns:**

```json
{
  "command": "npm test",
  "runner": "jest",
  "detected_from": "package.json",
  "coverage_command": "npm test -- --coverage"
}
```

Detection precedence: `package.json` scripts (npm/yarn/pnpm), `pytest.ini`/`pyproject.toml` (pytest), `go.mod` (go test), `Cargo.toml` (cargo test), `build.gradle` (gradle test).

---

## Academic Foundation

### Mutation Testing — Test Quality Measurement

DeMillo, R. A., Lipton, R. J., & Sayward, F. G. (1978). *Hints on test data selection: Help for the practicing programmer.* IEEE Computer, 11(4), 34–41.

Mutation testing evaluates test suite quality by artificially introducing faults (mutations) into source code and measuring whether the test suite detects them. A test suite that fails to catch a mutation is inadequate, regardless of its line coverage percentage. DeMillo et al.'s competent programmer hypothesis — that real bugs resemble simple mutations of correct code — justifies mutation testing as a proxy for real-world defect detection. The Testing module's coverage analysis is a prerequisite for mutation testing: `analyze_coverage` identifies which code is executed by tests, a necessary but not sufficient condition for mutation detection. Branch coverage is the better proxy for mutation score.

### Test-Driven Development

Beck, K. (2002). *Test-Driven Development: By Example.* Addison-Wesley.

TDD inverts the traditional test-after-implementation workflow: write a failing test first, then write the minimum code to make it pass, then refactor. `generate_unit_tests` supports the TDD workflow by producing test skeletons before implementation begins — when used with `dragonfly_spec_generate`, the spec's preconditions and postconditions become test assertions, completing the TDD loop from specification to tests to implementation. The `suggested_cases` array in test generation is the TDD test list that Beck recommends writing before coding begins.

### Search-Based Software Testing

McMinn, P. (2004). *Search-based software test data generation: A survey.* Software Testing, Verification and Reliability, 14(2), 105–156. DOI: 10.1002/stvr.294

SBST uses metaheuristic search algorithms (genetic algorithms, hill climbing, simulated annealing) to automatically generate test inputs that satisfy coverage criteria. The test case suggestions in `generate_unit_tests` implement a simplified version of SBST's input classification: for each function, identify boundary conditions, equivalence classes, and error-inducing inputs. The `suggested_cases` array corresponds to SBST's test requirement set — the set of conditions that must be covered to achieve the target `coverageTarget`.

### Code Coverage Criteria

Myers, G. J. (1979). *The Art of Software Testing.* Wiley.

Myers established the primary coverage criteria that remain standard today: statement coverage (every line executed), branch coverage (every conditional branch taken both ways), path coverage (every execution path), and condition coverage (every boolean sub-expression evaluated to both true and false). `analyze_coverage` reports statement, branch, and function coverage — Myers's first three criteria. Branch coverage is most practically important: uncovered branches typically correspond to untested error paths and edge cases, which are where the most serious defects live.

### The Test Pyramid

Cohn, M. (2009). *Succeeding with Agile: Software Development Using Scrum.* Addison-Wesley.

The test pyramid — many unit tests, fewer integration tests, few end-to-end tests — guides the composition of a healthy test suite. `generate_unit_tests` targets the base layer (fast, isolated, numerous); `generate_integration_tests` targets the middle layer (slower, fewer, testing component interaction). The `coverageTarget` default of 80% reflects the practical industry standard for the unit test layer: achieving 100% unit coverage is rarely cost-effective, while below 80% leaves too many defect entry points.

### EvoSuite — Automated Test Suite Generation

Fraser, G. & Arcuri, A. (2011). *EvoSuite: Automatic test suite generation for object-oriented software.* Proceedings of the 19th ACM SIGSOFT Symposium on Foundations of Software Engineering (ESEC/FSE). DOI: 10.1145/2025113.2025179

EvoSuite uses evolutionary algorithms to generate complete JUnit test suites, optimizing for branch coverage. Its generate-and-execute loop — generate candidate tests, execute them, measure coverage gained, select survivors, mutate — is the methodological ancestor of the Repair module's `iterative_refine` tool applied to test improvement. EvoSuite demonstrated that automated test generation can match or exceed manually written tests on coverage metrics, validating the automated test generation approach implemented in this module.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| *(none module-specific)* | — | No module-specific configuration |

---

## Integration with Other Modules

**AST module:** `generate_unit_tests` benefits from `get_file_symbols` to enumerate the symbols to test and `get_call_graph` to identify mock candidates (callees of the function under test). `find_untested_files` cross-references the AST symbol index against detected test files.

**Repair module:** `run_tests` output feeds directly into `run_tests_with_repair` in the Repair module. The structured `failing_tests` array is the input to `self_debug` for root cause analysis when tests fail.

**Framework module:** The `quality` concept in the WYSIWID workflow orchestrates the testing pipeline: `find_untested_files` → `generate_unit_tests` → `run_tests` → `analyze_coverage`. The quality concept's completion criterion is a passing test suite at or above the coverage target.

**Spec module:** `dragonfly_spec_generate` produces code with precondition assertions. `generate_unit_tests` applied to that generated code produces tests that directly verify the spec's contracts — a precondition violation becomes a test for the error path; a postcondition guarantee becomes an assertion.

**Analytics module:** `run_tests` results are written to the provenance `events` table. The Analytics module tracks test pass rates over time as a quality trend metric in `dragonfly_analyze_workflows`.

---

## File Reference

| File | Purpose |
|---|---|
| `src/tools/testing/generator.ts` | Unit and integration test template generation |
| `src/tools/testing/runner.ts` | Test execution and output parsing |
| `src/tools/testing/coverage.ts` | Coverage report parsing and gap analysis |
| `src/tools/testing/detector.ts` | Test command and framework auto-detection |
| `src/tools/testing/index.ts` | MCP tool registration |
