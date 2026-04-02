
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { teamCommand } from './team';
import * as config from '../config';
import { render } from 'ink';
import React from 'react';
import { App } from '../tui/app';

vi.mock('../config');
vi.mock('ink');
vi.mock('../tui/app', () => ({
  App: vi.fn(),
}));

describe('team command', () => {
  const mockConfig = {
    llm: {
      model: 'mock-model',
      temperature: 0.7,
    },
    pinecone: {
      apiKey: 'mock-api-key',
      indexName: 'mock-index',
    },
    storage: {
      dataDir: 'mock-data-dir',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(config, 'loadConfig').mockReturnValue(mockConfig as any);
    vi.spyOn(config, 'validateConfig').mockReturnValue(undefined);
    vi.mocked(render).mockReturnValue({ waitUntilExit: vi.fn().mockResolvedValue(undefined) } as any);
  });

  it('should load config, validate it, and render the App component in team mode', async () => {
    await teamCommand.parseAsync(['node', 'test', 'team']);

    expect(config.loadConfig).toHaveBeenCalled();
    expect(config.validateConfig).toHaveBeenCalledWith(mockConfig);
    expect(render).toHaveBeenCalledWith(React.createElement(App, { config: mockConfig as any, mode: 'team' }));
  });
});
