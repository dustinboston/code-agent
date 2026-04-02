import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  createLLM,
  createPlanner,
  createDeveloper,
  createTester,
} from "./llm.js";
import type { AppConfig, Provider } from "../types.js";

// Import the actual classes to get their types, Vitest will mock them
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogle } from "@langchain/google";

// Tell Vitest to mock these modules
vi.mock("@langchain/anthropic");
vi.mock("@langchain/openai");
vi.mock("@langchain/google");

const mockConfig: AppConfig = {
  llm: {
    provider: "anthropic",
    model: "claude-3-sonnet-20240229",
    temperature: 0.7,
    maxTokens: 1000,
  },
  planner: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.8,
    maxTokens: 2000,
  },
  developer: {
    provider: "google",
    model: "gemini-pro",
    temperature: 0.2,
    maxTokens: 1500,
  },
  tester: {
    provider: "anthropic",
    model: "claude-3-haiku-20240307",
    temperature: 0.1,
    maxTokens: 500,
  },
  embedding: {
    provider: "openai",
    model: "text-embedding-ada-002",
    dimensions: 1536,
  },
  pinecone: {
    indexName: "mock-index",
  },
  chunking: {
    strategy: "recursive",
    chunkSize: 1000,
    chunkOverlap: 200,
  },
  retrieval: {
    topK: 5,
    scoreThreshold: 0.7,
  },
  storage: {
    dataDir: "./data",
  },
  // Removed github and firebase as they are not part of AppConfig
};

describe("LLM Factory Functions", () => {
  // Cast the imported classes to their mocked versions
  const MockChatAnthropic = vi.mocked(ChatAnthropic);
  const MockChatOpenAI = vi.mocked(ChatOpenAI);
  const MockChatGoogle = vi.mocked(ChatGoogle);

  // Clear mocks before each test to ensure isolation
  beforeEach(() => {
    MockChatAnthropic.mockClear();
    MockChatOpenAI.mockClear();
    MockChatGoogle.mockClear();
  });

  it("createLLM should instantiate ChatAnthropic with correct options for anthropic provider", () => {
    const config = { ...mockConfig, llm: { ...mockConfig.llm, provider: "anthropic" as Provider } };
    createLLM(config);
    expect(MockChatAnthropic).toHaveBeenCalledTimes(1);
    expect(MockChatAnthropic).toHaveBeenCalledWith({
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
      streaming: true,
    });
    expect(MockChatOpenAI).not.toHaveBeenCalled();
    expect(MockChatGoogle).not.toHaveBeenCalled();
  });

  it("createLLM should instantiate ChatOpenAI with correct options for openai provider", () => {
    const config = { ...mockConfig, llm: { ...mockConfig.llm, provider: "openai" as Provider } };
    createLLM(config);
    expect(MockChatOpenAI).toHaveBeenCalledTimes(1);
    expect(MockChatOpenAI).toHaveBeenCalledWith({
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
      streaming: true,
    });
    expect(MockChatAnthropic).not.toHaveBeenCalled();
    expect(MockChatGoogle).not.toHaveBeenCalled();
  });

  it("createLLM should instantiate ChatGoogle with correct options for google provider", () => {
    const config = { ...mockConfig, llm: { ...mockConfig.llm, provider: "google" as Provider } };
    createLLM(config);
    expect(MockChatGoogle).toHaveBeenCalledTimes(1);
    expect(MockChatGoogle).toHaveBeenCalledWith({
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
      streaming: true,
    });
    expect(MockChatAnthropic).not.toHaveBeenCalled();
    expect(MockChatOpenAI).not.toHaveBeenCalled();
  });

  it("createPlanner should instantiate ChatOpenAI with correct options", () => {
    createPlanner(mockConfig);
    expect(MockChatOpenAI).toHaveBeenCalledTimes(1);
    expect(MockChatOpenAI).toHaveBeenCalledWith({
      model: mockConfig.planner.model,
      temperature: mockConfig.planner.temperature,
      maxTokens: mockConfig.planner.maxTokens,
      streaming: true,
    });
    expect(MockChatAnthropic).not.toHaveBeenCalled();
    expect(MockChatGoogle).not.toHaveBeenCalled();
  });

  it("createDeveloper should instantiate ChatGoogle with correct options", () => {
    createDeveloper(mockConfig);
    expect(MockChatGoogle).toHaveBeenCalledTimes(1);
    expect(MockChatGoogle).toHaveBeenCalledWith({
      model: mockConfig.developer.model,
      temperature: mockConfig.developer.temperature,
      maxTokens: mockConfig.developer.maxTokens,
      streaming: true,
    });
    expect(MockChatAnthropic).not.toHaveBeenCalled();
    expect(MockChatOpenAI).not.toHaveBeenCalled();
  });

  it("createTester should instantiate ChatAnthropic with correct options", () => {
    createTester(mockConfig);
    expect(MockChatAnthropic).toHaveBeenCalledTimes(1);
    expect(MockChatAnthropic).toHaveBeenCalledWith({
      model: mockConfig.tester.model,
      temperature: mockConfig.tester.temperature,
      maxTokens: mockConfig.tester.maxTokens,
      streaming: true,
    });
    expect(MockChatOpenAI).not.toHaveBeenCalled();
    expect(MockChatGoogle).not.toHaveBeenCalled();
  });
});
