/// <reference types="vitest/globals" />
import { startApp } from './app';
import { createInterface } from 'readline/promises'; // Import createInterface directly
import { stdin, stdout } from 'process';
import { createVectorStore } from '../retrieval/store';
import { createDeveloper, createPlanner, createTester } from '../generation/llm';
import { createPlannerPrompt } from '../generation/prompt';
import { vi, expect, type Mock } from 'vitest'; // Import type Mock
import { processSlashCommand, SlashCommandCallbacks } from './commands';
import { AppConfig, Provider } from '../types';

// Mock external dependencies
vi.mock('readline/promises'); // Keep mocking the module
vi.mock('../retrieval/store');
vi.mock('../generation/llm');
vi.mock('../generation/prompt');
vi.mock('./commands'); // Mock processSlashCommand

describe('startApp', () => {
  const mockConfig: AppConfig = {
    llm: { provider: "anthropic", model: 'test-llm-model', temperature: 0.7, maxTokens: 1000 },
    planner: { provider: "anthropic", model: 'test-planner-model', temperature: 0.7, maxTokens: 1000 },
    developer: { provider: "anthropic", model: 'test-developer-model', temperature: 0.7, maxTokens: 1000 },
    tester: { provider: "anthropic", model: 'test-tester-model', temperature: 0.7, maxTokens: 1000 },
    embedding: { provider: 'openai', model: 'text-embedding-ada-002', dimensions: 1536 },
    pinecone: { indexName: 'test-index' },
    chunking: { strategy: 'recursive', chunkSize: 1000, chunkOverlap: 200, batchSize: 50 },
    retrieval: { topK: 5, scoreThreshold: 0.8 },
    storage: { dataDir: './data' },
  };

  let originalProcessExit: (code?: number) => never;
  let originalStdoutWrite: (chunk: any, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => boolean;

  beforeEach(() => {
    vi.clearAllMocks();
    originalProcessExit = process.exit;
    (process as any).exit = vi.fn();

    originalStdoutWrite = stdout.write;
    (stdout as any).write = vi.fn((chunk: any, cb?: (err?: Error | null) => void) => {
      if (cb) cb(null);
      return true;
    });

    // Now createInterface should be a mock function directly
    (createInterface as Mock).mockReturnValue({
      question: vi.fn(() => Promise.resolve('/quit')),
      close: vi.fn(),
      // Add the 'on' method to the mock
      on: vi.fn((event, handler) => {
        if (event === 'SIGINT') {
          // Simulate SIGINT by calling the handler, which should exit the process
          handler();
        }
      }),
    });

    (createVectorStore as Mock).mockResolvedValue({});
    (createPlanner as Mock).mockReturnValue({});
    (createDeveloper as Mock).mockReturnValue({});
    (createTester as Mock).mockReturnValue({});
    (createPlannerPrompt as Mock).mockReturnValue({});

    (processSlashCommand as Mock<[string, AppConfig, SlashCommandCallbacks], Promise<void>>).mockImplementation(async (command, config, callbacks) => {
      if (command === '/quit') {
        callbacks.exit();
      }
    });
  });

  afterEach(() => {
    process.exit = originalProcessExit;
    (stdout as any).write = originalStdoutWrite;
  });

  it('should initialize and exit gracefully with /quit command', async () => {
    await startApp(mockConfig);

    expect(createInterface).toHaveBeenCalledWith({ input: stdin, output: stdout }); // Use createInterface directly

    expect(createVectorStore).toHaveBeenCalledWith(mockConfig);
    expect(createPlanner).toHaveBeenCalledWith(mockConfig);
    expect(createDeveloper).toHaveBeenCalledWith(mockConfig);
    expect(createTester).toHaveBeenCalledWith(mockConfig);
    expect(createPlannerPrompt).toHaveBeenCalled();

    const mockRl = (createInterface as Mock).mock.results[0].value; // Use createInterface directly
    expect(mockRl.question).toHaveBeenCalled();
    expect(mockRl.close).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
