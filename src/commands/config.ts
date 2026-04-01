import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";

export const configCommand = new Command("config")
  .description("Show the current configuration")
  .action(() => {
    const config = loadConfig();
    console.log(chalk.bold("\nRAG Starter — Configuration\n"));
    console.log(JSON.stringify(config, null, 2));
    console.log();
  });
