import { describe, it, expect, mock, spyOn, beforeEach } from 'bun:test';
import { configCommand } from './config.js';
import * as configModule from '../config.js'; // Import as namespace
import chalk from 'chalk';



describe('configCommand', () => {
  beforeEach(() => {
    // mock.restoreAll(); // Removed as it's not a function in Bun's mock API
    spyOn(console, 'log').mockImplementation(() => {});
    spyOn(process, 'exit').mockImplementation((() => {}) as any);
    configCommand.exitOverride(); // Prevent process.exit from terminating the test runner

    // Mock loadConfig directly
    spyOn(configModule, 'loadConfig').mockReturnValue({
      retrieval: { topK: 5 },
      llm: { provider: 'anthropic', model: 'claude-3-sonnet-20240229', temperature: 0, maxTokens: 2048 },
    } as any);
  });

  it('should load and print the configuration', async () => {
    await configCommand.parseAsync(['node', 'test', 'config']);

    expect(configModule.loadConfig).toHaveBeenCalledWith();
    expect(console.log).toHaveBeenCalledTimes(3);
    // The order of these expectations matters for toHaveBeenCalledWith
    expect(console.log).toHaveBeenNthCalledWith(1, chalk.bold('\nCode Agent — Configuration\n'));
    expect(console.log).toHaveBeenNthCalledWith(2, JSON.stringify({
      retrieval: { topK: 5 },
      llm: { provider: 'anthropic', model: 'claude-3-sonnet-20240229', temperature: 0, maxTokens: 2048 },
    }, null, 2));
    expect(console.log).toHaveBeenNthCalledWith(3); // Expect no arguments for the last console.log()
  });
});
