import {randomUUID} from 'node:crypto';
import chalk from 'chalk';
import {AIMessage, ToolMessage, type AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import type {ToolCall} from '@langchain/core/messages/tool';
import type {ChatAnthropic} from '@langchain/anthropic';
import type {ChatOpenAI} from '@langchain/openai';
import type {ChatGoogle} from '@langchain/google';
import type {Runnable} from '@langchain/core/runnables';
import {z} from 'zod';
import {tool, type DynamicStructuredTool} from '@langchain/core/tools';
import {readFileTool, listDirectoryTool, writeFileTool, deletePathTool} from '../tools/filesystem.js';
import {runCommandTool} from '../tools/shell.js';
import {createDeveloperPrompt, createTesterPrompt} from './prompt.js';

type AgentModel = ChatAnthropic | ChatOpenAI | ChatGoogle;

// ─── Agent loop runner ─────────────────────────────────────────────────────────

type RunAgentLoopCallbacks = {
  onChunk?: (chunk: AIMessageChunk, iterationText: string) => void;
  onTurnComplete?: (
    accChunk: AIMessageChunk,
    iterationText: string,
    invokeMessages: BaseMessage[],
  ) => Promise<BaseMessage[]>;
  onToolCall?: (toolCall: ToolCall) => void;
  onActivity?: (line: string) => void;
  onStatus?: (message: string) => void;
  requestApproval?: (command: string) => Promise<boolean>;
  onAgentMessage?: (agentName: string, message: string) => Promise<void>;
  agentName: string;
  agentTools: DynamicStructuredTool[];
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error('INTERRUPTED: aborted');
}

function buildAiMessage(chunk: AIMessageChunk): AIMessage {
  return new AIMessage({
    content: chunk.content,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
    tool_calls: chunk.tool_calls,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
    additional_kwargs: chunk.additional_kwargs,
    id: chunk.id,
  });
}

function extractText(content: AIMessageChunk['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : 'text' in p ? p.text : '')).join('');
  }

  return '';
}

function announceToolChunks(
  chunk: AIMessageChunk,
  announcedTools: Set<string>,
  agentName: string,
  onActivity: (line: string) => void,
): void {
  if (!chunk.tool_call_chunks) return;
  for (const tcc of chunk.tool_call_chunks) {
    if (!tcc.name) continue;
    const key = tcc.index?.toString() ?? tcc.id ?? '';
    if (key && !announcedTools.has(key)) {
      announcedTools.add(key);
      onActivity(`${agentName} preparing ${tcc.name}...`);
    }
  }
}

function mergeChunks(existing: AIMessageChunk, incoming: AIMessageChunk): AIMessageChunk {
  // eslint-disable-next-line unicorn/prefer-spread -- AIMessageChunk.concat is not Array#concat
  return existing.concat(incoming);
}

type StreamResult = {
  accChunk: AIMessageChunk | undefined;
  iterationText: string;
};

async function streamOneIteration(
  agent: Runnable<BaseMessage[], AIMessageChunk>,
  messages: BaseMessage[],
  callbacks: RunAgentLoopCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const {onChunk, onActivity, agentName} = callbacks;
  let accChunk: AIMessageChunk | undefined;
  let iterationText = '';
  const announcedTools = new Set<string>();

  const stream = await agent.stream(messages, {signal});
  for await (const chunk of stream) {
    if (signal?.aborted) {
      throw toError(signal.reason);
    }

    accChunk = accChunk ? mergeChunks(accChunk, chunk) : chunk;

    if (onActivity) {
      announceToolChunks(chunk, announcedTools, agentName, onActivity);
    }

    const text = extractText(chunk.content);
    iterationText += text;
    onChunk?.(chunk, iterationText);
  }

  return {accChunk, iterationText};
}

function buildToolMessage(content: string, toolCall: ToolCall): ToolMessage {
  return new ToolMessage({
    content,
    name: toolCall.name,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain API field
    tool_call_id: toolCall.id ?? randomUUID(),
  });
}

async function executeSingleToolCall(toolCall: ToolCall, callbacks: RunAgentLoopCallbacks): Promise<ToolMessage> {
  const {onActivity, requestApproval, agentName, agentTools} = callbacks;

  if (onActivity) {
    logToolCallActivity(toolCall, agentName, onActivity);
  }

  if (toolCall.name === 'run_command' && requestApproval) {
    const command =
      typeof toolCall.args === 'object' && toolCall.args !== null && 'command' in toolCall.args
        ? String(toolCall.args.command)
        : '';
    const approved = await requestApproval(command);
    if (!approved) {
      const deniedMessage = 'Error: User denied execution of this command.';
      if (onActivity) onActivity(chalk.red(`    ⚠ ${deniedMessage}`));
      return buildToolMessage(deniedMessage, toolCall);
    }
  }

  const toolFn = agentTools.find((t) => t.name === toolCall.name);
  if (!toolFn) {
    return buildToolMessage(`Unknown tool: ${toolCall.name}`, toolCall);
  }

  try {
    const result: unknown = await toolFn.invoke(toolCall);
    if (result instanceof ToolMessage) {
      return result;
    }

    return buildToolMessage(String(result), toolCall);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('INTERRUPTED:')) {
      throw error;
    }

    const errorMessage = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
    if (onActivity) onActivity(chalk.red(`    ⚠ ${errorMessage.slice(0, 500)}`));
    return buildToolMessage(errorMessage, toolCall);
  }
}

function logToolCallActivity(toolCall: ToolCall, agentName: string, onActivity: (line: string) => void): void {
  const argsSummary = Object.entries(toolCall.args ?? {})
    .filter(([k]) => !(toolCall.name === 'write_file' && k === 'content'))
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}: ${s.length > 60 ? s.slice(0, 57) + '...' : s}`;
    })
    .join(', ');
  onActivity(`${agentName}: ${toolCall.name}(${argsSummary})`);
}

function logToolError(toolMessage: ToolMessage, onActivity?: (line: string) => void): void {
  if (
    onActivity &&
    typeof toolMessage.content === 'string' &&
    (toolMessage.content.startsWith('Error ') || toolMessage.content.startsWith('Tool error:'))
  ) {
    onActivity(chalk.red(`    ⚠ ${toolMessage.content.slice(0, 150)}`));
  }
}

async function processToolCalls(toolCalls: ToolCall[], callbacks: RunAgentLoopCallbacks): Promise<ToolMessage[]> {
  const {onToolCall, onStatus, agentName} = callbacks;

  onStatus?.(`${agentName} using tools (${toolCalls.map((tc) => tc.name).join(', ')})...`);

  for (const tc of toolCalls) {
    onToolCall?.(tc);
  }

  const toolMessages = await Promise.all(
    toolCalls.map(async (toolCall) => {
      const toolMessage = await executeSingleToolCall(toolCall, callbacks);
      logToolError(toolMessage, callbacks.onActivity);
      return toolMessage;
    }),
  );

  return toolMessages;
}

function handleStreamInterrupt(
  accChunk: AIMessageChunk | undefined,
  messages: BaseMessage[],
  signal?: AbortSignal,
): BaseMessage[] {
  if (accChunk) {
    return [...messages, buildAiMessage(accChunk)];
  }

  return messages;
}

type InterruptErrorOptions = {
  error: unknown;
  accChunk: AIMessageChunk | undefined;
  messages: BaseMessage[];
  onTurnComplete: RunAgentLoopCallbacks['onTurnComplete'];
  signal?: AbortSignal;
};

function handleInterruptError(options: InterruptErrorOptions): never {
  const {error, accChunk, messages, onTurnComplete, signal} = options;
  if (error instanceof Error && (error.name === 'AbortError' || error.message.startsWith('INTERRUPTED:'))) {
    const updatedMessages = handleStreamInterrupt(accChunk, messages, signal);
    void onTurnComplete?.(accChunk!, '', updatedMessages);

    const interruptError =
      signal?.reason instanceof Error && signal.reason.message.startsWith('INTERRUPTED:')
        ? signal.reason
        : new Error('INTERRUPTED: aborted');
    throw interruptError;
  }

  throw error;
}

async function runAgentIteration(
  agent: Runnable<BaseMessage[], AIMessageChunk>,
  currentMessages: BaseMessage[],
  callbacks: RunAgentLoopCallbacks,
  signal?: AbortSignal,
): Promise<BaseMessage[]> {
  if (signal?.aborted) {
    throw toError(signal.reason);
  }

  const {onTurnComplete, onAgentMessage, agentName} = callbacks;

  let streamResult: StreamResult;
  try {
    streamResult = await streamOneIteration(agent, currentMessages, callbacks, signal);
  } catch (error: unknown) {
    handleInterruptError({error, accChunk: undefined, messages: currentMessages, onTurnComplete, signal});
    throw error; // Unreachable — handleInterruptError always throws
  }

  const {accChunk, iterationText} = streamResult;
  if (!accChunk) return currentMessages;

  if (onAgentMessage && iterationText.trim()) {
    await onAgentMessage(agentName, iterationText.trim());
  }

  let messages = [...currentMessages, buildAiMessage(accChunk)];

  if (onTurnComplete) {
    messages = await onTurnComplete(accChunk, iterationText, messages);
  }

  const toolCalls = accChunk.tool_calls ?? [];
  if (toolCalls.length === 0) return messages;

  const toolMessages = await processToolCalls(toolCalls, callbacks);
  return runAgentIteration(agent, [...messages, ...toolMessages], callbacks, signal);
}

export async function runAgentLoop(
  agent: Runnable<BaseMessage[], AIMessageChunk>,
  invokeMessages: BaseMessage[],
  callbacks: RunAgentLoopCallbacks,
  signal?: AbortSignal,
): Promise<BaseMessage[]> {
  return runAgentIteration(agent, [...invokeMessages], callbacks, signal);
}

// ─── Sub-agent runner ──────────────────────────────────────────────────────────

type SubAgentOptions = {
  agent: AgentModel;
  agentTools: DynamicStructuredTool[];
  promptFn: () => ReturnType<typeof createDeveloperPrompt>;
  message: string;
  onStatus: (message: string) => void;
  agentName: string;
  onActivity?: (line: string) => void;
  requestApproval?: (command: string) => Promise<boolean>;
  onAgentMessage?: (agentName: string, message: string) => Promise<void>;
  signal?: AbortSignal;
};

/**
 * Runs a single sub-agent (developer or tester) in an agentic tool-use loop.
 */
export async function runSubAgent(options: SubAgentOptions): Promise<string> {
  const {
    agent,
    agentTools,
    promptFn,
    message,
    onStatus,
    agentName,
    onActivity,
    requestApproval,
    onAgentMessage,
    signal,
  } = options;
  const agentWithTools = agent.bindTools(agentTools);
  const prompt = await promptFn();
  const promptMessages = await prompt.formatMessages({input: message});
  let fullText = '';
  let lastStatus = '';

  const wrappedOnStatus = (statusMessage: string) => {
    lastStatus = statusMessage;
    onStatus(statusMessage);
  };

  try {
    await runAgentLoop(
      agentWithTools,
      promptMessages,
      {
        onChunk(c) {
          fullText += extractText(c.content);
        },
        async onTurnComplete(accChunk, iterationText, currentInvokeMessages) {
          return currentInvokeMessages;
        },
        onActivity,
        onStatus: wrappedOnStatus,
        requestApproval,
        onAgentMessage,
        agentName,
        agentTools,
      },
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('INTERRUPTED:')) {
      const statusString = lastStatus ? ` Last status: ${lastStatus}` : '';
      const partial = fullText.trim() ? ` Output: ${fullText.trim()}` : '';
      error.message += `\n[System Note: Interrupted while ${agentName} was working.${statusString}${partial}]`;
    }

    throw error;
  }

  return fullText;
}

// ─── send_message tool factory ────────────────────────────────────────────────

type SendMessageToolOptions = {
  developer: AgentModel;
  tester: AgentModel;
  onStatus: (message: string) => void;
  onActivity?: (line: string) => void;
  requestApproval?: (command: string) => Promise<boolean>;
  onAgentMessage?: (agentName: string, message: string) => Promise<void>;
  signal?: AbortSignal;
};

/**
 * Creates the `send_message` LangChain tool that the planner uses to delegate
 * work to sub-agents.
 */
export function createSendMessageTool(options: SendMessageToolOptions) {
  const {developer, tester, onStatus, onActivity, requestApproval, onAgentMessage, signal} = options;
  const subAgentTools = [readFileTool, listDirectoryTool, writeFileTool, deletePathTool, runCommandTool];

  return tool(
    async ({id, message}: {id: string; message: string}) => {
      if (id === 'developer') {
        onStatus('Developer is working...');
        const result = await runSubAgent({
          agent: developer,
          agentTools: subAgentTools,
          promptFn: createDeveloperPrompt,
          message,
          onStatus,
          agentName: 'Developer',
          onActivity,
          requestApproval,
          onAgentMessage,
          signal,
        });
        return JSON.stringify({id: 'coordinator', status: 'success', message: result});
      }

      if (id === 'tester') {
        onStatus('Tester is working...');
        const result = await runSubAgent({
          agent: tester,
          agentTools: subAgentTools,
          promptFn: createTesterPrompt,
          message,
          onStatus,
          agentName: 'Tester',
          onActivity,
          requestApproval,
          onAgentMessage,
          signal,
        });
        return JSON.stringify({id: 'coordinator', status: 'success', message: result});
      }

      return JSON.stringify({
        id: 'coordinator',
        status: 'failure',
        message: `Unknown agent: ${id}. Valid agents: developer, tester.`,
      });
    },
    {
      name: 'send_message',
      description:
        "Delegate a task to a sub-agent. Use 'developer' to implement code changes, 'tester' to write and run tests.",
      schema: z.object({
        id: z.enum(['developer', 'tester']).describe('The sub-agent to message'),
        message: z.string().describe('A self-contained task description with all context the agent needs'),
      }),
    },
  );
}
