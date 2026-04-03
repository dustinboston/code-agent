# Code Agent — Product Requirements Document

## Overview

Code Agent is a TypeScript command-line application that provides an interactive, terminal-based chat interface powered by retrieval-augmented generation. Users can ingest documents into a local knowledge base, then have conversations where the LLM's responses are grounded in that knowledge.

The project serves as a **starter template** — opinionated enough to be useful out of the box, but simple enough to understand, modify, and extend.

## Goals

1. **Learn by building**: Provide a clear, readable codebase that demonstrates the core RAG pipeline — ingestion, embedding, retrieval, and generation.
2. **Interactive TUI**: Offer a polished terminal UI (not just raw stdin/stdout) with conversation history, status indicators, and formatted output.
3. **Built on LangChain.js**: Use LangChain.js as the orchestration framework, leveraging its battle-tested abstractions for document loading, chunking, embeddings, retrieval, and LLM interaction.
4. **Extensible**: Make it straightforward to swap components (embedding model, vector store, LLM provider) via LangChain's pluggable interfaces.

## Non-Goals

- Production deployment or scaling
- Multi-user or networked access
- GUI or web interface
- Full agent capabilities (tool use, autonomous actions) — though the architecture should not preclude adding these later

## Target Users

Developers learning about RAG who want a working, hackable starting point in TypeScript.

## Features

### P0 — Core

1. **Document ingestion**
   - Accept local files (`.txt`, `.md`, `.pdf`) via a CLI command
   - Chunk documents using a configurable strategy (default: recursive character splitting)
   - Generate embeddings for each chunk
   - Store chunks + embeddings in Pinecone (managed vector database)

2. **Interactive chat session**
   - Launch a TUI-based chat loop
   - Accept user queries via a text input
   - Retrieve the top-k most relevant chunks for each query
   - Send the query + retrieved context to the LLM
   - Stream the LLM response back to the terminal in real time
   - Maintain conversation history within the session

3. **Retrieval pipeline**
   - Embed the user's query using the same model used for ingestion
   - Perform similarity search against the vector store
   - Return ranked results with similarity scores
   - Inject retrieved context into the LLM prompt via a system/context message

4. **Configuration**
   - Environment-based config (`.env` file) for API keys
   - Config file or CLI flags for: chunk size, chunk overlap, top-k, embedding model, LLM model, temperature

### P1 — Quality of Life

1. **Source attribution**
   - Display which document(s) and chunk(s) informed each response
   - Show relevance scores alongside sources

2. **Conversation commands**
   - `/clear` — reset conversation history
   - `/sources` — show sources for the last response
   - `/ingest <path>` — ingest a document without leaving the chat
   - `/config` — display current configuration
   - `/help` — list available commands
   - `/quit` — exit the application

3. **TUI polish**
   - Markdown rendering in the terminal (bold, code blocks, lists)
   - Syntax-highlighted code in responses
   - Loading/spinner indicators during retrieval and generation
   - Scrollable conversation history

### P2 — Nice to Have

1. **Multiple knowledge bases** — named collections that can be switched between
2. **Chunk inspector** — a command to browse/search the vector store directly
3. **Export** — save a conversation to a markdown file

## Success Criteria

- A developer can clone the repo, add an API key, ingest a document, and start chatting with it in under 5 minutes
- The codebase is under 2,000 lines of application code (excluding dependencies)
- The RAG pipeline is built on LangChain.js, making each stage easy to understand and swap
