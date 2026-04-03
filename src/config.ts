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
 * Recursively merges two or more partial objects into a single object.
 *
 * Plain objects are merged depth-first so that nested keys from later
 * arguments override only the specific sub-keys they define, rather than
 * replacing the entire nested object. Arrays and primitive values are
 * replaced wholesale. `undefined` values are skipped so that absent CLI
 * flags do not clobber file or default values.
 *
 * @param objects - One or more partial objects to merge, in ascending
 *   priority order (rightmost wins).
 * @returns A new object containing the deep-merged result.
 */
// Deep merge: later objects override earlier ones. Skips undefined values.
function deepMerge<T extends object>(...objects: Array<Partial<T>>): T {
  const result = {} as T;
  for (const obj of objects) {
    for (const key in obj) {
      const val = obj[key as keyof T];
      if (val !== undefined && val !== null && typeof val === "object" && !Array.isArray(val)) {
        result[key as keyof T] = deepMerge((result[key as keyof T] ?? {}) as object, val as object) as T[keyof T];
      } else if (val !== undefined) {
        result[key as keyof T] = val as T[keyof T];
      }
    }
  }
  return result;
}

/**
 * Resolves the application configuration by merging all config sources.
 *
 * Sources are applied in the following priority order (lowest → highest):
 * built-in defaults → `code-agent.config.json` → environment variables →
 * the `overrides` argument.
 *
 * @param overrides - Optional partial config supplied by CLI flags or tests.
 *   Any keys provided here take precedence over all other sources.
 * @returns A fully-populated {@link AppConfig} ready for use by the rest of
 *   the application.
 */
// Resolve config: defaults → config file → env vars → CLI overrides
export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const fileConfig = loadFileConfig();

  // Re-read PINECONE_INDEX from env in case dotenv just loaded it
  const envConfig: Partial<AppConfig> = {
    pinecone: {
      indexName: process.env.PINECONE_INDEX ?? DEFAULTS.pinecone.indexName,
    },
  };

  return deepMerge(DEFAULTS, fileConfig, envConfig, overrides);
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
