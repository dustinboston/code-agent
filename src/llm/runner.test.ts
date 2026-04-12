import {AIMessage, ToolMessage, HumanMessage, AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import {z} from 'zod';
import {describe, it, expect, beforeEach, mock, spyOn, afterEach, type Mock} from 'bun:test';
import * as runner from './runner.js';

// ─── Module-level mocks ──────────────────────────────────────────────────────

const mockRandomUuid = mock(() => '00000000-0000-0000-0000-000000000000');

const mockPromptObject = {
  formatMessages: mock(async (_args: Record<string, string>) => [new HumanMessage('Developer prompt')]),
};

const mockCreateDeveloperPrompt = mock(() => mockPromptObject);
const mockCreateTesterPrompt = mock(() => mockPromptObject);

void mock.module('crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Node.js API name
  randomUUID: mockRandomUuid,
}));

void mock.module('./prompt.js', () => ({
  createDeveloperPrompt: mockCreateDeveloperPrompt,
  createTesterPrompt: mockCreateTesterPrompt,
}));

// ─── Typed mock helpers ──────────────────────────────────────────────────────

type AgentLoopCallbacks = Parameters<typeof runner.runAgentLoop>[2];

type StreamFn = (messages: BaseMessage[], options?: Record<string, unknown>) => AsyncIterable<AIMessageChunk>;

type MockAgentShape = {
  stream: Mock<StreamFn>;
  bindTools: Mock<(tools: unknown[]) => MockAgentShape>;
};

type MockToolShape = {
  name: string;
  description: string;
  schema: z.ZodObject<Record<string, z.ZodType>>;
  invoke: Mock<(toolCall: Record<string, unknown>) => ToolMessage>;
};

async function expectToThrow(promise: Promise<unknown>, substring: string): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (caughtError: unknown) {
    error = caughtError;
  }

  expect(error).toBeInstanceOf(Error);
  if (error instanceof Error) {
    expect(error.message).toContain(substring);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runner', () => {
  let mockAgent: MockAgentShape;
  let mockOnChunk: Mock<(c: AIMessageChunk, text: string) => void>;
  let mockOnTurnComplete: Mock<(acc: AIMessageChunk, iter: string, msgs: BaseMessage[]) => Promise<BaseMessage[]>>;
  let mockOnToolCall: Mock<(tc: unknown) => void>;
  let mockOnActivity: Mock<(line: string) => void>;
  let mockOnStatus: Mock<(message: string) => void>;
  let mockRequestApproval: Mock<(command: string) => Promise<boolean>>;
  let mockOnAgentMessage: Mock<(name: string, message: string) => Promise<void>>;
  let mockTools: MockToolShape[];

  let runAgentLoopSpy: Mock<typeof runner.runAgentLoop>;

  beforeEach(() => {
    mock.restore();

    mockRandomUuid.mockClear();
    mockCreateDeveloperPrompt.mockClear();
    mockCreateTesterPrompt.mockClear();

    runAgentLoopSpy = spyOn(runner, 'runAgentLoop');
    runAgentLoopSpy.mockImplementation(
      async (_agent: unknown, _invokeMessages: BaseMessage[], callbacks: AgentLoopCallbacks) => {
        const content = 'Default agent loop response';
        callbacks.onChunk?.(new AIMessageChunk({content}), content);
        // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
        return [new AIMessage({content, tool_calls: []})];
      },
    );

    mockAgent = {
      stream: mock(async function* (_messages: BaseMessage[]): AsyncGenerator<AIMessageChunk> {
        // Default empty stream
      }),
      bindTools: mock((_tools: unknown[]) => mockAgent),
    };

    mockOnChunk = mock((_c: AIMessageChunk, _text: string) => undefined);
    mockOnTurnComplete = mock(async (_acc: AIMessageChunk, _iter: string, msgs: BaseMessage[]) => msgs);
    mockOnToolCall = mock((_tc: unknown) => undefined);
    mockOnActivity = mock((_line: string) => undefined);
    mockOnStatus = mock((_message: string) => undefined);
    mockRequestApproval = mock(async (_command: string) => true);
    mockOnAgentMessage = mock(async (_name: string, _message: string) => undefined);

    mockTools = [
      {
        name: 'test_tool',
        description: 'A test tool',
        schema: z.object({input: z.string()}),
        invoke: mock((toolCall: Record<string, unknown>) => {
          const {args} = toolCall;
          const input = args !== null && typeof args === 'object' && 'input' in args ? String(args.input) : '';
          return new ToolMessage({
            content: `Tool output: ${input}`,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
            tool_call_id: mockRandomUuid(),
            name: 'test_tool',
          });
        }),
      },
      {
        name: 'run_command',
        description: 'Run a command',
        schema: z.object({command: z.string()}),
        invoke: mock((toolCall: Record<string, unknown>) => {
          const {args} = toolCall;
          const command = args !== null && typeof args === 'object' && 'command' in args ? String(args.command) : '';
          return new ToolMessage({
            content: `Command output: ${command}`,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
            tool_call_id: mockRandomUuid(),
            name: 'run_command',
          });
        }),
      },
    ];
  });

  afterEach(() => {
    mock.restore();
  });

  function buildCallbacks(agentTools: MockToolShape[] = []) {
    return {
      onChunk: mockOnChunk,
      onTurnComplete: mockOnTurnComplete,
      onToolCall: mockOnToolCall,
      onActivity: mockOnActivity,
      onStatus: mockOnStatus,
      requestApproval: mockRequestApproval,
      onAgentMessage: mockOnAgentMessage,
      agentName: 'TestAgent',
      agentTools,
    };
  }

  describe('runAgentLoop', () => {
    beforeEach(() => {
      runAgentLoopSpy.mockRestore();
    });

    it('should run a loop until the agent returns a message without tool calls', async () => {
      mockAgent.stream.mockImplementationOnce(async function* () {
        yield new AIMessageChunk({content: 'Hello from agent!'});
      });

      const result = await runner.runAgentLoop(mockAgent, [], buildCallbacks());

      expect(mockAgent.stream).toHaveBeenCalledTimes(1);
      expect(mockOnChunk).toHaveBeenCalled();
      expect(mockOnAgentMessage).toHaveBeenCalledWith('TestAgent', 'Hello from agent!');
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(AIMessage);
      expect(result[0].content).toBe('Hello from agent!');
    });

    it('should handle tool calls and append tool messages', async () => {
      mockAgent.stream
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({
            content: 'Calling tool',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
            tool_calls: [{id: 'call1', name: 'test_tool', args: {input: 'test'}}],
          });
        })
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({content: 'Finished with tool'});
        });

      const result = await runner.runAgentLoop(mockAgent, [], buildCallbacks(mockTools));

      expect(mockAgent.stream).toHaveBeenCalledTimes(2);
      expect(mockOnToolCall).toHaveBeenCalledWith({id: 'call1', name: 'test_tool', args: {input: 'test'}});
      expect(mockOnActivity).toHaveBeenCalledWith('TestAgent: test_tool(input: test)');
      expect(result).toHaveLength(3);
      expect(result[0]).toBeInstanceOf(AIMessage);
      expect(result[0].content).toBe('Calling tool');
      expect(result[1]).toBeInstanceOf(ToolMessage);
      expect(result[1].content).toBe('Tool output: test');
      expect(result[2]).toBeInstanceOf(AIMessage);
      expect(result[2].content).toBe('Finished with tool');
    });

    it('should request approval for run_command tool calls', async () => {
      mockAgent.stream
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({
            content: 'Running command',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
            tool_calls: [{id: 'call1', name: 'run_command', args: {command: 'ls -la'}}],
          });
        })
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({content: 'Command executed'});
        });

      mockRequestApproval.mockResolvedValueOnce(true);

      const result = await runner.runAgentLoop(mockAgent, [], buildCallbacks(mockTools));

      expect(mockRequestApproval).toHaveBeenCalledWith('ls -la');
      expect(result).toHaveLength(3);
      expect(result[1]).toBeInstanceOf(ToolMessage);
      expect(result[1].content).toBe('Command output: ls -la');
    });

    it('should deny run_command tool calls if approval is denied', async () => {
      mockAgent.stream
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({
            content: 'Running command',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
            tool_calls: [{id: 'call1', name: 'run_command', args: {command: 'rm -rf /'}}],
          });
        })
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({content: 'Command denied'});
        });

      mockRequestApproval.mockResolvedValueOnce(false);

      const result = await runner.runAgentLoop(mockAgent, [], buildCallbacks(mockTools));

      expect(mockRequestApproval).toHaveBeenCalledWith('rm -rf /');
      expect(mockOnActivity).toHaveBeenCalledWith(expect.stringContaining('User denied execution'));
      expect(result).toHaveLength(3);
      expect(result[1]).toBeInstanceOf(ToolMessage);
      expect(result[1].content).toBe('Error: User denied execution of this command.');
    });

    it('should handle unknown tools', async () => {
      mockAgent.stream
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({
            content: 'Calling unknown tool',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
            tool_calls: [{id: 'call1', name: 'unknown_tool', args: {}}],
          });
        })
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({content: 'Handled unknown tool'});
        });

      const result = await runner.runAgentLoop(mockAgent, [], buildCallbacks());

      expect(mockOnActivity).toHaveBeenCalledWith(expect.stringContaining('TestAgent: unknown_tool()'));
      expect(result).toHaveLength(3);
      expect(result[1]).toBeInstanceOf(ToolMessage);
      expect(result[1].content).toBe('Unknown tool: unknown_tool');
    });

    it('should abort mid-stream when AbortSignal fires', async () => {
      const controller = new AbortController();

      mockAgent.stream.mockImplementationOnce(async function* () {
        yield new AIMessageChunk({content: 'chunk one'});
        controller.abort(new Error('INTERRUPTED: user stopped'));
        yield new AIMessageChunk({content: 'chunk two'});
        yield new AIMessageChunk({content: 'chunk three'});
      });

      await expectToThrow(runner.runAgentLoop(mockAgent, [], buildCallbacks(), controller.signal), 'INTERRUPTED:');

      expect(mockOnChunk).toHaveBeenCalledTimes(1);
    });

    it('should normalize a DOMException AbortError into an INTERRUPTED error', async () => {
      const controller = new AbortController();
      const abortError = Object.assign(new Error('The user aborted a request.'), {name: 'AbortError'});
      controller.abort(new Error('INTERRUPTED: aborted'));

      mockAgent.stream.mockImplementationOnce(async function* () {
        yield new AIMessageChunk({content: ''});
        throw abortError;
      });

      await expectToThrow(runner.runAgentLoop(mockAgent, [], buildCallbacks(), controller.signal), 'INTERRUPTED:');
    });

    it('should handle tool invocation errors', async () => {
      const failingTool: MockToolShape = {
        name: 'failing_tool',
        description: 'A tool that always fails',
        schema: z.object({}),
        invoke: mock((_toolCall: Record<string, unknown>) => {
          throw new Error('Tool failed intentionally');
        }),
      };

      mockAgent.stream
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({
            content: 'Calling failing tool',
            // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
            tool_calls: [{id: 'call1', name: 'failing_tool', args: {}}],
          });
        })
        .mockImplementationOnce(async function* () {
          yield new AIMessageChunk({content: 'Handled tool error'});
        });

      const result = await runner.runAgentLoop(mockAgent, [], buildCallbacks([...mockTools, failingTool]));

      expect(mockOnActivity).toHaveBeenCalledWith(expect.stringContaining('Tool error: Tool failed intentionally'));
      expect(result).toHaveLength(3);
      expect(result[1]).toBeInstanceOf(ToolMessage);
      expect(result[1].content).toBe('Tool error: Tool failed intentionally');
    });
  });

  describe('runSubAgent', () => {
    let mockPromptFn: Mock<() => typeof mockPromptObject>;
    let mockAgentModel: MockAgentShape;

    beforeEach(() => {
      runAgentLoopSpy.mockImplementation(
        async (_agent: unknown, _invokeMessages: BaseMessage[], callbacks: AgentLoopCallbacks) => {
          const content = 'Sub-agent response';
          callbacks.onChunk?.(new AIMessageChunk({content: content.slice(0, 5)}), content.slice(0, 5));
          callbacks.onChunk?.(new AIMessageChunk({content: content.slice(5)}), content);
          // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
          return [new AIMessage({content, tool_calls: []})];
        },
      );

      mockPromptFn = mock(() => mockPromptObject);
      mockAgentModel = {
        stream: mock(async function* (): AsyncGenerator<AIMessageChunk> {
          yield new AIMessageChunk({content: 'Sub-agent response from bindTools'});
        }),
        bindTools: mock((_tools: unknown[]) => mockAgentModel),
      };
    });

    it('should bind tools and format prompt messages', async () => {
      const message = 'Do something';
      const result = await runner.runSubAgent({
        agent: mockAgentModel,
        agentTools: mockTools,
        promptFn: mockPromptFn,
        message,
        onStatus: mockOnStatus,
        agentName: 'SubAgent',
        onActivity: mockOnActivity,
        requestApproval: mockRequestApproval,
        onAgentMessage: mockOnAgentMessage,
      });

      expect(mockAgentModel.bindTools).toHaveBeenCalledWith(mockTools);
      expect(mockPromptFn).toHaveBeenCalled();
      expect(mockPromptObject.formatMessages).toHaveBeenCalledWith({input: message});
      expect(runAgentLoopSpy).toHaveBeenCalled();
      expect(result).toBe('Sub-agent response');
    });

    it('should return the full text from the agent loop', async () => {
      const message = 'Perform task';
      const result = await runner.runSubAgent({
        agent: mockAgentModel,
        agentTools: mockTools,
        promptFn: mockPromptFn,
        message,
        onStatus: mockOnStatus,
        agentName: 'SubAgent',
        onActivity: mockOnActivity,
        requestApproval: mockRequestApproval,
        onAgentMessage: mockOnAgentMessage,
      });
      expect(result).toBe('Sub-agent response');
    });
  });

  describe('createSendMessageTool', () => {
    let mockDeveloperAgent: MockAgentShape;
    let mockTesterAgent: MockAgentShape;
    let sendMessageTool: ReturnType<typeof runner.createSendMessageTool>;

    beforeEach(() => {
      mock.restore();
      runAgentLoopSpy = spyOn(runner, 'runAgentLoop').mockImplementation(
        async (_agent: unknown, _invokeMessages: BaseMessage[], callbacks: AgentLoopCallbacks) => {
          const content = 'Sub-agent finished task';
          callbacks.onChunk?.(new AIMessageChunk({content}), content);
          // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
          return [new AIMessage({content, tool_calls: []})];
        },
      );

      const createMockAgent = (): MockAgentShape => {
        const agent: MockAgentShape = {
          stream: mock(async function* (): AsyncGenerator<AIMessageChunk> {
            yield new AIMessageChunk({content: 'streamed response'});
          }),
          bindTools: mock((_tools: unknown[]) => agent),
        };
        return agent;
      };

      mockDeveloperAgent = createMockAgent();
      mockTesterAgent = createMockAgent();

      sendMessageTool = runner.createSendMessageTool({
        developer: mockDeveloperAgent,
        tester: mockTesterAgent,
        onStatus: mockOnStatus,
        onActivity: mockOnActivity,
        requestApproval: mockRequestApproval,
        onAgentMessage: mockOnAgentMessage,
      });
    });

    it('should create a tool with the correct name and description', () => {
      expect(sendMessageTool.name).toBe('send_message');
      expect(sendMessageTool.description).toBe(
        "Delegate a task to a sub-agent. Use 'developer' to implement code changes, 'tester' to write and run tests.",
      );
      expect(sendMessageTool.schema.parse({id: 'developer', message: 'test'})).toEqual({
        id: 'developer',
        message: 'test',
      });
    });

    it('should call runSubAgent for the developer agent', async () => {
      const result = await sendMessageTool.invoke({id: 'developer', message: 'Implement feature X'});

      expect(mockOnStatus).toHaveBeenCalledWith('Developer is working...');
      expect(runAgentLoopSpy).toHaveBeenCalled();
      expect(result).toBe(JSON.stringify({id: 'coordinator', status: 'success', message: 'Sub-agent finished task'}));
    });

    it('should call runSubAgent for the tester agent', async () => {
      const result = await sendMessageTool.invoke({id: 'tester', message: 'Write tests for Y'});

      expect(mockOnStatus).toHaveBeenCalledWith('Tester is working...');
      expect(runAgentLoopSpy).toHaveBeenCalled();
      expect(result).toBe(JSON.stringify({id: 'coordinator', status: 'success', message: 'Sub-agent finished task'}));
    });

    it('should return a failure message for an unknown agent ID', async () => {
      await expectToThrow(
        sendMessageTool.invoke({id: 'unknown', message: 'Some message'}),
        'Invalid option: expected one of "developer"|"tester"',
      );
      expect(runAgentLoopSpy).not.toHaveBeenCalled();
    });
  });
});
