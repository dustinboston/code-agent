# code-agent

An interactive CLI for multi-agent software development, built on LangChain, Pinecone, and your choice of LLM provider.

Describe a task in plain English. A coordinated team of AI agents (planner, developer, tester) implements and verifies it in your codebase.

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
ANTHROPIC_API_KEY=sk-ant-...   # Claude (default planner model)
OPENAI_API_KEY=sk-...          # Required for embeddings (text-embedding-3-small)
GOOGLE_API_KEY=AIza...         # Gemini (optional, for team mode agents)
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX=your-index-name
```

`OPENAI_API_KEY` is always required — it powers the embedding model regardless of which LLM provider you use.

---

## Commands

### Start the agent

```bash
pnpm dev
```

Launches the interactive team-mode CLI. Describe a software task and the agent team implements it.

**Slash commands (inside the session):**

| Command | Description |
| --- | --- |
| `/help` | Show available commands |
| `/ingest <path>` | Ingest a file into the knowledge base |
| `/config` | Print the current configuration |
| `/clear` | Clear conversation history |
| `/quit` | Exit |

---

### Ingest documents

```bash
pnpm dev ingest <path/to/file>
```

Supported formats: `.txt`, `.md`, `.pdf`. Each document is chunked, embedded, and upserted into Pinecone. Metadata is cached locally in `data/documents/` so the store can be listed without querying Pinecone.

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

Each agent role (`planner`, `developer`, `tester`) can use a different provider and model.

### Full config shape

```jsonc
{
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
    "chunkOverlap": 200,
    "batchSize": 50                // chunks per Pinecone upsert batch
  },
  "retrieval": {
    "topK": 8
  },
  "storage": {
    "dataDir": "./data"
  },
  "allowedCommands": []           // regex patterns for pre-approved shell commands
}
```

---

## Development

```bash
pnpm dev               # run without building
pnpm build             # compile to dist/
pnpm start             # run compiled output
pnpm test              # single test run
pnpm test -- src/path/to/file  # single file
```

### Project structure

```text
src/
  index.ts                  # CLI entry point (Commander)
  types.ts                  # shared interfaces (AppConfig, ChatMessage, etc.)
  config.ts                 # layered config resolution
  commands/
    ingest.ts               # `ingest` sub-command
    config.ts               # `config` sub-command
    store.ts                # `store list` / `store clear`
  ingest/
    pipeline.ts             # orchestrates load → chunk → embed → upsert
    loader.ts               # LangChain document loaders (PDF/TXT/MD)
    chunker.ts              # RecursiveCharacterTextSplitter
  retrieval/
    store.ts                # PineconeStore initialization
  generation/
    llm.ts                  # createPlanner / createDeveloper / createTester
    prompt.ts               # prompt templates for planner, developer, tester
    runner.ts               # runSubAgent loop + createSendMessageTool
  tools/
    filesystem.ts           # read_file, list_directory, write_file, delete_path (path-sandboxed)
    shell.ts                # run_command (30s timeout, user approval required)
  tui/
    app.ts                  # readline CLI — main loop, planner agent loop
    commands.ts             # slash command handler
    format.ts               # terminal message formatter
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
       ├─ write_file
       ├─ delete_path
       └─ run_command ← requires user approval (y/N)
         │
         ▼
  send_message(tester, what was built)
         │
         ▼
     Tester sub-agent
       ├─ read_file
       ├─ list_directory
       ├─ write_file
       ├─ delete_path
       └─ run_command ← requires user approval (y/N)
         │
         ▼
Coordinator synthesizes results → responds to user
```

Both the developer and tester have the full tool set. Each `run_command` call is gated by an interactive approval prompt before the shell command executes.
