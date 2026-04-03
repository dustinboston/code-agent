/**
 * @module commands/store
 *
 * Defines the `store` CLI sub-command group, which exposes two sub-commands
 * for managing the local document registry:
 * - `store list` — display all ingested documents.
 * - `store clear` — delete all local records and their Pinecone vectors.
 */
import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readdirSync, unlinkSync } from "fs";
import { readFile } from "fs/promises";
import { resolve, join } from "path";
import { loadConfig } from "../config.js";
import type { IngestedDocument } from "../types.js";
import { Pinecone } from "@pinecone-database/pinecone";

/**
 * Commander command that lists all documents currently in the local registry.
 *
 * @remarks
 * Reads JSON metadata files from `<dataDir>/documents/` and prints a
 * human-readable summary (source path, chunk count, format, ingest time) for
 * each one. If no documents have been ingested yet, a friendly message is
 * shown instead.
 *
 * @example
 * ```bash
 * npx code-agent store list
 * ```
 */
const listCommand = new Command("list")
  .description("List documents that have been ingested")
  .action(async () => {
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

    const docs = await Promise.all(
      files.map(async (file) => JSON.parse(await readFile(join(docsDir, file), "utf-8")) as IngestedDocument)
    );

    for (const doc of docs) {
      console.log(`  ${chalk.cyan(doc.source)}`);
      console.log(
        `    ${doc.chunkCount} chunks · ${doc.format.toUpperCase()} · ` +
          `ingested ${new Date(doc.ingestedAt).toLocaleString()}`
      );
    }
    console.log();
  });

/**
 * Commander command that removes all ingested documents from both Pinecone
 * and the local registry.
 *
 * @remarks
 * First attempts to delete all vectors from the configured Pinecone index
 * (or namespace, if one is set). Then deletes every JSON metadata file from
 * `<dataDir>/documents/`. If the Pinecone deletion fails, a warning is
 * printed but the local files are still removed. Exits cleanly if there is
 * nothing to clear.
 *
 * @example
 * ```bash
 * npx code-agent store clear
 * ```
 */
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

/**
 * Commander command group that aggregates the `list` and `clear` sub-commands
 * under the `store` namespace.
 *
 * @example
 * ```bash
 * npx code-agent store list
 * npx code-agent store clear
 * ```
 */
export const storeCommand = new Command("store")
  .description("Manage the local document registry")
  .addCommand(listCommand)
  .addCommand(clearCommand);
