import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { loadConfig, validateConfig } from "../config.js";
import { App } from "../tui/app.js";
import type { AppConfig } from "../types.js";

/**
 * Defines the `chat` CLI command, which launches an interactive
 * terminal-based chat session powered by RAG retrieval and an LLM.
 *
 * @module commands/chat
 */

/**
 * Commander command that starts an interactive chat session.
 *
 * @remarks
 * Accepts optional CLI flags to override default configuration:
 * - `--top-k <n>` — Number of chunks to retrieve per query (default: 5).
 * - `--model <name>` — Override the Claude model (e.g. `claude-opus-4-5`).
 *
 * The action handler merges any CLI overrides into the application
 * configuration, validates it, and renders the Ink-based terminal UI.
 *
 * @example
 * ```bash
 * npx rag-cli chat
 * npx rag-cli chat --top-k 10 --model claude-opus-4-5
 * ```
 */
export const chatCommand = new Command("chat")
  .description("Start an interactive chat session")
  .option("--top-k <n>", "Number of chunks to retrieve per query (default: 5)", parseInt)
  .option("--model <name>", "Override the Claude model (e.g. claude-opus-4-5)")
  .action((options) => {
    /** CLI-provided overrides to merge into the app config. */
    const overrides: Partial<AppConfig> = {};

    /** Override retrieval settings when --top-k is supplied. */
    if (options.topK !== undefined) {
      overrides.retrieval = { topK: options.topK, scoreThreshold: 0.5 };
    }

    /** Override LLM settings when --model is supplied. */
    if (options.model !== undefined) {
      overrides.llm = {
        provider: "anthropic",
        model: options.model,
        temperature: 0,
        maxTokens: 2048,
      };
    }

    /** Load the merged configuration and validate it. */
    const config = loadConfig(overrides);
    validateConfig(config);

    /** Mount the Ink-based TUI application. */
    render(React.createElement(App, { config }));
  });
