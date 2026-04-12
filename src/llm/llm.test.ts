import {describe, it, expect, beforeEach, mock} from 'bun:test';
import type {AppConfig} from '../types.js';
import {createPlanner, createDeveloper, createTester} from './llm.js';

const mockChatAnthropicConstructor = mock(() => undefined);
const mockChatOpenAiConstructor = mock(() => undefined);
const mockChatGoogleConstructor = mock(() => undefined);

void mock.module('@langchain/anthropic', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- class name from module API
  ChatAnthropic: mockChatAnthropicConstructor,
}));
void mock.module('@langchain/openai', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- class name from module API
  ChatOpenAI: mockChatOpenAiConstructor,
}));
void mock.module('@langchain/google', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- class name from module API
  ChatGoogle: mockChatGoogleConstructor,
}));

const mockConfig: AppConfig = {
  planner: {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.8,
    maxTokens: 2000,
  },
  developer: {
    provider: 'google',
    model: 'gemini-pro',
    temperature: 0.2,
    maxTokens: 1500,
  },
  tester: {
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    temperature: 0.1,
    maxTokens: 500,
  },
  allowedCommands: [],
};

describe('LLM Factory Functions', () => {
  beforeEach(() => {
    mockChatAnthropicConstructor.mockClear();
    mockChatOpenAiConstructor.mockClear();
    mockChatGoogleConstructor.mockClear();
  });

  it('createPlanner should instantiate ChatOpenAI with correct options', () => {
    createPlanner(mockConfig);
    expect(mockChatOpenAiConstructor).toHaveBeenCalledTimes(1);
    expect(mockChatOpenAiConstructor).toHaveBeenCalledWith({
      model: mockConfig.planner.model,
      temperature: mockConfig.planner.temperature,
      maxTokens: mockConfig.planner.maxTokens,
      streaming: true,
    });
    expect(mockChatAnthropicConstructor).not.toHaveBeenCalled();
    expect(mockChatGoogleConstructor).not.toHaveBeenCalled();
  });

  it('createDeveloper should instantiate ChatGoogle with correct options', () => {
    createDeveloper(mockConfig);
    expect(mockChatGoogleConstructor).toHaveBeenCalledTimes(1);
    expect(mockChatGoogleConstructor).toHaveBeenCalledWith({
      model: mockConfig.developer.model,
      temperature: mockConfig.developer.temperature,
      maxTokens: mockConfig.developer.maxTokens,
      streaming: true,
    });
    expect(mockChatAnthropicConstructor).not.toHaveBeenCalled();
    expect(mockChatOpenAiConstructor).not.toHaveBeenCalled();
  });

  it('createTester should instantiate ChatAnthropic with correct options', () => {
    createTester(mockConfig);
    expect(mockChatAnthropicConstructor).toHaveBeenCalledTimes(1);
    expect(mockChatAnthropicConstructor).toHaveBeenCalledWith({
      model: mockConfig.tester.model,
      temperature: mockConfig.tester.temperature,
      maxTokens: mockConfig.tester.maxTokens,
      streaming: true,
    });
    expect(mockChatOpenAiConstructor).not.toHaveBeenCalled();
    expect(mockChatGoogleConstructor).not.toHaveBeenCalled();
  });
});
