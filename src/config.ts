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
  // The tester agent is configured with a lower temperature to act as a QA Engineer, ensuring reproducible test generation.
  tester: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    maxTokens: 8192,
  },
  allowedCommands: [],
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
export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const fileConfig = loadFileConfig();
  const merge = <T extends object>(base: T, ...layers: Array<Partial<T> | undefined>): T =>
    Object.assign({}, base, ...layers);

  return {
    planner: merge(DEFAULTS.planner, fileConfig.planner, overrides.planner),
    developer: merge(DEFAULTS.developer, fileConfig.developer, overrides.developer),
    tester: merge(DEFAULTS.tester, fileConfig.tester, overrides.tester),
    allowedCommands: overrides.allowedCommands ?? fileConfig.allowedCommands ?? DEFAULTS.allowedCommands,
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

  if (missing.length > 0) {
    console.error(`\nMissing required environment variables:\n  ${missing.join("\n  ")}`);
    console.error("\nCopy .env.example to .env and fill in your API keys.\n");
    process.exit(1);
  }
}
