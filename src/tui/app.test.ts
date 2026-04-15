import {createInterface} from 'node:readline/promises';
import {stdin, stdout} from 'node:process';
import {expect, mock, beforeEach, afterEach, describe, it} from 'bun:test';
import type {AppConfig} from '../types';
import {startApp} from './app.js';

const mockQuestion = mock(async () => '/quit');

void mock.module('readline/promises', () => ({
  createInterface: mock(() => ({
    question: mockQuestion,
    close: mock(),
    on: mock(),
    off: mock(),
  })),
}));

const mockCreateCodeAgent = mock(async () => ({}));

void mock.module('../llm/darunner', () => ({
  createCodeAgent: mockCreateCodeAgent,
  runCodeAgent: mock(async () => ''),
}));

describe('startApp', () => {
  const mockConfig: AppConfig = {
    planner: {provider: 'anthropic', model: 'test-planner-model', temperature: 0.7, maxTokens: 1000},
    developer: {provider: 'anthropic', model: 'test-developer-model', temperature: 0.7, maxTokens: 1000},
    tester: {provider: 'anthropic', model: 'test-tester-model', temperature: 0.7, maxTokens: 1000},
    allowedCommands: [],
  };

  let originalStdoutWrite: typeof stdout.write;

  beforeEach(() => {
    originalStdoutWrite = stdout.write;
    Object.defineProperty(stdout, 'write', {
      value: mock((_chunk: string) => true),
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(stdout, 'write', {
      value: originalStdoutWrite,
      writable: true,
      configurable: true,
    });
  });

  it('should initialize and exit gracefully with /quit command', async () => {
    await startApp(mockConfig);

    expect(createInterface).toHaveBeenCalledWith({
      input: stdin,
      output: stdout,
      terminal: stdin.isTTY ?? false,
      historySize: 1000,
    });

    expect(mockCreateCodeAgent).toHaveBeenCalled();
    expect(mockQuestion).toHaveBeenCalled();
  });
});
