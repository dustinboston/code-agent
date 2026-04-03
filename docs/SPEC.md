# Code Agent — Technical Specification

## Architecture

The application follows a pipeline architecture with four main stages:

```text
Ingest:   Files → Loader → Chunker → Embedder → Vector Store
Query:    Input → Embedder → Vector Store → Retriever → Prompt Builder → LLM → TUI
```

Each stage is a separate module. LangChain.js provides the core abstractions (document loaders, text splitters, embeddings, vector stores, chains) so each module is thin — mostly configuration and wiring.

```text
src/
├── index.ts              # Entry point, CLI command routing
├── config.ts             # Configuration loading and validation
├── ingest/
│   ├── loader.ts         # LangChain document loaders (PDF, text, markdown)
│   ├── chunker.ts        # LangChain text splitter configuration
│   └── pipeline.ts       # Orchestrates: load → split → embed → store
├── retrieval/
│   ├── store.ts          # Pinecone vector store setup via LangChain
│   └── chain.ts          # LangChain retrieval chain (retriever + prompt + LLM)
├── generation/
│   ├── prompt.ts         # LangChain prompt templates
│   └── llm.ts            # LangChain ChatAnthropic model setup
├── tui/
│   ├── app.ts            # Main TUI application layout
│   ├── chat.ts           # Chat message display
│   ├── input.ts          # User input handling
│   └── status.ts         # Status bar and indicators
└── types.ts              # Shared type definitions
```

## Technology Choices

### Runtime & Language

- **TypeScript** with strict mode, targeting ES2022+
- **Node.js** ≥ 20 (for native fetch, top-level await, etc.)
- **tsx** for development (run TypeScript directly without a build step)
- **tsup** for building a distributable bundle (if needed)

### Package Manager

- **pnpm** — fast, disk-efficient, strict dependency resolution

### TUI Framework

- **Ink** (React for CLI) — component-based terminal UI built on React
  - Why: Declarative, composable, familiar mental model for anyone who knows React. Active ecosystem with good primitives (text input, spinner, box layout).
  - Alternatives considered: Blessed/neo-blessed (powerful but unmaintained), Bubbletea (Go-only), raw ANSI escape codes (too low-level).
- **ink-markdown** or **marked-terminal** — render markdown in the terminal
- **ink-spinner** — loading indicators
- **ink-text-input** — user text input component
- **cli-highlight** — syntax highlighting for code blocks

### AI / LLM Orchestration

- **LangChain.js** (`langchain`, `@langchain/core`, `@langchain/anthropic`, `@langchain/pinecone`, `@langchain/community`) — the orchestration framework that ties everything together
  - Why: Provides standardized abstractions for the entire RAG pipeline — document loading, text splitting, embeddings, vector stores, retrieval chains, prompt templates, and LLM interaction. Reduces boilerplate, makes components swappable, and follows established patterns.
  - `@langchain/anthropic` — `ChatAnthropic` model wrapper with streaming support
  - Default model: `claude-sonnet-4-20250514` (good balance of speed and quality for interactive use)
- **OpenAI embeddings** via `@langchain/openai` — `OpenAIEmbeddings` using `text-embedding-3-small`
  - Why: Widely used, affordable, good quality for general-purpose retrieval. LangChain makes it trivial to swap to another embedding provider later.

### Vector Store

- **Pinecone** via `@langchain/pinecone` + `@pinecone-database/pinecone`
  - Why: Managed vector database — no infrastructure to maintain, generous free tier (up to 5M vectors), fast similarity search, metadata filtering. Accessed through LangChain's `PineconeVectorStore` for a clean integration.
  - Free tier is sufficient for a starter project
  - Requires creating an index in the Pinecone dashboard (one-time setup)

### Document Loading

- **LangChain document loaders**:
  - `PDFLoader` (from `@langchain/community/document_loaders/fs/pdf`) — PDF text extraction
  - `TextLoader` — plain text files
  - `UnstructuredMarkdownLoader` or `TextLoader` — markdown files
- **LangChain text splitters**:
  - `RecursiveCharacterTextSplitter` — default chunking strategy with configurable size and overlap

### CLI Framework

- **Commander.js** — for top-level CLI commands (`ingest`, `chat`, `config`)
  - Why: Lightweight, well-documented, TypeScript-friendly. Overkill alternatives (oclif) aren't needed for a starter.

### Testing

- **Vitest** — fast, TypeScript-native, compatible with the ecosystem

## Core Types

```typescript
interface Document {
  id: string;
  content: string;
  metadata: {
    source: string;       // file path
    format: string;       // txt, md, pdf
    title?: string;
    ingestedAt: string;   // ISO timestamp
  };
}

interface Chunk {
  id: string;
  documentId: string;
  content: string;
  index: number;          // position within document
  metadata: {
    source: string;
    startOffset: number;
    endOffset: number;
  };
}

interface RetrievalResult {
  chunk: Chunk;
  score: number;          // similarity score (0–1)
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: RetrievalResult[];  // only on assistant messages
  timestamp: string;
}

interface AppConfig {
  llm: {
    provider: "anthropic";
    model: string;
    temperature: number;
    maxTokens: number;
  };
  embedding: {
    provider: "openai";
    model: string;          // default: "text-embedding-3-small"
    dimensions: number;     // default: 1536
  };
  pinecone: {
    indexName: string;      // Pinecone index name
    namespace?: string;     // optional namespace for multi-tenant separation
  };
  chunking: {
    strategy: "recursive";
    chunkSize: number;      // in characters
    chunkOverlap: number;
  };
  retrieval: {
    topK: number;
    scoreThreshold: number; // minimum similarity to include
  };
  storage: {
    dataDir: string;        // default: ./data (for local metadata cache)
  };
}
```

## Key Flows

### Ingestion Flow

1. User runs `code-agent ingest ./docs/my-file.pdf`
2. **LangChain Loader** (`PDFLoader`/`TextLoader`) reads the file and produces `Document` objects
3. **LangChain Splitter** (`RecursiveCharacterTextSplitter`) splits into overlapping chunks (default: 1000 chars, 200 overlap)
4. **LangChain + Pinecone** (`PineconeVectorStore.fromDocuments()`) embeds chunks via OpenAI and upserts vectors into Pinecone
5. CLI reports: number of chunks created, total documents processed

### Chat Flow

1. User runs `code-agent chat`
2. **TUI** renders: chat history pane, input field, status bar
3. User types a question and presses Enter
4. **Status** shows "Searching knowledge base..."
5. **LangChain retrieval chain** handles the query pipeline:
   - `PineconeVectorStore.asRetriever()` embeds the query and performs similarity search
   - `ChatPromptTemplate` constructs the prompt with retrieved context + conversation history
   - `ChatAnthropic` streams the response via `chain.stream()`
6. **TUI** renders streamed tokens as they arrive
7. **Chat** appends the full response (with source metadata) to history
8. Loop returns to step 3

### Prompt Template

```text
You are a helpful assistant. Answer the user's question based on the
provided context. If the context doesn't contain enough information to
answer, say so — do not make up information.

## Context

{retrieved chunks, each prefixed with [Source: filename.md, chunk 3]}

## Conversation
{message history}
```

## Configuration

Configuration is resolved in this order (later overrides earlier):

1. Built-in defaults (defined in `config.ts`)
2. Config file: `./code-agent.config.json` (optional)
3. Environment variables (loaded from `.env` via `dotenv`)
4. CLI flags

### Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | API key for Claude (LLM) |
| `OPENAI_API_KEY` | Yes | API key for OpenAI embeddings |
| `PINECONE_API_KEY` | Yes | API key for Pinecone vector database |
| `PINECONE_INDEX` | Yes | Name of the Pinecone index to use |

### CLI Commands

```text
code-agent ingest <path>       Ingest a file or directory into the knowledge base
  --chunk-size <n>              Override chunk size (default: 1000)
  --chunk-overlap <n>           Override chunk overlap (default: 200)

code-agent chat                Start an interactive chat session
  --top-k <n>                   Number of chunks to retrieve (default: 5)
  --model <name>                Override LLM model
  --no-stream                   Disable streaming (wait for full response)

code-agent config              Show current configuration
code-agent config reset        Reset to defaults

code-agent store list          List ingested documents
code-agent store clear         Clear the vector store
```

## Data Storage

Vectors and embeddings are stored in **Pinecone** (cloud-hosted). Local data is minimal:

```text
data/
├── documents/              # Local metadata cache for ingested documents
│   └── {id}.json           # Source path, chunk count, ingestion timestamp
└── config.json             # Persisted user configuration overrides
```

### Pinecone Setup

Users must create a Pinecone index before first use:

1. Sign up at pinecone.io (free tier available)
2. Create an index with dimensions matching the embedding model (1536 for `text-embedding-3-small`)
3. Use cosine similarity as the metric
4. Add the API key and index name to `.env`

## Error Handling

- **Missing API key**: Clear error message pointing to `.env` setup, exit with code 1
- **File not found**: Report the path and supported formats
- **Empty vector store**: Prompt the user to ingest documents first
- **LLM API errors**: Display the error, offer retry, don't crash the TUI
- **Rate limiting**: Exponential backoff with user-visible status

## Performance Considerations

- **Embedding batching**: LangChain handles batching automatically when upserting to Pinecone
- **Streaming**: Always stream LLM responses via LangChain's `.stream()` to minimize perceived latency
- **Pinecone cold start**: Free-tier indexes may have cold start latency (~2-5s after inactivity); the TUI should handle this gracefully with status indicators
- **Chunk size tuning**: Default 1000 chars balances context quality vs. token usage

## Future Extensions (Out of Scope for v1)

These are not part of the starter but the architecture should not preclude them:

- **Tool use / agent mode**: Let the LLM call tools (search, calculator, web fetch)
- **Hybrid search**: Combine vector similarity with BM25 keyword search
- **Re-ranking**: Add a re-ranker model after initial retrieval
- **Multi-modal**: Support images and tables in documents
- **Persistent chat history**: Save/resume conversations across sessions
- **Web UI**: Add an alternative frontend via a local web server
