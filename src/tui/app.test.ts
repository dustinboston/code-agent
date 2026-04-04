import { startApp } from "./app";
import { createInterface } from "readline/promises"; // Import createInterface directly
import { stdin, stdout } from "process";
import { createDeveloper, createPlanner, createTester } from "../llm/llm";
import { createPlannerPrompt } from "../llm/prompt";
import { expect, mock, Mock, beforeEach, afterEach, spyOn, describe, it } from "bun:test";
import { processSlashCommand, SlashCommandCallbacks } from "./commands";
import { AppConfig, Provider } from "../types";

// Mock external dependencies
mock.module("readline/promises", () => {
  const mockCreateInterface = mock((options) => ({
    question: mock(() => Promise.resolve("/quit")),
    close: mock(),
    on: mock(),
  }));
  return {
    createInterface: mockCreateInterface,
  };
});
mock.module("../retrieval/store", () => ({
  createVectorStore: mock(() => ({})),
}));
mock.module("../llm/llm", () => ({
  createDeveloper: mock(() => ({})),
  createPlanner: mock(() => ({})),
  createTester: mock(() => ({})),
}));
mock.module("../llm/prompt", () => ({
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
    allowedCommands: [],
  };

  let originalProcessExit: (code?: number) => never;
  let originalStdoutWrite: (chunk: any, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => boolean;

  beforeEach(() => {
    originalProcessExit = process.exit;
    (process as any).exit = mock((code) => {
      throw new Error(`PROCESS_EXIT:${code}`);
    });

    originalStdoutWrite = stdout.write;
    (stdout as any).write = mock((chunk: any, cb?: (err?: Error | null) => void) => {
      if (cb) cb(null);
      return true;
    });
  });

  afterEach(() => {
    process.exit = originalProcessExit;
    (stdout as any).write = originalStdoutWrite;
  });

  it("should initialize and exit gracefully with /quit command", async () => {
    await expect(startApp(mockConfig)).rejects.toThrow("PROCESS_EXIT:0");

    expect(createInterface).toHaveBeenCalledWith({
      input: stdin,
      output: stdout,
      terminal: stdin.isTTY ?? false,
      historySize: 1000,
    });

    expect(createPlanner).toHaveBeenCalledWith(mockConfig);
    expect(createDeveloper).toHaveBeenCalledWith(mockConfig);
    expect(createTester).toHaveBeenCalledWith(mockConfig);
    expect(createPlannerPrompt).toHaveBeenCalled();

    const mockRl = (createInterface as any).mock.results[0].value;
    expect(mockRl.question).toHaveBeenCalled();
    expect(mockRl.close).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
