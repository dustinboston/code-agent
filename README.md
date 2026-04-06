# Code Agent

Code Agent is an AI-powered command-line interface (CLI) application with an interactive terminal user interface (TUI) designed to assist with software engineering tasks.

## Overview

Code Agent leverages a multi-agent architecture to tackle complex software development challenges. It comprises the following key agents:

- **Planner Agent**: Responsible for breaking down high-level tasks into actionable steps.
- **Developer Agent**: Implements code changes based on the planner's instructions.
- **Tester Agent**: Verifies the implemented changes by running tests and providing feedback.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js >= 20
- **Package Manager**: Bun
- **LLM Orchestration**: LangChain.js (including `@langchain/anthropic`, `@langchain/openai`, `@langchain/google`, `@langchain/community`, `@langchain/core`)
- **CLI Framework**: Commander.js

## Getting Started

### Prerequisites

- Node.js (>= 20)
- Bun

### Installation

To install the project dependencies, run:

```bash
bun install
```

### Usage

- **Development Mode**: Runs the application in development mode.

  ```bash
  bun run dev
  ```

- **Build Application**: Builds the application for distribution.

  ```bash
  bun run build
  ```

- **Run Tests**: Executes the project's test suite.

  ```bash
  bun test
  ```

## Features

- **Interactive TUI**: A rich terminal user interface for an engaging user experience.
- **Multi-Agent Collaboration**: Utilizes specialized AI agents to streamline development workflows.
- **Safe Execution**: Emphasizes cautious and reversible actions, especially for shared or critical operations.
- **Platform Agnostic**: Reads any agents file, CLAUDE.md, GEMINI.md, AGENTS.md, etc. Works with Anthropic, Gemini, or OpenAI models, all configurable.
