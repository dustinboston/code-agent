import { describe, it, expect, beforeEach, mock, Mock } from "bun:test";
import { createPlanner, createDeveloper, createTester } from "./llm.js";
import type { AppConfig, Provider } from "../types.js";

// Import the actual classes to get their types, Bun will mock them
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogle } from "@langchain/google";

let mockChatAnthropicConstructor: Mock<any>;
let mockChatOpenAIConstructor: Mock<any>;
let mockChatGoogleConstructor: Mock<any>;

// Tell Bun to mock these modules and provide our mock constructors
mock.module("@langchain/anthropic", () => ({
  ChatAnthropic: (mockChatAnthropicConstructor = mock(() => {})),
}));
mock.module("@langchain/openai", () => ({
  ChatOpenAI: (mockChatOpenAIConstructor = mock(() => {})),
}));
mock.module("@langchain/google", () => ({
  ChatGoogle: (mockChatGoogleConstructor = mock(() => {})),
}));

const mockConfig: AppConfig = {
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
  allowedCommands: [],
};

describe("LLM Factory Functions", () => {
  // Clear mocks before each test to ensure isolation
  beforeEach(() => {
    // Manually create mock functions for the constructors
    // These are now initialized in mock.module, so just clear them
    mockChatAnthropicConstructor.mockClear();
    mockChatOpenAIConstructor.mockClear();
    mockChatGoogleConstructor.mockClear();
  });

  it("createPlanner should instantiate ChatOpenAI with correct options", () => {
    createPlanner(mockConfig);
    expect(mockChatOpenAIConstructor).toHaveBeenCalledTimes(1);
    expect(mockChatOpenAIConstructor).toHaveBeenCalledWith({
      model: mockConfig.planner.model,
      temperature: mockConfig.planner.temperature,
      maxTokens: mockConfig.planner.maxTokens,
      streaming: true,
    });
    expect(mockChatAnthropicConstructor).not.toHaveBeenCalled();
    expect(mockChatGoogleConstructor).not.toHaveBeenCalled();
  });

  it("createDeveloper should instantiate ChatGoogle with correct options", () => {
    createDeveloper(mockConfig);
    expect(mockChatGoogleConstructor).toHaveBeenCalledTimes(1);
    expect(mockChatGoogleConstructor).toHaveBeenCalledWith({
      model: mockConfig.developer.model,
      temperature: mockConfig.developer.temperature,
      maxTokens: mockConfig.developer.maxTokens,
      streaming: true,
    });
    expect(mockChatAnthropicConstructor).not.toHaveBeenCalled();
    expect(mockChatOpenAIConstructor).not.toHaveBeenCalled();
  });

  it("createTester should instantiate ChatAnthropic with correct options", () => {
    createTester(mockConfig);
    expect(mockChatAnthropicConstructor).toHaveBeenCalledTimes(1);
    expect(mockChatAnthropicConstructor).toHaveBeenCalledWith({
      model: mockConfig.tester.model,
      temperature: mockConfig.tester.temperature,
      maxTokens: mockConfig.tester.maxTokens,
      streaming: true,
    });
    expect(mockChatOpenAIConstructor).not.toHaveBeenCalled();
    expect(mockChatGoogleConstructor).not.toHaveBeenCalled();
  });
});
