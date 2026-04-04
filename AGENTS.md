# AGENT GUIDELINES

This document provides a guide for AI agents working on the "Code Agent" repository.

## 1. Project Overview

"Code Agent" is a command-line interface (CLI) application with an interactive terminal user interface (TUI).

## 2. Tech Stack

The project utilizes the following technologies:

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js >= 20
- **Package Manager**: Bun
- **LLM Orchestration**: LangChain.js (including `@langchain/anthropic`, `@langchain/openai`, `@langchain/google`, `@langchain/community`, `@langchain/core`)
- **CLI Framework**: Commander.js
- **LLM Providers**: Anthropic, OpenAI, Google

## 3. Architecture

LangChain.js provides the core abstractions resulting in thin, configurable modules.

## 4. Coding Conventions & Guidelines

- **LangChain.js Abstractions**: Heavily rely on LangChain.js prompt templates, and LLM interaction. Modules should be thin wrappers around LangChain components.
- **TypeScript Strictness**: Use TypeScript with strict mode enabled.
- **LLM Streaming**: Ensure all LLM responses are streamed back to the terminal in real-time using LangChain's streaming capabilities.
- **Robust Error Handling**: Implement comprehensive error handling for scenarios such as missing API keys, file not found errors, empty vector stores, and LLM API errors. The application, especially the TUI, should not crash due to these issues.

## 5. Commands

The following scripts are available for development and testing:

- `bun run dev`: Runs the application in development mode.
- `bun run build`: Builds the application for distribution.
- `bun test`: Executes the project's test suite.
