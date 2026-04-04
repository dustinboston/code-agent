import { startApp } from "./app";
import { createInterface } from "readline/promises"; // Import createInterface directly
import { stdin, stdout } from "process";
import { createDeveloper, createPlanner, createTester } from "../generation/llm";
import { createPlannerPrompt } from "../generation/prompt";
import { expect, mock, Mock, beforeEach, afterEach, spyOn, describe, it } from "bun:test";
import { processSlashCommand, SlashCommandCallbacks } from "./commands";
import { AppConfig, Provider } from "../types";

// Mock external dependencies
mock.module("readline/promises", () => ({
  createInterface: mock(() => ({
    question: mock(() => Promise.resolve("/quit")),
    close: mock(),
    on: mock(),
  })),
}));
mock.module("../retrieval/store", () => ({
  createVectorStore: mock(() => ({})),
}));
mock.module("../generation/llm", () => ({
  createDeveloper: mock(() => ({})),
  createPlanner: mock(() => ({})),
  createTester: mock(() => ({})),
}));
mock.module("../generation/prompt", () => ({
  createPlannerPrompt: mock(() => ({})),
}));
mock.module("./commands", () => ({
  processSlashCommand: mock((command, config, callbacks) => {
    if (command === "/quit") {
      callbacks.exit();
    }
  }),
})); // Mock processSlashCommand

describe("startApp", () => {
  const mockConfig: AppConfig = {
    planner: { provider: "anthropic", model: "test-planner-model", temperature: 0.7, maxTokens: 1000 },
    developer: { provider: "anthropic", model: "test-developer-model", temperature: 0.7, maxTokens: 1000 },
    tester: { provider: "anthropic", model: "test-tester-model", temperature: 0.7, maxTokens: 1000 },
    embedding: { provider: "openai", model: "text-embedding-ada-002", dimensions: 1536 },
    pinecone: { indexName: "test-index" },
    chunking: { strategy: "recursive", chunkSize: 1000, chunkOverlap: 200, batchSize: 50 },
    retrieval: { topK: 5 },
    storage: { dataDir: "./data" },
    allowedCommands: [],
  };

  let originalProcessExit: (code?: number) => never;
  let originalStdoutWrite: (chunk: any, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => boolean;

  beforeEach(() => {
    // mock.restoreAll(); // Removed as it's not a function in Bun's mock API
    originalProcessExit = process.exit;
    (process as any).exit = mock((code) => {
      throw new Error(`PROCESS_EXIT:${code}`);
    });

    originalStdoutWrite = stdout.write;
    (stdout as any).write = mock((chunk: any, cb?: (err?: Error | null) => void) => {
      if (cb) cb(null);
      return true;
    });

    // Now createInterface should be a mock function directly
    (createInterface as any).mockReturnValue({
      question: mock(() => Promise.resolve("/quit")),
      close: mock(),
      // Add the 'on' method to the mock
      on: mock(),
    });

    // These are now mocked via mock.module
    // (createVectorStore as any).mockResolvedValue({});
    // (createPlanner as any).mockReturnValue({});
    // (createDeveloper as any).mockReturnValue({});
    // (createTester as any).mockReturnValue({});
    // (createPlannerPrompt as any).mockReturnValue({});

    // (processSlashCommand as unknown as Mock<[string, AppConfig, SlashCommandCallbacks], Promise<void>>).mockImplementation(async (command, config, callbacks) => {
    //   if (command === '/quit') {
    //     callbacks.exit();
    //   }
    // });
  });

  afterEach(() => {
    process.exit = originalProcessExit;
    (stdout as any).write = originalStdoutWrite;
  });

  it("should initialize and exit gracefully with /quit command", async () => {
    await expect(startApp(mockConfig)).rejects.toThrow("PROCESS_EXIT:0");

    expect(createInterface).toHaveBeenCalledWith({ input: stdin, output: stdout }); // Use createInterface directly

    expect(createPlanner).toHaveBeenCalledWith(mockConfig);
    expect(createDeveloper).toHaveBeenCalledWith(mockConfig);
    expect(createTester).toHaveBeenCalledWith(mockConfig);
    expect(createPlannerPrompt).toHaveBeenCalled();

    const mockRl = (createInterface as any).mock.results[0].value; // Use createInterface directly
    expect(mockRl.question).toHaveBeenCalled();
    expect(mockRl.close).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
