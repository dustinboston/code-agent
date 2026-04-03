#!/usr/bin/env node
/**
 * @module index
 *
 * CLI entry point for the Code Agent application.
 *
 * Registers all sub-commands (`ingest`, `team`, `config`, `store`)
 * with Commander and delegates argument parsing to the framework.
 * The default action (no sub-command) launches team mode.
 */
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { loadConfig, validateConfig } from "./config.js";
import { App } from "./tui/app.js";
import { ingestCommand } from "./commands/ingest.js";
import { configCommand } from "./commands/config.js";
import { storeCommand } from "./commands/store.js";

/**
 * Root Commander program instance.
 *
 * All sub-commands are attached to this object before `program.parse()` is
 * called, which hands control to Commander for argument dispatching.
 */
const program = new Command();

program
  .name("code-agent")
  .description("AI code editing assistant")
  .version("0.1.0")
  .action(() => {
    const config = loadConfig();
    validateConfig(config);
    render(React.createElement(App, { config }));
  });

program.addCommand(ingestCommand);
program.addCommand(configCommand);
program.addCommand(storeCommand);

program.parse();
