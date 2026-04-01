# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (no build step needed)
pnpm dev ingest <path/to/file>
pnpm dev chat
pnpm dev config
pnpm dev store list
pnpm dev store clear

# Build and run built output
pnpm build
pnpm start chat

# Tests
pnpm test                        # watch mode
pnpm test -- --run               # single run
pnpm test -- src/path/to/file    # single file
```

Requires `.env` with `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PINECONE_API_KEY`, and `PINECONE_INDEX` (see `.env.example`).

## Architecture

ESM TypeScript app. Entry point `src/index.ts` uses Commander to route subcommands to three subsystems:

### Ingestion (`src/ingest/`)
`pipeline.ts` orchestrates the full flow: load documents (PDF/TXT/MD via LangChain loaders in `loader.ts`) → split into chunks (`RecursiveCharacterTextSplitter`, default 1000 chars / 200 overlap in `chunker.ts`) → embed with OpenAI (`text-embedding-3-small`, 512 dims) → upsert to Pinecone → write local metadata to `data/documents/{uuid}.json`.

### Retrieval (`src/retrieval/`)
`store.ts` initializes a `PineconeStore` with OpenAI embeddings. `retriever.ts` runs `similaritySearchWithScore` and returns both a formatted context string with `[Source N: path — relevance: XX%]` labels (for the prompt) and raw `RetrievalResult[]` (for the TUI to display).

### Generation (`src/generation/`)
`llm.ts` creates a `ChatAnthropic` instance with streaming always enabled. `prompt.ts` defines a `ChatPromptTemplate` with a system message + `MessagesPlaceholder("chat_history")` + human turn, enabling multi-turn conversation with retrieved context injected each turn.

### TUI (`src/tui/`)
Built with Ink (React for terminals). `app.tsx` manages all state: `appState` (`"initializing" | "idle" | "retrieving" | "generating" | "error"`) drives the status bar in `status.tsx`. Completed messages use Ink's `<Static>` so they never re-render during streaming; `streamingText` accumulates live tokens from `llm.stream()`. In-chat slash commands (`/help`, `/clear`, `/sources`, `/config`, `/quit`, `/ingest <path>`) are handled inside `app.tsx`.

### Configuration (`src/config.ts`)
Layered resolution: built-in defaults → optional `rag-starter.config.json` → env vars → CLI flags. `AppConfig` in `src/types.ts` is the canonical config shape passed throughout the app.

## Key Details

- **Module resolution**: `"moduleResolution": "bundler"` in tsconfig — imports use `.js` extensions even for `.ts` source files.
- **Local metadata cache**: `data/documents/` stores ingestion records locally so `store list` works without querying Pinecone. The entire `data/` directory is gitignored.
- **Streaming**: `llm.stream()` yields tokens into `streamingText` state; once the stream ends, the completed message moves to `completedMessages` (inside `<Static>`).
