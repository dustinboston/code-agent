/**
 * @module commands/config
 *
 * Defines the `config` CLI sub-command, which prints the fully-resolved
 * application configuration to stdout so users can verify their setup without
 * starting a chat session.
 */
import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";

/**
 * Commander command that displays the current application configuration.
 *
 * @remarks
 * Calls {@link loadConfig} with no overrides so the output reflects exactly
 * what the application would use at runtime (defaults → config file → env
 * vars). The result is pretty-printed as JSON.
 *
 * @example
 * ```bash
 * npx code-agent config
 * ```
 */
export const configCommand = new Command("config")
  .description("Show the current configuration")
  .action(() => {
    const config = loadConfig();
    console.log(chalk.bold("\nRAG Starter — Configuration\n"));
    console.log(JSON.stringify(config, null, 2));
    console.log();
  });
