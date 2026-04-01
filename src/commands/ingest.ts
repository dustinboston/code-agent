import { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "fs";
import { resolve } from "path";
import { loadConfig, validateConfig } from "../config.js";
import { ingestFile } from "../ingest/pipeline.js";
import type { AppConfig } from "../types.js";

export const ingestCommand = new Command("ingest")
  .description("Ingest a file into the Pinecone knowledge base")
  .argument("<path>", "Path to file (PDF, TXT, or MD)")
  .option("--chunk-size <n>", "Chunk size in characters (default: 1000)", parseInt)
  .option("--chunk-overlap <n>", "Chunk overlap in characters (default: 200)", parseInt)
  .action(async (filePath: string, options) => {
    const overrides: Partial<AppConfig> = {};
    if (options.chunkSize !== undefined || options.chunkOverlap !== undefined) {
      overrides.chunking = {
        strategy: "recursive",
        chunkSize: options.chunkSize,
        chunkOverlap: options.chunkOverlap,
      };
    }

    const config = loadConfig(overrides);
    validateConfig(config);

    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) {
      console.error(chalk.red(`\n✖  File not found: ${resolvedPath}\n`));
      process.exit(1);
    }

    console.log(chalk.bold("\nRAG Starter — Ingestion\n"));

    let lastMsg = "";
    const clearLine = () => {
      if (lastMsg) process.stdout.write("\r" + " ".repeat(lastMsg.length + 4) + "\r");
    };

    try {
      const result = await ingestFile(resolvedPath, config, (msg) => {
        clearLine();
        lastMsg = msg;
        process.stdout.write(`  ${chalk.cyan("→")} ${msg}`);
      });
      clearLine();
      console.log(`  ${chalk.green("✔")} ${chalk.bold(result.source)}`);
      console.log(`     ${result.chunkCount} chunks embedded`);
      console.log(`     Pinecone index: ${chalk.bold(config.pinecone.indexName)}`);
      if (config.pinecone.namespace) {
        console.log(`     Namespace: ${chalk.bold(config.pinecone.namespace)}`);
      }
      console.log();
    } catch (err) {
      clearLine();
      console.error(
        `\n  ${chalk.red("✖")} Ingestion failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(1);
    }
  });
