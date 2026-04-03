/**
 * @module config
 *
 * Layered configuration resolution for the Code Agent application.
 *
 * Configuration is assembled from four sources in ascending priority order:
 * 1. Built-in {@link DEFAULTS} — always present.
 * 2. `code-agent.config.json` in the working directory — optional file override.
 * 3. Environment variables (e.g. `PINECONE_INDEX`) — loaded via `dotenv`.
 * 4. CLI-supplied overrides passed directly to {@link loadConfig}.
 *
 * Use {@link loadConfig} to obtain a fully-merged {@link AppConfig} and
 * {@link validateConfig} to assert that all required secrets are present
 * before making any network calls.
 */
import { config as dotenvConfig } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { AppConfig } from "./types.js";

// Load .env on import
dotenvConfig();

const DEFAULTS: AppConfig = {
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-6", // /6/20250514/
    temperature: 0.7,
    maxTokens: 8192,
  },
  embedding: {
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 512,
  },
  pinecone: {
    indexName: process.env.PINECONE_INDEX ?? "",
  },
  chunking: {
    strategy: "recursive",
    chunkSize: 1000,
    chunkOverlap: 200,
    batchSize: 50,
  },
  retrieval: {
    topK: 8,
    scoreThreshold: 0, // unused — all top-k results are passed to the LLM
  },
  storage: {
    dataDir: "./data",
  },
  planner: {
    provider: "anthropic",
    model: "claude-opus-4-6",
    temperature: 0.7,
    maxTokens: 8192,
  },
  developer: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    maxTokens: 8192,
  },
  // Assumes the role of a QA Engineer
  tester: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    maxTokens: 8192,
  },
};

/**
 * Attempts to read and parse `code-agent.config.json` from the current
 * working directory.
 *
 * Returns an empty object when the file does not exist or cannot be parsed,
 * so callers can always safely spread the result into the merge chain.
 *
 * @returns A partial {@link AppConfig} containing only the fields present in
 *   the JSON file, or `{}` if the file is absent or malformed.
 */
function loadFileConfig(): Partial<AppConfig> {
  const configPath = resolve("./code-agent.config.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as Partial<AppConfig>;
  } catch {
    console.warn("Warning: could not parse code-agent.config.json, using defaults.");
    return {};
  }
}

/**
 * Resolves the application configuration by merging all config sources.
 *
 * Sources are applied in the following priority order (lowest → highest):
 * built-in defaults → `code-agent.config.json` → environment variables →
 * the `overrides` argument.
 *
 * Each top-level section is merged with a shallow `Object.assign` — the
 * config shape has no deeply-nested keys that require recursive merging.
 *
 * @param overrides - Optional partial config supplied by CLI flags or tests.
 *   Any keys provided here take precedence over all other sources.
 * @returns A fully-populated {@link AppConfig} ready for use by the rest of
 *   the application.
 */
// Resolve config: defaults → config file → env vars → CLI overrides
export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const fileConfig = loadFileConfig();
  const merge = <T extends object>(base: T, ...layers: Array<Partial<T> | undefined>): T =>
    Object.assign({}, base, ...layers);

  return {
    llm:       merge(DEFAULTS.llm,       fileConfig.llm,       overrides.llm),
    embedding: merge(DEFAULTS.embedding, fileConfig.embedding, overrides.embedding),
    pinecone:  merge(DEFAULTS.pinecone,  fileConfig.pinecone,  { indexName: process.env.PINECONE_INDEX ?? DEFAULTS.pinecone.indexName }, overrides.pinecone),
    chunking:  merge(DEFAULTS.chunking,  fileConfig.chunking,  overrides.chunking),
    retrieval: merge(DEFAULTS.retrieval, fileConfig.retrieval, overrides.retrieval),
    storage:   merge(DEFAULTS.storage,   fileConfig.storage,   overrides.storage),
    planner:   merge(DEFAULTS.planner,   fileConfig.planner,   overrides.planner),
    developer: merge(DEFAULTS.developer, fileConfig.developer, overrides.developer),
    tester:    merge(DEFAULTS.tester,    fileConfig.tester,    overrides.tester),
  };
}

/**
 * Validates that all required environment variables and config values are
 * present.
 *
 * @param config - The fully-merged application configuration to validate.
 *
 * @remarks
 * Checks for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PINECONE_API_KEY`, and
 * a non-empty `config.pinecone.indexName`. If any are missing, an error
 * message is printed to `stderr` and the process exits with code `1`.
 */
export function validateConfig(config: AppConfig): void {
  const missing: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!process.env.GOOGLE_API_KEY) missing.push("GOOGLE_API_KEY");
  if (!process.env.PINECONE_API_KEY) missing.push("PINECONE_API_KEY");
  if (!config.pinecone.indexName) missing.push("PINECONE_INDEX");

  if (missing.length > 0) {
    console.error(`\nMissing required environment variables:\n  ${missing.join("\n  ")}`);
    console.error("\nCopy .env.example to .env and fill in your API keys.\n");
    process.exit(1);
  }
}
