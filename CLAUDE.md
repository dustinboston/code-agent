# AGENT GUIDELINES

This document provides a guide for AI agents working on the "Code Agent" repository.

## 1. Project Overview

"Code Agent" is a command-line interface (CLI) application with an interactive terminal user interface (TUI). It uses a multi-agent architecture (planner, developer, tester) to assist with software engineering tasks via LLM-powered tool use.

## 2. Tech Stack

The project utilizes the following technologies:

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js >= 20
- **Package Manager**: Bun
- **LLM Orchestration**: LangChain.js (including `@langchain/anthropic`, `@langchain/openai`, `@langchain/google`, `@langchain/community`, `@langchain/core`)
- **CLI Framework**: Commander.js
- **LLM Providers**: Anthropic, OpenAI, Google

## 3. Environment Setup

1. Install [Bun](https://bun.sh) (the project's package manager and runtime).
2. Install dependencies:
   ```sh
   bun install
   ```
3. Copy the example environment file and fill in your API keys:
   ```sh
   cp .env.example .env
   ```
   At minimum, set `ANTHROPIC_API_KEY`. See `.env.example` for all supported keys.
4. (Optional) Create a `code-agent.config.json` in the project root to override default model settings. See `src/config.ts` for the schema.

## 4. Architecture

LangChain.js provides the core abstractions resulting in thin, configurable modules.

```
src/
├── index.ts          # CLI entry point (Commander.js)
├── config.ts         # Layered config resolution (defaults → file → env → CLI)
├── types.ts          # Shared TypeScript interfaces (AppConfig, ChatMessage, Provider)
├── agent.ts          # Agent file loader (AGENTS.md / CLAUDE.md)
├── llm/
│   ├── llm.ts        # LLM factory functions (createPlanner, createDeveloper, createTester)
│   ├── prompt.ts     # Prompt templates for each agent role
│   └── runner.ts     # Agent loop, tool dispatch, sub-agent orchestration
├── tools/
│   ├── filesystem.ts # File read/write/list/delete tools (path-sandboxed)
│   └── shell.ts      # Shell command execution tool (with timeout)
└── tui/
    ├── app.ts        # Interactive TUI (readline, streaming output, slash commands)
    ├── commands.ts   # Slash command processor (/help, /config, /quit, etc.)
    └── format.ts     # Chat message formatting
```

## 5. Coding Conventions & Guidelines

- **LangChain.js Abstractions**: Heavily rely on LangChain.js prompt templates, and LLM interaction. Modules should be thin wrappers around LangChain components.
- **TypeScript Strictness**: Use TypeScript with strict mode enabled.
- **LLM Streaming**: Ensure all LLM responses are streamed back to the terminal in real-time using LangChain's streaming capabilities.
- **Robust Error Handling**: Implement comprehensive error handling for scenarios such as missing API keys, file not found errors, empty vector stores, and LLM API errors. The application, especially the TUI, should not crash due to these issues.

## 6. Commands

The following scripts are available for development and testing:

- `bun run dev`: Runs the application in development mode.
- `bun run build`: Builds the application for distribution (standalone binary via `bun build --compile`).
- `bun test`: Executes the project's test suite.
- `bun run typecheck`: Runs `tsc --noEmit` to check for type errors.
