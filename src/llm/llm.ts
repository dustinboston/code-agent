/**
 * @module generation/llm
 *
 * Factory functions for creating streaming-enabled LangChain LLM instances.
 *
 * Each exported function reads the relevant section of {@link AppConfig} and
 * returns a pre-configured model object that can be used directly in prompt
 * chains or agentic tool-use loops. Streaming is always enabled so the TUI
 * can render tokens incrementally as they arrive.
 */
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogle } from "@langchain/google";
import type { AppConfig, Provider } from "../types.js";

/**
 * Internal helper that instantiates the correct LangChain chat model class
 * based on the given provider.
 *
 * @param provider - The LLM provider to use. Defaults to Anthropic when
 *   `undefined`.
 * @param model - The model identifier string (e.g. `"claude-sonnet-4-6"`).
 * @param temperature - Sampling temperature controlling output randomness.
 * @param maxTokens - Maximum number of tokens the model may generate.
 * @returns A streaming-enabled {@link ChatAnthropic}, {@link ChatOpenAI}, or {@link ChatGoogle}
 *   instance.
 */
function createInstance(provider: Provider | undefined, model: string, temperature: number, maxTokens?: number) {
  const opts = { model, temperature, maxTokens, streaming: true } as const;
  if (provider === "openai") return new ChatOpenAI(opts);
  if (provider === "google") return new ChatGoogle(opts);
  return new ChatAnthropic(opts);
}

/**
 * Creates a streaming-enabled LLM instance for the planner agent.
 *
 * The planner interprets user requirements, coordinates sub-agents, and
 * synthesises their results. It is typically configured with a more capable
 * model and a higher temperature than the developer or tester.
 *
 * @param config - The fully-resolved application configuration.
 * @returns A configured LLM instance using the `config.planner` settings.
 */
export function createPlanner(config: AppConfig) {
  return createInstance(config.planner.provider, config.planner.model, config.planner.temperature, config.planner.maxTokens);
}

/**
 * Creates a streaming-enabled LLM instance for the developer sub-agent.
 *
 * The developer receives implementation specifications from the planner and
 * uses filesystem tools to read and write source files.
 *
 * @param config - The fully-resolved application configuration.
 * @returns A configured LLM instance using the `config.developer` settings.
 */
export function createDeveloper(config: AppConfig) {
  return createInstance(config.developer.provider, config.developer.model, config.developer.temperature, config.developer.maxTokens);
}

/**
 * Creates a streaming-enabled LLM instance for the tester sub-agent.
 *
 * The tester verifies developer output by writing and executing tests, and
 * running typechecks. It is configured with a low temperature for
 * deterministic, reproducible test generation.
 *
 * @param config - The fully-resolved application configuration.
 * @returns A configured LLM instance using the `config.tester` settings.
 */
export function createTester(config: AppConfig) {
  return createInstance(config.tester.provider, config.tester.model, config.tester.temperature, config.tester.maxTokens);
}
