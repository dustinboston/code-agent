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
    maxTokens: 2048,
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
    scoreThreshold: 0,  // unused — all top-k results are passed to the LLM
  },
  storage: {
    dataDir: "./data",
  },
  // Interprets requirements from the user and converts them into stories.
  planner: {
    provider: "anthropic",
    model: "claude-opus-4-6", // /6/20250514/
    temperature: 0.7,
    maxTokens: 2048,    
  },
  developer: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    maxTokens: 2048
  },
  // Assumes the role of a QA Engineer
  tester: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    temperature: 0.3,
    maxTokens: 2048
  }
};

function loadFileConfig(): Partial<AppConfig> {
  const configPath = resolve("./rag-starter.config.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as Partial<AppConfig>;
  } catch {
    console.warn("Warning: could not parse rag-starter.config.json, using defaults.");
    return {};
  }
}

// Deep merge: later objects override earlier ones. Skips undefined values.
function deepMerge<T extends object>(...objects: Array<Partial<T>>): T {
  const result = {} as T;
  for (const obj of objects) {
    for (const key in obj) {
      const val = obj[key as keyof T];
      if (val !== undefined && val !== null && typeof val === "object" && !Array.isArray(val)) {
        result[key as keyof T] = deepMerge(
          ((result[key as keyof T] ?? {}) as object),
          val as object
        ) as T[keyof T];
      } else if (val !== undefined) {
        result[key as keyof T] = val as T[keyof T];
      }
    }
  }
  return result;
}

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

export function validateConfig(config: AppConfig): void {
  const missing: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!process.env.PINECONE_API_KEY) missing.push("PINECONE_API_KEY");
  if (!config.pinecone.indexName) missing.push("PINECONE_INDEX");

  if (missing.length > 0) {
    console.error(`\nMissing required environment variables:\n  ${missing.join("\n  ")}`);
    console.error("\nCopy .env.example to .env and fill in your API keys.\n");
    process.exit(1);
  }
}
