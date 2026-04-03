# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (no build step needed)
pnpm dev                         # launch the agent (team mode)
pnpm dev ingest <path/to/file>
pnpm dev config
pnpm dev store list
pnpm dev store clear

# Build and run built output
pnpm build
pnpm start

# Tests
pnpm test                        # single run
pnpm test -- src/path/to/file    # single file
```

Requires `.env` with `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `PINECONE_API_KEY`, and `PINECONE_INDEX` (see `.env.example`).

## Architecture

ESM TypeScript app. Entry point `src/index.ts` uses Commander to route subcommands (`ingest`, `config`, `store`). The default action (no subcommand) launches team mode via `src/tui/app.ts`.

### Ingestion (`src/ingest/`)

`pipeline.ts` orchestrates the full flow: load documents (PDF/TXT/MD via LangChain loaders in `loader.ts`) → split into chunks (`RecursiveCharacterTextSplitter`, default 1000 chars / 200 overlap in `chunker.ts`) → embed with OpenAI (`text-embedding-3-small`, 512 dims) → upsert to Pinecone → write local metadata to `data/documents/{uuid}.json`.

### Retrieval (`src/retrieval/`)

`store.ts` initializes a `PineconeStore` with OpenAI embeddings. The store is used during ingestion and is available for future retrieval-augmented features.

### Generation (`src/generation/`)

`llm.ts` exports three factory functions, all returning streaming-enabled LangChain instances via an internal `createInstance` helper:

- `createPlanner(config)` — planner agent (`config.planner`, defaults to `claude-opus-4-6`)
- `createDeveloper(config)` — developer sub-agent (`config.developer`, temperature 0.3)
- `createTester(config)` — tester sub-agent (`config.tester`, temperature 0.3)

All three providers are supported: `"anthropic"` → `ChatAnthropic`, `"openai"` → `ChatOpenAI`, `"google"` → `ChatGoogle`.

`prompt.ts` exports three prompt factories:

- `createPlannerPrompt()` — coordinator system prompt + `chat_history` + `{input}`
- `createDeveloperPrompt()` — developer system prompt + `{input}` (stateless)
- `createTesterPrompt()` — tester system prompt + `{input}` (stateless)

`runner.ts` exports two functions:

- `runSubAgent()` — agentic tool-use loop: streams one LLM turn, invokes any tool calls, repeats until the model produces a response with no tool calls.
- `createSendMessageTool()` — creates the `send_message` LangChain tool that the planner uses to delegate work to the developer and tester sub-agents.

### Tools (`src/tools/`)

LangChain `DynamicStructuredTool` wrappers used by team-mode sub-agents:

- `src/tools/filesystem.ts` — `readFileTool`, `listDirectoryTool`, `writeFileTool`, `deletePathTool` (all path-sandboxed via `isSafePath`); exported together as `filesystemTools`.
- `src/tools/shell.ts` — `runCommandTool`: runs a shell command with a 30-second timeout, clears `NODE_OPTIONS` to prevent tsx/Vitest loader conflicts, returns stdout+stderr as a string. Before execution, the TUI prompts the user for approval (y/N).

Both developer and tester sub-agents receive the full tool set: `read_file`, `list_directory`, `write_file`, `delete_path`, `run_command`.

### TUI (`src/tui/`)

Plain readline CLI (no React/Ink). `app.ts` runs the main loop:

1. Initializes the Pinecone vector store and all three LLM instances.
2. Reads user input via `readline/promises`.
3. Slash commands (`/help`, `/clear`, `/ingest <path>`, `/config`, `/quit`) are dispatched to `commands.ts`.
4. Regular input enters the planner agent loop: the planner streams responses and can call `read_file`, `list_directory`, or `send_message`. The loop exits when the planner produces a turn with no tool calls.
5. When a sub-agent calls `run_command`, the TUI pauses and prompts the user for approval (`y/N`) before executing.

`commands.ts` handles all slash commands. `format.ts` handles terminal message formatting with chalk.

### Configuration (`src/config.ts`)

Layered resolution: built-in defaults → optional `code-agent.config.json` → env vars → CLI flags. `AppConfig` in `src/types.ts` is the canonical config shape. It includes `planner`, `developer`, `tester`, `embedding`, `pinecone`, `chunking`, `retrieval`, `storage`, and `allowedCommands` sections.

## Key Details

- **Module resolution**: `"moduleResolution": "bundler"` in tsconfig — imports use `.js` extensions even for `.ts` source files.
- **Local metadata cache**: `data/documents/` stores ingestion records locally so `store list` works without querying Pinecone. The entire `data/` directory is gitignored.
- **Providers**: `Provider = "anthropic" | "openai" | "google"`. Each agent role can be configured to use a different provider via `code-agent.config.json`.
- **Path sandboxing**: All filesystem tools enforce that resolved paths stay within `process.cwd()` to prevent path traversal.
- **Command approval**: `run_command` calls require explicit `y` approval from the user before the shell command executes. Commands matching patterns in `allowedCommands` (regex strings) are pre-approved and skip the prompt.
