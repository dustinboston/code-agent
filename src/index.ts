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
import packageJson from "../package.json" with { type: "json" };
import { loadConfig, validateConfig } from "./config.js";
import { Command } from "commander";

const version = packageJson.version;

console.log(`Code Agent ${version}`);

// Dynamic imports defer heavy LangChain module loading until after the banner prints.

const { ingestCommand } = await import("./commands/ingest.js");
const { configCommand } = await import("./commands/config.js");
const { storeCommand } = await import("./commands/store.js");

/**
 * Root Commander program instance.
 *
 * All sub-commands are attached to this object before `program.parse()` is
 * called, which hands control to Commander for argument dispatching.
 */
const program = new Command();

program
  .name("code-agent")
  .description("AI code editing team")
  .version(version)
  .action(async () => {
    const { startApp } = await import("./tui/app.js");
    
    const config = loadConfig();
    validateConfig(config);
    startApp(config);
  });

program.addCommand(ingestCommand);
program.addCommand(configCommand);
program.addCommand(storeCommand);

program.parse();
