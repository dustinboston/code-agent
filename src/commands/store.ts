import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "fs";
import { resolve, join } from "path";
import { loadConfig } from "../config.js";
import type { IngestedDocument } from "../types.js";

const listCommand = new Command("list")
  .description("List documents that have been ingested")
  .action(() => {
    const config = loadConfig();
    const docsDir = resolve(config.storage.dataDir, "documents");

    if (!existsSync(docsDir)) {
      console.log("\nNo documents ingested yet.\n");
      return;
    }

    const files = readdirSync(docsDir).filter((f) => f.endsWith(".json"));

    if (files.length === 0) {
      console.log("\nNo documents ingested yet.\n");
      return;
    }

    console.log(chalk.bold(`\n${files.length} document${files.length !== 1 ? "s" : ""} in registry:\n`));

    for (const file of files) {
      const doc = JSON.parse(
        readFileSync(join(docsDir, file), "utf-8")
      ) as IngestedDocument;

      console.log(`  ${chalk.cyan(doc.source)}`);
      console.log(
        `    ${doc.chunkCount} chunks · ${doc.format.toUpperCase()} · ` +
          `ingested ${new Date(doc.ingestedAt).toLocaleString()}`
      );
    }
    console.log();
  });

const clearCommand = new Command("clear")
  .description("Remove local document records (does NOT delete Pinecone vectors)")
  .action(() => {
    const config = loadConfig();
    const docsDir = resolve(config.storage.dataDir, "documents");

    if (!existsSync(docsDir)) {
      console.log("\nNothing to clear.\n");
      return;
    }

    const files = readdirSync(docsDir).filter((f) => f.endsWith(".json"));

    if (files.length === 0) {
      console.log("\nNothing to clear.\n");
      return;
    }

    for (const file of files) {
      unlinkSync(join(docsDir, file));
    }

    console.log(
      `\n  ${chalk.green("✔")} Cleared ${files.length} document record${files.length !== 1 ? "s" : ""}.\n` +
        `  ${chalk.yellow("Note:")} Pinecone vectors were not deleted.\n` +
        `  To clear vectors, use the Pinecone dashboard or API.\n`
    );
  });

export const storeCommand = new Command("store")
  .description("Manage the local document registry")
  .addCommand(listCommand)
  .addCommand(clearCommand);
