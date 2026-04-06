import { AIMessage, ToolMessage, HumanMessage, AIMessageChunk } from "@langchain/core/messages";
import { z } from "zod";
import * as runner from "./runner";
import { describe, it, expect, beforeEach, mock, spyOn, afterEach, Mock } from "bun:test";
import { BaseMessage } from "@langchain/core/messages";
import { Runnable } from "@langchain/core/runnables";

// Mock external dependencies using mock.module
let mockRandomUUID: Mock<any>;
let mockCreateDeveloperPrompt: Mock<any>;
let mockCreateTesterPrompt: Mock<any>;

mock.module("crypto", () => ({
  randomUUID: (mockRandomUUID = mock(() => "00000000-0000-0000-0000-000000000000")), // Provide a valid UUID format
}));

// Consistent mock prompt object for runSubAgent tests
const mockPromptObject = {
  formatMessages: mock(() => Promise.resolve([new HumanMessage("Developer prompt")])),
};

mock.module("./prompt.js", () => ({
  createDeveloperPrompt: (mockCreateDeveloperPrompt = mock(() => mockPromptObject)),
  createTesterPrompt: (mockCreateTesterPrompt = mock(() => mockPromptObject)),
}));

describe("runner", () => {
  let mockAgent: any;
  let mockCallbacks: any;
  let mockTools: any[];

  // Spy for internal function runAgentLoop
  let runAgentLoopSpy: Mock<any>;

  beforeEach(() => {
    mock.restore();

    // Clear mock calls for module mocks
    mockRandomUUID.mockClear();
    mockCreateDeveloperPrompt.mockClear();
    mockCreateTesterPrompt.mockClear();

    // Initialize runAgentLoopSpy as a spy on the actual function
    runAgentLoopSpy = spyOn(runner, "runAgentLoop");
    // Default mock implementation for runAgentLoop, can be overridden in specific test blocks
    runAgentLoopSpy.mockImplementation(async (agent: Runnable<any, any>, invokeMessages: BaseMessage[], callbacks: any) => {
      return [new AIMessage({ content: "Default agent loop response", tool_calls: [] })];
    });

    mockAgent = {
      stream: mock(),
      bindTools: mock((tools) => ({ ...mockAgent, tools })),
    };

    mockCallbacks = {
      onChunk: mock(),
      onTurnComplete: mock((acc, iter, msgs) => Promise.resolve(msgs)),
      onToolCall: mock(),
      onActivity: mock((line) => { /* console.log("onActivity called with:", line); */ }),
      onStatus: mock(),
      requestApproval: mock(() => Promise.resolve(true)),
      onAgentMessage: mock(),
      agentName: "TestAgent",
      agentTools: [],
    };

    // Mock tools for runAgentLoop tests (plain objects to bypass schema validation from LangChain's tool helper)
    mockTools = [
      {
        name: "test_tool",
        description: "A test tool",
        schema: z.object({ input: z.string() }),
        invoke: mock((toolCall) => new ToolMessage({ content: `Tool output: ${toolCall.args.input}`, tool_call_id: mockRandomUUID(), name: "test_tool" })),
      },
      {
        name: "run_command",
        description: "Run a command",
        schema: z.object({ command: z.string() }),
        invoke: mock((toolCall) => new ToolMessage({ content: `Command output: ${toolCall.args.command}`, tool_call_id: mockRandomUUID(), name: "run_command" })),
      },
    ];
  });

  afterEach(() => {
    mock.restore();
  });

  describe("runAgentLoop", () => {
    beforeEach(() => {
      // Restore runAgentLoop to its original implementation for these tests
      // as we are testing runAgentLoop itself, not its interaction with runSubAgent
      runAgentLoopSpy.mockRestore();
    });

    it("should run a loop until the agent returns a message without tool calls", async () => {
      mockAgent.stream.mockImplementationOnce(async function* () {
        yield new AIMessageChunk({ content: "Hello from agent!" });
      });

      const result = await runner.runAgentLoop(mockAgent, [], mockCallbacks);

      expect(mockAgent.stream).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onChunk).toHaveBeenCalled();
      expect(mockCallbacks.onAgentMessage).toHaveBeenCalledWith("TestAgent", "Hello from agent!");
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(AIMessage);
      expect((result[0] as AIMessage).content).toBe("Hello from agent!");
    });

    it("should handle tool calls and append tool messages", async () => {
      mockAgent.stream
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({
            content: "Calling tool",
            tool_calls: [{ id: "call1", name: "test_tool", args: { input: "test" } }],
          });
        })
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({ content: "Finished with tool" });
        });

      mockCallbacks.agentTools = mockTools;

      const result = await runner.runAgentLoop(mockAgent, [], mockCallbacks);

      expect(mockAgent.stream).toHaveBeenCalledTimes(2);
      expect(mockCallbacks.onToolCall).toHaveBeenCalledWith({ id: "call1", name: "test_tool", args: { input: "test" } });
      expect(mockCallbacks.onActivity).toHaveBeenCalledWith("TestAgent: test_tool(input: test)");
      expect(result).toHaveLength(3);
      expect(result[0]).toBeInstanceOf(AIMessage);
      expect((result[0] as AIMessage).content).toBe("Calling tool");
      expect(result[1]).toBeInstanceOf(ToolMessage);
      expect((result[1] as ToolMessage).content).toBe("Tool output: test");
      expect(result[2]).toBeInstanceOf(AIMessage);
      expect((result[2] as AIMessage).content).toBe("Finished with tool");
    });

    it("should request approval for run_command tool calls", async () => {
      mockAgent.stream
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({
            content: "Running command",
            tool_calls: [{ id: "call1", name: "run_command", args: { command: "ls -la" } }],
          });
        })
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({ content: "Command executed" });
        });

      mockCallbacks.agentTools = mockTools;
      mockCallbacks.requestApproval.mockResolvedValueOnce(true); // Approve the command

      const result = await runner.runAgentLoop(mockAgent, [], mockCallbacks);

      expect(mockCallbacks.requestApproval).toHaveBeenCalledWith("ls -la");
      expect(result).toHaveLength(3);
      expect(result[1]).toBeInstanceOf(ToolMessage);
      expect((result[1] as AIMessage).content).toBe("Command output: ls -la");
    });

    it("should deny run_command tool calls if approval is denied", async () => {
      mockAgent.stream
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({
            content: "Running command",
            tool_calls: [{ id: "call1", name: "run_command", args: { command: "rm -rf /" } }],
          });
        })
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({ content: "Command denied" });
        });

      mockCallbacks.agentTools = mockTools;
      mockCallbacks.requestApproval.mockResolvedValueOnce(false); // Deny the command

      const result = await runner.runAgentLoop(mockAgent, [], mockCallbacks);

      expect(mockCallbacks.requestApproval).toHaveBeenCalledWith("rm -rf /");
      expect(mockCallbacks.onActivity).toHaveBeenCalledWith(expect.stringContaining("User denied execution"));
      expect(result).toHaveLength(3);
      expect(result[1]).toBeInstanceOf(ToolMessage);
      expect((result[1] as AIMessage).content).toBe("Error: User denied execution of this command.");
    });

    it("should handle unknown tools", async () => {
      mockAgent.stream
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({
            content: "Calling unknown tool",
            tool_calls: [{ id: "call1", name: "unknown_tool", args: {} }],
          });
        })
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({ content: "Handled unknown tool" });
        });

      mockCallbacks.agentTools = []; // Ensure no tools are found

      const result = await runner.runAgentLoop(mockAgent, [], mockCallbacks);

      expect(mockCallbacks.onActivity).toHaveBeenCalledWith(expect.stringContaining("TestAgent: unknown_tool()"));
      expect(result).toHaveLength(3);
      expect(result[1]).toBeInstanceOf(ToolMessage);
      expect((result[1] as AIMessage).content).toBe("Unknown tool: unknown_tool");
    });

    it("should abort mid-stream when AbortSignal fires", async () => {
      const controller = new AbortController();

      mockAgent.stream.mockImplementationOnce(async function* () {
        yield new AIMessageChunk({ content: "chunk one" });
        controller.abort(new Error("INTERRUPTED: user stopped"));
        yield new AIMessageChunk({ content: "chunk two" });
        yield new AIMessageChunk({ content: "chunk three" });
      });

      await expect(
        runner.runAgentLoop(mockAgent, [], mockCallbacks, controller.signal),
      ).rejects.toThrow("INTERRUPTED:");

      // Only the first chunk should have been processed before abort was detected
      expect(mockCallbacks.onChunk).toHaveBeenCalledTimes(1);
    });

    it("should normalize a DOMException AbortError into an INTERRUPTED error", async () => {
      const controller = new AbortController();
      const abortError = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
      controller.abort(new Error("INTERRUPTED: aborted"));

      mockAgent.stream.mockImplementationOnce(async function* () {
        throw abortError;
        yield new AIMessageChunk({ content: "never" });
      });

      await expect(
        runner.runAgentLoop(mockAgent, [], mockCallbacks, controller.signal),
      ).rejects.toThrow("INTERRUPTED:");
    });

    it("should handle tool invocation errors", async () => {
      const failingTool = {
        name: "failing_tool",
        description: "A tool that always fails",
        schema: z.object({}),
        invoke: mock((toolCall) => { throw new Error("Tool failed intentionally"); }),
      } as any;

      mockAgent.stream
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({
            content: "Calling failing tool",
            tool_calls: [{ id: "call1", name: "failing_tool", args: {} }],
          });
        })
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({ content: "Handled tool error" });
        });

      mockCallbacks.agentTools = [...mockTools, failingTool];

      const result = await runner.runAgentLoop(mockAgent, [], mockCallbacks);

      expect(mockCallbacks.onActivity).toHaveBeenCalledWith(expect.stringContaining("Tool error: Tool failed intentionally"));
      expect(result).toHaveLength(3);
      expect(result[1]).toBeInstanceOf(ToolMessage);
      expect((result[1] as AIMessage).content).toBe("Tool error: Tool failed intentionally");
    });
  });

  describe("runSubAgent", () => {
    let mockPromptFn: any;
    let mockAgentModel: any;

    beforeEach(() => {
      // For runSubAgent tests, we want to mock runAgentLoop's behavior
      runAgentLoopSpy.mockImplementation(async (agent: Runnable<any, any>, invokeMessages: BaseMessage[], callbacks: any) => {
        const content = "Sub-agent response";
        // Simulate streaming behavior for onChunk callback
        callbacks.onChunk?.(new AIMessageChunk({ content: content.slice(0, 5) }), content.slice(0, 5));
        callbacks.onChunk?.(new AIMessageChunk({ content: content.slice(5) }), content);
        return [new AIMessage({ content: content, tool_calls: [] })];
      });

      mockPromptFn = mock(() => mockPromptObject);
      mockAgentModel = {
        bindTools: mock((tools) => ({
          stream: mock(async function* () {
            yield new AIMessageChunk({ content: "Sub-agent response from bindTools" });
          }),
        })),
      };
    });

    it("should bind tools and format prompt messages", async () => {
      const message = "Do something";
      const result = await runner.runSubAgent(
        mockAgentModel,
        mockTools,
        mockPromptFn,
        message,
        mockCallbacks.onStatus,
        "SubAgent",
        mockCallbacks.onActivity,
        mockCallbacks.requestApproval,
        mockCallbacks.onAgentMessage,
      );

      expect(mockAgentModel.bindTools).toHaveBeenCalledWith(mockTools);
      expect(mockPromptFn).toHaveBeenCalled();
      expect(mockPromptObject.formatMessages).toHaveBeenCalledWith({ input: message });
      expect(runAgentLoopSpy).toHaveBeenCalled();
      expect(result).toBe("Sub-agent response");
    });

    it("should return the full text from the agent loop", async () => {
      const message = "Perform task";
      const result = await runner.runSubAgent(
        mockAgentModel,
        mockTools,
        mockPromptFn,
        message,
        mockCallbacks.onStatus,
        "SubAgent",
        mockCallbacks.onActivity,
        mockCallbacks.requestApproval,
        mockCallbacks.onAgentMessage,
      );
      expect(result).toBe("Sub-agent response");
    });
  });

  describe("createSendMessageTool", () => {
    let mockDeveloperAgent: any;
    let mockTesterAgent: any;
    let sendMessageTool: any;

    beforeEach(() => {
      mock.restore(); // Restore all mocks, including runAgentLoopSpy
      // Re-spy on runAgentLoop for createSendMessageTool tests
      runAgentLoopSpy = spyOn(runner, "runAgentLoop").mockImplementation(async (agent: Runnable<any, any>, invokeMessages: BaseMessage[], callbacks: any) => {
        const content = "Sub-agent finished task";
        callbacks.onChunk?.(new AIMessageChunk({ content: content }), content);
        return [new AIMessage({ content: content, tool_calls: [] })];
      });

      // Mock developerAgent and testerAgent to stream a simple response
      const createMockAgent = (agentName: string) => ({
        bindTools: mock((tools) => ({
          stream: mock(async function* () {
            yield new AIMessageChunk({ content: `${agentName} streamed response` });
          }),
        })),
      });

      mockDeveloperAgent = createMockAgent("Developer");
      mockTesterAgent = createMockAgent("Tester");

      sendMessageTool = runner.createSendMessageTool(
        mockDeveloperAgent,
        mockTesterAgent,
        mockCallbacks.onStatus,
        mockCallbacks.onActivity,
        mockCallbacks.requestApproval,
        mockCallbacks.onAgentMessage,
      );
    });

    it("should create a tool with the correct name and description", () => {
      expect(sendMessageTool.name).toBe("send_message");
      expect(sendMessageTool.description).toBe(
        "Delegate a task to a sub-agent. Use 'developer' to implement code changes, 'tester' to write and run tests.",
      );
      expect(sendMessageTool.schema.parse({ id: "developer", message: "test" })).toEqual({
        id: "developer",
        message: "test",
      });
    });

    it("should call runSubAgent for the developer agent", async () => {
      const result = await sendMessageTool.invoke({ id: "developer", message: "Implement feature X" });

      expect(mockCallbacks.onStatus).toHaveBeenCalledWith("Developer is working...");
      // Expect runAgentLoopSpy to have been called, as runAgentLoop calls it
      expect(runAgentLoopSpy).toHaveBeenCalled();
      expect(result).toBe(JSON.stringify({ id: "coordinator", status: "success", message: "Sub-agent finished task" }));
    });

    it("should call runSubAgent for the tester agent", async () => {
      const result = await sendMessageTool.invoke({ id: "tester", message: "Write tests for Y" });

      expect(mockCallbacks.onStatus).toHaveBeenCalledWith("Tester is working...");
      // Expect runAgentLoopSpy to have been called, as runAgentLoop calls it
      expect(runAgentLoopSpy).toHaveBeenCalled();
      expect(result).toBe(JSON.stringify({ id: "coordinator", status: "success", message: "Sub-agent finished task" }));
    });

    it("should return a failure message for an unknown agent ID", async () => {
      await expect(sendMessageTool.invoke({ id: "unknown", message: "Some message" })).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Invalid option: expected one of \"developer\"|\"tester\""),
        }),
      );
      // Ensure runAgentLoopSpy was not called for an unknown agent ID
      expect(runAgentLoopSpy).not.toHaveBeenCalled();
    });
  });
});
