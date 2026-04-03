import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configCommand } from './config.js';
import { loadConfig } from '../config.js';
import chalk from 'chalk';

// Mock dependencies
vi.mock('../config.js', () => ({
  loadConfig: vi.fn(),
}));
vi.mock('chalk', () => ({
  default: {
    bold: vi.fn((text) => text), // Mock chalk.bold to return the text directly
  },
}));

describe('configCommand', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    configCommand.exitOverride(); // Prevent process.exit from terminating the test runner

    // Provide a default mock implementation for loadConfig
    vi.mocked(loadConfig).mockReturnValue({
      retrieval: { topK: 5 },
      llm: { provider: 'anthropic', model: 'claude-3-sonnet-20240229', temperature: 0, maxTokens: 2048 },
    } as any);
  });

  it('should load and print the configuration', async () => {
    await configCommand.parseAsync(['node', 'test', 'config']);

    expect(loadConfig).toHaveBeenCalledWith();
    expect(console.log).toHaveBeenCalledTimes(3);
    // The order of these expectations matters for toHaveBeenCalledWith
    expect(console.log).toHaveBeenNthCalledWith(1, '\nCode Agent — Configuration\n');
    expect(console.log).toHaveBeenNthCalledWith(2, JSON.stringify({
      retrieval: { topK: 5 },
      llm: { provider: 'anthropic', model: 'claude-3-sonnet-20240229', temperature: 0, maxTokens: 2048 },
    }, null, 2));
    expect(console.log).toHaveBeenNthCalledWith(3); // Expect no arguments for the last console.log()
  });
});
