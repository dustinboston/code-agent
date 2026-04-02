import React from "react";
import { render } from "ink-testing-library";
import { App } from "./app.js";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { AppConfig } from "../types.js";

// Define a mock LLM class outside of vi.mock
class MockLLMInstance {
  stream = vi.fn(async function* () {});
  bindTools = vi.fn(() => new MockLLMInstance());
}

// Mock Ink hooks
vi.mock("ink", async (importOriginal) => {
  const { useApp: originalUseApp, useInput: originalUseInput, useStdout: originalUseStdout, ...rest } = await importOriginal<typeof import("ink")>();
  return {
    ...rest,
    useApp: () => ({ exit: vi.fn() }),
    useInput: vi.fn(),
    useStdout: () => ({
      write: vi.fn(),
      stdout: process.stdout,
    }),
  };
});

// Mock external dependencies
vi.mock("../retrieval/store.js", () => ({
  createVectorStore: vi.fn(() => Promise.resolve({})),
}));

// Mock LangChain chat models directly to return MockLLMInstance
vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: vi.fn(() => new MockLLMInstance()),
}));

vi.mock("@langchain/openai", () => ({
  ChatOpenAI: vi.fn(() => new MockLLMInstance()),
}));

vi.mock("@langchain/google", () => ({
  ChatGoogle: vi.fn(() => new MockLLMInstance()),
}));

// Mock the module that exports createLLM, createPlanner, etc.
vi.mock("../generation/llm.js", () => ({
  createLLM: vi.fn(() => new MockLLMInstance()),
  createPlanner: vi.fn(() => new MockLLMInstance()),
  createDeveloper: vi.fn(() => new MockLLMInstance()),
  createTester: vi.fn(() => new MockLLMInstance()),
}));

vi.mock("../generation/prompt.js", () => ({
  createChatPrompt: vi.fn(() => ({ formatMessages: vi.fn(() => []) })),
  createTeamPrompt: vi.fn(() => ({ formatMessages: vi.fn(() => []) })),
  createDeveloperPrompt: vi.fn(() => ({ formatMessages: vi.fn(() => []) })),
  createTesterPrompt: vi.fn(() => ({ formatMessages: vi.fn(() => []) })),
}));

// Mock randomUUID to ensure consistent snapshots
vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "mock-uuid"),
}));

describe("App", () => {
  let consoleErrorSpy: MockInstance<Parameters<typeof console.error>, ReturnType<typeof console.error>>;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimers();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    vi.clearAllTimers();
    consoleErrorSpy.mockRestore();
  });

  const mockConfig: AppConfig = {
    llm: {
      provider: "anthropic",
      model: "claude-3-opus-20240229",
      temperature: 0.5,
      maxTokens: 1000,
    },
    planner: {
      provider: "anthropic",
      model: "claude-3-opus-20240229",
      temperature: 0.5,
      maxTokens: 1000,
    },
    developer: {
      provider: "anthropic",
      model: "claude-3-opus-20240229",
      temperature: 0.5,
      maxTokens: 1000,
    },
    tester: {
      provider: "anthropic",
      model: "claude-3-opus-20240229",
      temperature: 0.5,
      maxTokens: 1000,
    },
    embedding: {
      provider: "openai",
      model: "text-embedding-ada-002",
      dimensions: 1536,
    },
    pinecone: {
      indexName: "test-index",
      namespace: "test-namespace",
    },
    chunking: {
      strategy: "recursive",
      chunkSize: 1000,
      chunkOverlap: 200,
    },
    retrieval: {
      topK: 4,
      scoreThreshold: 0.8,
    },
    storage: {
      dataDir: "./data",
    },
  };

  it("renders in initializing state", () => {
    const { lastFrame } = render(<App config={mockConfig} />);
    expect(lastFrame()).toMatchSnapshot();
  });

  it("renders in idle state after initialization (chat mode)", async () => {
    const { lastFrame } = render(<App config={mockConfig} mode="chat" />);

    // Flush all microtasks to allow useEffect to complete
    await new Promise(process.nextTick);
    await vi.runAllTimersAsync();

    // The component should transition to idle state
    expect(lastFrame()).toMatchSnapshot();
  });

  it("renders in error state", async () => {
    // Mock createLLM to return a rejected promise during initialization
    const { createLLM } = await import("../generation/llm.js");
    vi.mocked(createLLM).mockImplementationOnce(() => {
      throw new Error("Failed to create LLM"); // Throw synchronously
    });

    const { lastFrame } = render(<App config={mockConfig} />);

    // Flush all microtasks and timers to allow useEffect to complete and catch the error
    await new Promise(process.nextTick);
    await vi.runAllTimersAsync();

    // The component should transition to error state and display the error message
    expect(lastFrame()).toMatchSnapshot();
  });
});
