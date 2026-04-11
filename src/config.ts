/**
 * @module config
 *
 * Layered configuration resolution for the Code Agent application.
 *
 * Configuration is assembled from four sources in ascending priority order:
 * 1. Built-in {@link DEFAULTS} — always present.
 * 2. `code-agent.config.json` in the working directory — optional file override.
 * 3. Environment variables — loaded via `dotenv`.
 * 4. CLI-supplied overrides passed directly to {@link loadConfig}.
 *
 * Use {@link loadConfig} to obtain a fully-merged {@link AppConfig} and
 * {@link validateConfig} to assert that all required secrets are present
 * before making any network calls.
 */
import { config as dotenvConfig } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import type { AppConfig } from "./types.js";

/**
 * Zod schema for a single agent role configuration block.
 *
 * All fields are optional so the schema can validate partial overrides from
 * the config file — defaults are applied later by the merge logic.
 */
const AgentConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google"]).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

/**
 * Zod schema for the `code-agent.config.json` file.
 *
 * Every top-level key is optional since the file only needs to override a
 * subset of the defaults.
 */
const AppConfigSchema = z.object({
  planner: AgentConfigSchema.optional(),
  developer: AgentConfigSchema.optional(),
  tester: AgentConfigSchema.optional(),
  allowedCommands: z.array(z.string()).optional(),
});

/**
 * Zod schema for a fully-resolved agent config block (all fields required).
 * Used to validate the merged result after defaults have been applied.
 */
const FullAgentConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google"]),
  model: z.string(),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().positive(),
});

/**
 * Zod schema for the fully-resolved application config (all fields required).
 */
const FullAppConfigSchema = z.object({
  planner: FullAgentConfigSchema,
  developer: FullAgentConfigSchema,
  tester: FullAgentConfigSchema,
  allowedCommands: z.array(z.string()),
});

// Load .env on import
dotenvConfig();

const CONFIG_FILE = "./code-agent.config.json";

/**
 * Default and max tokens, from Claude Code src/utils/context.ts
 *
 * ## Claude
 *
 * - `claude-opus-4-6`
 *   - Default tokens: 64_000
 *   - Upper limit: 128_000
 * - `claude-sonnet-4-6`
 *   - Default tokens = 32_000
 *   - Upper limit = 128_000
 * - `claude-opus-4-5`
 * - `claude-sonnet-4`
 * - `claude-haiku-4`
 *   - Default tokens = 32_000
 *   - Upper limit = 64_000
 *
 * ## Gemini
 * - `gemini-3.1-pro-preview`
 *   - Upper limit: 1_048_576
 *   - https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview
 * - `gemini-3.1-flash-lite-preview`
 *   - Upper limit: 1_048_576
 *   - https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview
 */
const DEFAULTS: AppConfig = {
  planner: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    temperature: 0.7,
    maxTokens: 128_000,
  },
  developer: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    maxTokens: 128_000,
  },
  // The tester agent is configured with a lower temperature to act as a QA Engineer, ensuring reproducible test generation.
  tester: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    maxTokens: 128_000,
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
function loadFileConfig(): z.infer<typeof AppConfigSchema> {
  const configPath = resolve(CONFIG_FILE);
  if (!existsSync(configPath)) return {};
  try {
    const raw: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
    return AppConfigSchema.parse(raw);
  } catch (e) {
    if (e instanceof z.ZodError) {
      console.warn("Warning: code-agent.config.json has invalid fields, using defaults.");
      for (const issue of e.issues) {
        console.warn(`  - ${issue.path.join(".")}: ${issue.message}`);
      }
    } else {
      console.warn("Warning: could not parse code-agent.config.json, using defaults.");
    }
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

  const merged = {
    planner: merge(DEFAULTS.planner, fileConfig.planner, overrides.planner),
    developer: merge(DEFAULTS.developer, fileConfig.developer, overrides.developer),
    tester: merge(DEFAULTS.tester, fileConfig.tester, overrides.tester),
    allowedCommands: overrides.allowedCommands ?? fileConfig.allowedCommands ?? DEFAULTS.allowedCommands,
  };

  return FullAppConfigSchema.parse(merged);
}

/**
 * Validates that all required environment variables and config values are
 * present.
 *
 * @param config - The fully-merged application configuration to validate.
 *
 * @remarks
 * Checks for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and If any are missing, an error
 * message is printed to `stderr` and the process exits with code `1`.
 */
export function validateConfig(config: AppConfig): void {
  const required: Set<string> = new Set();
  required.add(config.planner.provider);
  required.add(config.developer.provider);
  required.add(config.tester.provider);

  const missing: string[] = [];
  if (required.has("anthropic") && !process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (required.has("openai") && !process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (required.has("google") && !process.env.GOOGLE_API_KEY) missing.push("GOOGLE_API_KEY");

  if (missing.length > 0) {
    console.error(`\nMissing required environment variables:\n  ${missing.join("\n  ")}`);
    console.error("\nCopy .env.example to .env and fill in your API keys.\n");
    process.exit(1);
  }
}
