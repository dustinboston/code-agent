# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (no build step needed)
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

ESM TypeScript app. Entry point `src/index.ts` uses Commander to route subcommands to four subsystems: `ingest`, `chat`, `team`, `config`, `store`.

### Ingestion (`src/ingest/`)

`pipeline.ts` orchestrates the full flow: load documents (PDF/TXT/MD via LangChain loaders in `loader.ts`) → split into chunks (`RecursiveCharacterTextSplitter`, default 1000 chars / 200 overlap in `chunker.ts`) → embed with OpenAI (`text-embedding-3-small`, 512 dims) → upsert to Pinecone → write local metadata to `data/documents/{uuid}.json`.

### Retrieval (`src/retrieval/`)

`store.ts` initializes a `PineconeStore` with OpenAI embeddings. `retriever.ts` runs `similaritySearchWithScore` and returns both a formatted context string with `[Source N: path — relevance: XX%]` labels (for the prompt) and raw `RetrievalResult[]` (for the TUI to display).

### Generation (`src/generation/`)

`llm.ts` exports four factory functions, all returning streaming-enabled LangChain instances via an internal `createInstance` helper:

- `createLLM(config)` — primary chat (`config.llm`)
- `createPlanner(config)` — planner agent (`config.planner`, defaults to `claude-opus-4-6`)
- `createDeveloper(config)` — developer sub-agent (`config.developer`, temperature 0.3)
- `createTester(config)` — tester sub-agent (`config.tester`, temperature 0.3)

All three providers are supported: `"anthropic"` → `ChatAnthropic`, `"openai"` → `ChatOpenAI`, `"google"` → `ChatGoogle`.

`prompt.ts` exports four prompt factories:

- `createChatPrompt()` — system with `{context}` + `chat_history` + `{input}`
- `createTeamPrompt()` — coordinator system prompt + `chat_history` + `{input}`
- `createDeveloperPrompt()` — developer system prompt + `{input}` (stateless)
- `createTesterPrompt()` — tester system prompt + `{input}` (stateless)

### Tools (`src/tools/`)

LangChain `DynamicStructuredTool` wrappers used by team-mode sub-agents:

- `src/tools/filesystem.ts` — `readFileTool`, `listDirectoryTool`, `writeFileTool` (all path-sandboxed via `isSafePath`); exported together as `filesystemTools`.
- `src/tools/shell.ts` — `runCommandTool`: runs a shell command with a 30-second timeout, clears `NODE_OPTIONS` to prevent tsx/Vitest loader conflicts, returns stdout+stderr as a string. Before execution, the TUI prompts the user for approval (y/N).

### TUI (`src/tui/`)

Built with Ink (React for terminals). `app.tsx` supports two modes via the `mode` prop:

**Chat mode** (`pnpm dev chat`): RAG retrieval + single-shot LLM generation. Each query retrieves context from Pinecone, formats a prompt, and streams the response.

**Team mode** (`pnpm dev team`): Multi-agent loop. The planner (`claude-opus-4-6`) has access to `read_file`, `list_directory`, and `send_message`. `send_message` dispatches to:

- **Developer** — `read_file`, `list_directory`, `write_file` (no shell access)
- **Tester** — `read_file`, `list_directory`, `write_file`, `run_command`

Each sub-agent runs in `runSubAgent()`: an agentic tool-use loop that iterates until the model produces a response with no tool calls. Activity log lines are written to stdout via `useStdout().write()` as they arrive. When the tester calls `run_command`, the TUI pauses and prompts the user for approval before executing.

`appState` (`"initializing" | "idle" | "retrieving" | "generating" | "error"`) drives the status bar in `status.tsx`. Messages are written directly to the terminal via `useStdout().write()` rather than `<Static>`, so they appear in the scrollback above Ink's live input area. In-chat slash commands (`/help`, `/clear`, `/sources`, `/config`, `/quit`, `/ingest <path>`) are handled inside `app.tsx`.

### Configuration (`src/config.ts`)

Layered resolution: built-in defaults → optional `code-agent.config.json` → env vars → CLI flags. `AppConfig` in `src/types.ts` is the canonical config shape. It includes `llm`, `planner`, `developer`, `tester`, `embedding`, `pinecone`, `chunking`, `retrieval`, and `storage` sections.

## Key Details

- **Module resolution**: `"moduleResolution": "bundler"` in tsconfig — imports use `.js` extensions even for `.ts` source files.
- **Local metadata cache**: `data/documents/` stores ingestion records locally so `store list` works without querying Pinecone. The entire `data/` directory is gitignored.
- **Providers**: `Provider = "anthropic" | "openai" | "google"`. Each agent role can be configured to use a different provider via `code-agent.config.json`.
- **Path sandboxing**: All filesystem tools enforce that resolved paths stay within `process.cwd()` to prevent path traversal.
- **Command approval**: `run_command` calls in team mode require explicit `y` approval from the user in the TUI before the shell command executes.
