# TODO

## Graceful Error Recovery (`src/tui/app.ts`)

When an LLM throws an error (e.g., rate limit, context window exceeded), the app enters an "error" state and blocks the UI with a prompt asking the user to "Press Enter to continue or /quit to exit". This could be improved to print the error in red and immediately return to the input prompt so the user can easily retry or adjust their request.

## Checklist

### **Module 1: Scaffolding & Configuration**

- **Domain:** Project initialization, environment strictness, and repository metadata.
- **Execution Independence:** Can run immediately upon repository creation.
- **Version Control (**`.gitignore`**):** Must omit `node_modules`, build directories (`dist`/`build`), `.env` files, OS artifacts, and IDE configs.
- **Configuration Validation:** Environment variables must be validated at runtime startup (e.g., via Zod or Joi). No hardcoded credentials or environment-specific URIs in source code.
- **System Documentation (**`CLAUDE.md`**):** Must exist at root. Requires: system overview, package script definitions, environment setup steps, and architectural links.
- **Licensing:** Default to `CC BY-NC 4.0`. For proprietary code, `package.json` must state `"license": "SEE LICENSE IN <filename>"` and `"private": true`, with a corresponding custom license file.

### **Module 2: Code Quality & Type Safety**

- **Domain:** Static analysis and syntax enforcement.
- **Execution Independence:** Can run as a continuous background linting/typing agent.
- **Type Strictness:** TypeScript `tsconfig.json` must have `"strict": true`. Zero tolerance for `any` types, non-null assertions (`!`), or type casting (`as Type`).
- **Linting Rules:** Must implement `xo` configured for maximum strictness. Pre-commit hooks must block non-compliant code.
- **Dependency Auditing \[Added\]:** Lockfiles (`package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`) must be present. Automated vulnerability scanning (e.g., `npm audit` or Dependabot) must pass with zero critical/high vulnerabilities.

### Module 3: Architecture & State

- **Domain:** System design, persistence layers, and local infrastructure.
- **Execution Independence:** Requires schema and system design definitions.
- **Architectural Patterns:** Enforce separation of concerns (e.g., controllers, services, repositories). File structure must reflect domain-driven or strictly layered architecture.
- **Data Persistence:** Database schemas (e.g., PostgreSQL for relational, Pinecone for vector data) must use migration scripts. No manual schema modifications.
- **Containerization:** Local dependencies (databases, cache, messaging queues) must run via `docker-compose.yml`. Applications should have multi-stage `Dockerfile` definitions for production builds.

### Module 4: Security & Safeguards

- **Domain:** Threat mitigation, access control, and data protection.
- **Execution Independence:** Can review PRs for security anti-patterns in parallel with testing.
- **Secrets Management:** All cryptographic keys, API tokens, and database credentials must be encrypted at rest and injected via secure managers (e.g., AWS Secrets Manager, HashiCorp Vault). Require key rotation mechanisms.
- **Destructive Operations:** Any `DELETE` or `DROP` operations must implement soft-delete (boolean flags) or robust undo mechanisms. All destructive actions require an immutable audit log entry (actor, timestamp, action, resource).
- **API Contracts:** Endpoints must have defined input/output schemas (e.g., OpenAPI/Swagger) to prevent injection and enforce strict payload boundaries.

### Module 5: Resilience & Traffic Management

- **Domain:** System stability under load and failure conditions.
- **Execution Independence:** Can evaluate network and service-layer code.
- **Error Handling:** Implementation of `try/catch` on all asynchronous operations. Downstream service calls must implement the Circuit Breaker pattern to prevent cascading failures.
- **Rate Limiting:** Ingress traffic must be rate-limited by IP or API key. Outbound retry logic must implement exponential backoff with jitter to prevent thundering herd problems.

### Module 6: Telemetry & Monitoring

- **Domain:** Observability, health tracking, and incident alerting.
- **Execution Independence:** Can verify infrastructure-as-code and application middleware.
- **Observability (Logs, Metrics, Traces):** Structured JSON logging must be enforced. Spans and traces must follow requests across system boundaries (e.g., OpenTelemetry).
- **Monitoring & Alerting:** Integration with APM tools. Endpoints must include a `/health` or `/live` route checking DB connectivity and memory usage. Usage analytics must be tracked without logging PII.

### Module 7: Verification & Delivery

- **Domain:** Automated testing and deployment.
- **Execution Independence:** Runs post-build, parallelized across test runners.
- **Test Coverage:** Strict 100% code coverage requirement across three layers:
  - _Unit Tests:_ Isolated logic, mocked dependencies.
  - _Integration Tests:_ Cross-module and database interactions.
  - _E2E Tests:_ Full user journey simulation.
- **CI/CD Pipeline:** Automated pipelines (e.g., GitHub Actions) must execute linting, type-checking, and testing. Merges to `main` require automated semantic release creation and deployment script execution.

### Module 8: Documentation Context

- **Domain:** Knowledge transfer and operational guides.
- **Execution Independence:** Runs asynchronously, reviewing code to update docs.
- **API Documentation:** Auto-generated from code annotations or strict Markdown.
- **Operational Guides:** Must include a deployment guide, security considerations matrix, and a `CONTRIBUTING.md` outlining local setup and PR standards.
