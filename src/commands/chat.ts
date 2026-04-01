import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { loadConfig, validateConfig } from "../config.js";
import { App } from "../tui/app.js";
import type { AppConfig } from "../types.js";

export const chatCommand = new Command("chat")
  .description("Start an interactive chat session")
  .option("--top-k <n>", "Number of chunks to retrieve per query (default: 5)", parseInt)
  .option("--model <name>", "Override the Claude model (e.g. claude-opus-4-5)")
  .action((options) => {
    const overrides: Partial<AppConfig> = {};

    if (options.topK !== undefined) {
      overrides.retrieval = { topK: options.topK, scoreThreshold: 0.5 };
    }

    if (options.model !== undefined) {
      overrides.llm = {
        provider: "anthropic",
        model: options.model,
        temperature: 0,
        maxTokens: 2048,
      };
    }

    const config = loadConfig(overrides);
    validateConfig(config);

    render(React.createElement(App, { config }));
  });
