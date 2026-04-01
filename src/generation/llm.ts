import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { AppConfig, Provider } from "../types.js";

function createInstance(provider: Provider | undefined, model: string, temperature: number, maxTokens?: number) {
  const opts = { model, temperature, maxTokens, streaming: true } as const;
  if (provider === "openai") return new ChatOpenAI(opts);
  return new ChatAnthropic(opts);
}

// Creates a streaming-enabled LLM instance.
// Streaming is set at construction time; the TUI consumes the async iterator
// returned by llm.stream(messages) to render tokens as they arrive.
export function createLLM(config: AppConfig) {
  return createInstance(config.llm.provider, config.llm.model, config.llm.temperature, config.llm.maxTokens);
}

export function createPlanner(config: AppConfig) {
  return createInstance(config.planner.provider, config.planner.model, config.planner.temperature, config.planner.maxTokens);
}

export function createDeveloper(config: AppConfig) {
  return createInstance(config.developer.provider, config.developer.model, config.developer.temperature, config.developer.maxTokens);
}

export function createTester(config: AppConfig) {
  return createInstance(config.tester.provider, config.tester.model, config.tester.temperature, config.tester.maxTokens);
}
