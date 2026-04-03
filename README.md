# code-agent

An interactive CLI for multi-agent software development, built on LangChain, Pinecone, and your choice of LLM provider.

Two operating modes:

- **Team mode** — describe a task and a coordinated team of AI agents (planner, developer, tester) implements and verifies it in your codebase.
- **Chat mode** — ask questions answered by documents you've ingested into a Pinecone vector store.

---

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io)
- A [Pinecone](https://app.pinecone.io) account with an index (dimensions: 512, metric: cosine)
- API keys for the providers you want to use

---

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

```env
ANTHROPIC_API_KEY=sk-ant-...   # Claude (default chat + planner model)
OPENAI_API_KEY=sk-...          # Required for embeddings (text-embedding-3-small)
GOOGLE_API_KEY=AIza...         # Gemini (optional, for team mode agents)
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX=your-index-name
```

`OPENAI_API_KEY` is always required — it powers the embedding model regardless of which LLM provider you use for chat.

---

## Commands

### Ingest documents

```bash
pnpm dev ingest <path/to/file>
```

Supported formats: `.txt`, `.md`, `.pdf`. Each document is chunked, embedded, and upserted into Pinecone. Metadata is cached locally in `data/documents/` so the store can be listed without querying Pinecone.

---

### Chat mode

```bash
pnpm dev chat
```

Ask questions that are answered using your ingested documents. Each query retrieves the most relevant chunks from Pinecone and passes them as context to the LLM. Supports multi-turn conversation.

**Slash commands (inside the chat):**

| Command | Description |
| --- | --- |
| `/help` | Show available commands |
| `/sources` | Show source documents from the last response |
| `/ingest <path>` | Ingest a file without leaving the session |
| `/config` | Print the current configuration |
| `/clear` | Clear conversation history |
| `/quit` | Exit |

---

### Team mode

```bash
pnpm dev team
```

Describe a software task in plain English. A **coordinator** (planner LLM) researches your codebase, writes a specification, and delegates to two sub-agents:

- **Developer** — reads and writes source files to implement the spec.
- **Tester** — writes/updates tests, runs `pnpm test -- --run`, and runs `pnpm exec tsc --noEmit` to verify correctness.

When the tester wants to run a shell command, the TUI pauses and asks for your approval (`y/N`) before executing it.

Activity from all agents streams to the terminal in real time with an indented activity log.

---

### Manage the document store

```bash
pnpm dev store list    # list all ingested documents
pnpm dev store clear   # remove all documents from Pinecone and local cache
```

---

### Inspect configuration

```bash
pnpm dev config
```

Prints the fully-resolved configuration (after merging defaults, `code-agent.config.json`, and env vars).

---

## Configuration

Configuration is resolved in layers, lowest to highest priority:

1. Built-in defaults (see `src/config.ts`)
2. `code-agent.config.json` in the project root (optional)
3. Environment variables
4. CLI flags

### `code-agent.config.json`

Override any section of the config without touching env vars. Example — run the team agents on Gemini:

```json
{
  "planner": {
    "provider": "google",
    "model": "gemini-2.5-pro-preview",
    "temperature": 0.7,
    "maxTokens": 8192
  },
  "developer": {
    "provider": "google",
    "model": "gemini-2.5-flash",
    "temperature": 0.3,
    "maxTokens": 8192
  },
  "tester": {
    "provider": "google",
    "model": "gemini-2.5-flash",
    "temperature": 0.3,
    "maxTokens": 8192
  }
}
```

### Supported providers

| Provider | Value | Models |
| --- | --- | --- |
| Anthropic | `"anthropic"` | `claude-sonnet-4-6`, `claude-opus-4-6`, etc. |
| OpenAI | `"openai"` | `gpt-4o`, `gpt-4o-mini`, etc. |
| Google | `"google"` | `gemini-2.5-pro-preview`, `gemini-2.5-flash`, etc. |

Each agent role (`llm`, `planner`, `developer`, `tester`) can use a different provider and model.

### Full config shape

```jsonc
{
  "llm": {
    "provider": "anthropic",       // chat mode model
    "model": "claude-sonnet-4-6",
    "temperature": 0.7,
    "maxTokens": 8192
  },
  "planner": {
    "provider": "anthropic",       // team mode coordinator
    "model": "claude-opus-4-6",
    "temperature": 0.7,
    "maxTokens": 8192
  },
  "developer": {
    "provider": "anthropic",       // team mode developer sub-agent
    "model": "claude-sonnet-4-6",
    "temperature": 0.3,
    "maxTokens": 8192
  },
  "tester": {
    "provider": "anthropic",       // team mode tester sub-agent
    "model": "claude-sonnet-4-6",
    "temperature": 0.3,
    "maxTokens": 8192
  },
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 512              // must match your Pinecone index
  },
  "pinecone": {
    "indexName": "",               // overridden by PINECONE_INDEX env var
    "namespace": ""                // optional
  },
  "chunking": {
    "strategy": "recursive",
    "chunkSize": 1000,
    "chunkOverlap": 200
  },
  "retrieval": {
    "topK": 8,
    "scoreThreshold": 0
  },
  "storage": {
    "dataDir": "./data"
  }
}
```

---

## Development

```bash
pnpm dev chat          # run without building
pnpm build             # compile to dist/
pnpm start chat        # run compiled output
pnpm test              # vitest watch mode
pnpm test -- --run     # single test run
```

### Project structure

```text
src/
  index.ts                  # CLI entry point (Commander)
  types.ts                  # shared interfaces (AppConfig, ChatMessage, etc.)
  config.ts                 # layered config resolution
  commands/
    chat.ts                 # `chat` sub-command
    team.ts                 # `team` sub-command
    ingest.ts               # `ingest` sub-command
    config.ts               # `config` sub-command
    store.ts                # `store list` / `store clear`
  ingest/
    pipeline.ts             # orchestrates load → chunk → embed → upsert
    loader.ts               # LangChain document loaders (PDF/TXT/MD)
    chunker.ts              # RecursiveCharacterTextSplitter
  retrieval/
    store.ts                # PineconeStore initialization
    retriever.ts            # similaritySearchWithScore + result formatting
  generation/
    llm.ts                  # createLLM / createPlanner / createDeveloper / createTester
    prompt.ts               # prompt templates for chat, team, developer, tester
  tools/
    filesystem.ts           # read_file, list_directory, write_file (path-sandboxed)
    shell.ts                # run_command (30s timeout, user approval required)
  tui/
    app.tsx                 # root Ink component, chat + team mode logic
    status.tsx              # status bar component
    chat.tsx                # chat display component
```

---

## How team mode works

```text
User prompt
    │
    ▼
Coordinator (planner LLM)
  ├─ read_file / list_directory  (research phase)
  └─ send_message(developer, spec)
         │
         ▼
     Developer sub-agent
       ├─ read_file
       ├─ list_directory
       └─ write_file
         │
         ▼
  send_message(tester, what was built)
         │
         ▼
     Tester sub-agent
       ├─ read_file
       ├─ list_directory
       ├─ write_file  (tests only)
       └─ run_command ← requires user approval (y/N)
         │
         ▼
Coordinator synthesizes results → responds to user
```

The developer has no shell access. Only the tester can run commands, and each `run_command` call is gated by an interactive approval prompt in the TUI.
