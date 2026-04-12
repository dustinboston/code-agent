# TODO

## Checklist

### Module 1: Scaffolding & Configuration

- **Domain:** Project initialization, environment strictness, and repository metadata.
- **Execution Independence:** Can run immediately upon repository creation.

#### Version Control (`.gitignore`)

Must omit `node_modules`, build directories (`dist`/`build`), `.env` files, OS artifacts, and IDE configs.

- [x] `node_modules/`
- [x] `dist/`
- [x] `.env`
- [x] `build/` directory
- [x] OS artifacts (`.DS_Store`, `Thumbs.db`)
- [x] IDE configs (`.vscode/`, `.idea/`, `*.swp`)

#### Configuration Validation

Environment variables must be validated at runtime startup (e.g., via Zod or Joi). No hardcoded credentials or environment-specific URIs in source code.

- [x] No hardcoded credentials in source code
- [x] `.env.example` exists with placeholder keys
- [x] `validateConfig` checks for required API key env vars (`src/config.ts:133`)
- [x] Config file (`code-agent.config.json`) is validated at parse time with a Zod `AppConfigSchema` (`src/config.ts:137`). Invalid fields produce per-field warnings and fall back to defaults.
- [x] `loadConfig` merged result is validated with `FullAppConfigSchema.parse()` (`src/config.ts:178`), catching invalid field types (e.g., `temperature: "hot"`) before they reach the application.

#### System Documentation (`CLAUDE.md`)

Must exist at root. Requires: system overview, package script definitions, environment setup steps, and architectural links.

- [x] `AGENTS.md` exists with project overview, tech stack, coding conventions, and commands
- [x] `CLAUDE.md` exists at root (copy of `AGENTS.md`). `loadAgentsFile` (`src/agent.ts:13`) finds whichever is present.
- [x] `AGENTS.md` includes environment setup steps (install Bun, `bun install`, copy `.env.example`, optional config file)
- [x] `AGENTS.md` includes architectural links (full `src/` directory tree with per-file descriptions)

#### Licensing

Default to `CC BY-NC 4.0`. For proprietary code, `package.json` must state `"license": "SEE LICENSE IN <filename>"` and `"private": true`, with a corresponding custom license file.

- [x] `package.json` has `"private": true`
- [x] `package.json` has `"license": "CC-BY-NC-4.0"`
- [x] `LICENSE` file exists at project root with CC BY-NC 4.0

---

### Module 2: Code Quality & Type Safety

- **Domain:** Static analysis and syntax enforcement.
- **Execution Independence:** Can run as a continuous background linting/typing agent.

#### Type Strictness

TypeScript `tsconfig.json` must have `"strict": true`. Zero tolerance for `any` types, non-null assertions (`!`), or type casting (`as Type`).

- [x] `tsconfig.json` has `"strict": true`
- [x] No non-null assertions (`!`) in production code (only in test files)
- [x] `any` types in production code — replaced with proper types:
  - `src/llm/runner.ts` — `onToolCall` uses LangChain's `ToolCall` type; `agent` parameterized with `BaseMessage[], AIMessageChunk`; all `catch` blocks use `unknown` with narrowing; `toolCall.args` accessed via safe property checks
  - `src/tui/app.ts` — all `catch (err: any)` blocks replaced with `catch (error: unknown)` and `instanceof Error` narrowing
- [x] `as` type cast in `src/config.ts:88` — verified already fixed; config uses Zod `FullAppConfigSchema.parse()`
- [x] `as` type cast in `src/tools/shell.ts:50` — replaced with `unknown` and `instanceof Error` narrowing with safe property access

#### Linting Rules

Must implement `xo` configured for maximum strictness. Pre-commit hooks must block non-compliant code.

- [x] `xo` installed and configured for strict TypeScript with prettier integration (`package.json`: `"xo": { "prettier": true, "space": true }`)
- [x] `husky` + `lint-staged` pre-commit hooks run `xo --fix` on staged `*.{ts,tsx}` files
- [x] `prettier` is configured in `package.json` (will need to coordinate with xo)

#### Dependency Auditing

Lockfiles must be present. Automated vulnerability scanning must pass with zero critical/high vulnerabilities.

- [x] `bun.lock` exists
- [ ] No automated vulnerability scanning in CI. Add `bun audit` (or equivalent) step to the CI pipeline.

---

### Module 3: Architecture & State

- **Domain:** System design, persistence layers, and local infrastructure.
- **Execution Independence:** Requires schema and system design definitions.

#### Architectural Patterns

Enforce separation of concerns. File structure must reflect domain-driven or strictly layered architecture.

- [x] Clear separation: `src/tui/` (presentation), `src/llm/` (orchestration), `src/tools/` (infrastructure), `src/config.ts` (configuration), `src/types.ts` (domain types)
- [ ] `src/tui/app.ts` mixes UI logic with agent orchestration (`generateResponse` constructs tools, wires callbacks, manages agent lifecycle). Extract the orchestration logic into `src/llm/` or a new `src/orchestration/` module so the TUI only handles I/O.
- [ ] `src/llm/prompt.ts` contains ~200 lines of raw prompt strings. Consider moving prompt text to separate files (e.g., `src/prompts/*.md` or `src/prompts/*.txt`) so prompts can be edited without touching code.

#### Data Persistence

Database schemas must use migration scripts. No manual schema modifications.

- N/A — This is a stateless CLI tool with no database. Revisit if persistence is added.

#### Containerization

Local dependencies must run via `docker-compose.yml`. Applications should have multi-stage `Dockerfile` definitions for production builds.

- N/A — No local infrastructure dependencies. The app compiles to a standalone binary via `bun build --compile`. Revisit if external services (databases, vector stores) are added.

---

### Module 4: Security & Safeguards

- **Domain:** Threat mitigation, access control, and data protection.
- **Execution Independence:** Can review PRs for security anti-patterns in parallel with testing.

#### Secrets Management

All API tokens must be encrypted at rest and injected via secure managers. Require key rotation mechanisms.

- [x] API keys loaded from environment variables via `dotenv`, never hardcoded
- [x] `.env` is in `.gitignore`
- [x] `.env.example` exists with placeholder values
- [ ] No key rotation mechanism. Document rotation procedure in operational guides.
- [ ] For production/team use, document how to use a secrets manager (e.g., `doppler`, `1password-cli`) instead of a plain `.env` file.

#### Destructive Operations

Any destructive operations must implement soft-delete or robust undo mechanisms. All destructive actions require an immutable audit log entry.

- [ ] `deletePathTool` (`src/tools/filesystem.ts:116`) uses `rm({ recursive: true, force: true })` with no audit trail. Add structured logging for all delete operations (actor, timestamp, path).
- [ ] `writeFileTool` (`src/tools/filesystem.ts:87`) overwrites files with no backup. Consider writing a `.bak` or logging the overwrite event.
- [x] `runCommandTool` requires user approval for execution (`src/llm/runner.ts:163`)
- [ ] `deletePathTool` does not require user approval — only `run_command` goes through the approval flow. Add approval for `delete_path` as well.

#### API Contracts

Endpoints must have defined input/output schemas to prevent injection and enforce strict payload boundaries.

- [x] All LangChain tools define Zod schemas for input validation (`readFileTool`, `writeFileTool`, `listDirectoryTool`, `deletePathTool`, `runCommandTool`, `send_message`)
- [ ] `send_message` tool result is a raw `JSON.stringify` string (`src/llm/runner.ts:350`). Define a Zod schema for the response shape and validate/type it.
- [ ] `runCommandTool` passes arbitrary shell commands — no allowlist or blocklist beyond the user approval prompt. Consider adding a command blocklist for dangerous patterns (e.g., `rm -rf /`, `:(){ :|:& };:`, `> /dev/sda`).

---

### Module 5: Resilience & Traffic Management

- **Domain:** System stability under load and failure conditions.
- **Execution Independence:** Can evaluate network and service-layer code.

#### Error Handling

Implementation of `try/catch` on all asynchronous operations. Downstream service calls must implement the Circuit Breaker pattern to prevent cascading failures.

- [x] `try/catch` on all async operations in `app.ts`, `runner.ts`, `filesystem.ts`, `shell.ts`
- [x] Graceful error recovery — LLM errors print in red and return to input prompt (`src/tui/app.ts:250`)
- [ ] No circuit breaker pattern for LLM API calls. If the provider is down, the app will fail on every attempt. Implement a simple circuit breaker: after N consecutive failures, wait before retrying and surface a clear message to the user.
- [ ] `runCommandTool` has a 30s timeout (`src/tools/shell.ts:41`) but `runAgentLoop` has no overall timeout for the full agent loop. A malfunctioning agent could loop indefinitely.

#### Rate Limiting

Outbound retry logic must implement exponential backoff with jitter to prevent thundering herd problems.

- [ ] No retry logic for LLM API calls. A single rate-limit error (HTTP 429) fails the entire request. Implement exponential backoff with jitter for transient errors (429, 500, 503).
- [ ] LangChain's `ChatAnthropic`/`ChatOpenAI` constructors accept `maxRetries` — currently not configured (`src/llm/llm.ts:29`). Set `maxRetries` with backoff.

---

### Module 6: Telemetry & Monitoring

- **Domain:** Observability, health tracking, and incident alerting.
- **Execution Independence:** Can verify infrastructure-as-code and application middleware.

#### Observability (Logs, Metrics, Traces)

Structured JSON logging must be enforced. Spans and traces must follow requests across system boundaries.

- [ ] All logging uses `console.log`/`console.error`/`console.warn` with unstructured strings. Replace with a structured logger (e.g., `pino`) that outputs JSON with level, timestamp, context.
- [ ] No request tracing. Each user request → planner → developer/tester flow has no correlation ID. Add a request ID that propagates through the agent chain.
- [ ] `writeActivity` callbacks in `app.ts` write directly to stdout with `process.stdout.write`. Route through the structured logger instead.

#### Monitoring & Alerting

Integration with APM tools. Usage analytics must be tracked without logging PII.

- N/A for local CLI tool — no server to monitor. Revisit if a daemon/server mode is added.
- [ ] No usage analytics or telemetry. Consider opt-in anonymous usage metrics (command count, error rate, model used) for improving the tool.

---

### Module 7: Verification & Delivery

- **Domain:** Automated testing and deployment.
- **Execution Independence:** Runs post-build, parallelized across test runners.

#### Test Coverage

Strict 100% code coverage requirement across three layers.

Current coverage (92.85% functions, 93.39% lines):

- [ ] `src/tui/app.ts` — **50% functions, 24.22% lines**. Largest gap. `generateResponse`, `startApp`'s main loop (error state, status display, slash commands, interrupt handling) are mostly untested. Requires testing the readline interaction loop with mocked I/O.
- [ ] `src/llm/runner.ts` — **77.78% functions, 90.88% lines**. Missing coverage for: tool call chunk announcement (`lines 77-81`), stream text extraction edge cases (`88-89`), interrupt partial state (`116`), tool error edge case (`187`), sub-agent interrupt message assembly (`lines 286-291`), and parts of `createSendMessageTool` (`lines 368-373`).
- [ ] `src/tools/filesystem.ts` — **93.18% lines**. Uncovered: `isSafePath` rejection branches in each tool (`lines 37, 64, 92, 121`) and the mkdir error path (`line 97`).
- [ ] `src/agent.ts` — **88.24% lines**. Uncovered: catch block in `readAgentsFile` (`lines 36-37`).
- [ ] No integration tests — all tests are unit tests with mocked dependencies.
- [ ] No E2E tests — no tests that run the actual CLI and verify end-to-end behavior.

#### CI/CD Pipeline

Automated pipelines must execute linting, type-checking, and testing. Merges to `main` require automated semantic release creation.

- [x] GitHub Actions workflow exists (`.github/workflows/release.yml`) — builds cross-platform binaries and creates releases on tag push
- [ ] CI only runs on tag pushes (`v*`). No CI on pull requests or pushes to `main`. Add a `ci.yml` workflow that runs on `push` and `pull_request` to `main`.
- [ ] CI does not run tests. Add `bun test` step.
- [ ] CI does not run type-checking. Add `bun run typecheck` step.
- [ ] CI does not run linting. Add linting step (after xo is set up).
- [ ] No semantic release automation. Merges to `main` should auto-version and tag (e.g., via `semantic-release` or `changesets`).

---

### Module 8: Documentation Context

- **Domain:** Knowledge transfer and operational guides.
- **Execution Independence:** Runs asynchronously, reviewing code to update docs.

#### API Documentation

Auto-generated from code annotations or strict Markdown.

- [x] JSDoc comments on all exported functions and interfaces
- [ ] No auto-generated documentation. Set up `typedoc` to generate HTML/Markdown docs from JSDoc annotations. Add a `docs` script to `package.json`.

#### Operational Guides

Must include a deployment guide, security considerations matrix, and a `CONTRIBUTING.md` outlining local setup and PR standards.

- [ ] No `CONTRIBUTING.md`. Create one covering: local setup, environment configuration, running tests, PR standards, coding conventions.
- [ ] No deployment guide. Document: how to build binaries (`bun run build`), how releases work (tag → GitHub Actions → artifacts), how to install from a release.
- [ ] No security considerations matrix. Document: threat model (LLM prompt injection, filesystem access, shell command execution), mitigations in place (path sandboxing, command approval), known limitations.
