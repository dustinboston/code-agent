import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "fs";
import { resolve, join } from "path";
import { loadConfig } from "../config.js";
import type { IngestedDocument } from "../types.js";
import { Pinecone } from "@pinecone-database/pinecone";

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
  .description("Clear all ingested documents and their Pinecone vectors")
  .action(async () => {
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

    // Delete Pinecone vectors before removing local files
    let pineconeCleared = false;
    try {
      const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
      const index = pinecone.index(config.pinecone.indexName);

      if (config.pinecone.namespace) {
        await index.namespace(config.pinecone.namespace).deleteAll();
      } else {
        await index.deleteAll();
      }

      pineconeCleared = true;
    } catch (err) {
      console.warn(
        chalk.yellow(
          `\n  Warning: Pinecone vectors could not be deleted: ${(err as Error).message}`
        )
      );
    }

    // Delete local document records
    for (const file of files) {
      unlinkSync(join(docsDir, file));
    }

    if (pineconeCleared) {
      console.log(
        `\n  ${chalk.green("✔")} Cleared ${files.length} document record${files.length !== 1 ? "s" : ""} and removed vectors from Pinecone.\n`
      );
    } else {
      console.log(
        `\n  ${chalk.green("✔")} Cleared ${files.length} local document record${files.length !== 1 ? "s" : ""}.\n`
      );
    }
  });

export const storeCommand = new Command("store")
  .description("Manage the local document registry")
  .addCommand(listCommand)
  .addCommand(clearCommand);
