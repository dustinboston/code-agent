/**
 * @module commands/team
 *
 * Defines the `team` CLI sub-command, which launches the Ink-based TUI in
 * team mode. In team mode the application runs a multi-agent loop consisting
 * of a planner, a developer, and a tester rather than a single RAG chat model.
 */
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { loadConfig, validateConfig } from "../config.js";
import { App } from "../tui/app.js";

/**
 * Commander command that starts the interactive team session.
 *
 * @remarks
 * Loads and validates the application configuration, then renders the
 * {@link App} component with `mode` set to `"team"`. In this mode the TUI
 * coordinates a planner LLM that delegates implementation work to a developer
 * sub-agent and verification work to a tester sub-agent.
 *
 * @example
 * ```bash
 * npx code-agent team
 * ```
 */
export const teamCommand = new Command("team")
  .description("Start a team")
  .action((_options) => {
    const config = loadConfig();
    validateConfig(config);

    render(React.createElement(App, { config, mode: "team" }));
  });
