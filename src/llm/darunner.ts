import process from 'node:process';
import {exec} from 'node:child_process';
import {createDeepAgent, CompositeBackend, FilesystemBackend, type SubAgent} from 'deepagents';
import {HumanMessage, type AIMessageChunk} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {MemorySaver} from '@langchain/langgraph';
import {deletePathTool} from '../tools/filesystem.js';
import type {AppConfig} from '../types.js';
import {createPlannerPrompt, createDeveloperPrompt, createTesterPrompt} from './prompt.js';

const memoryRootDir = './.agents/memory';

/**
 * Mutable reference to the command approval function.
 * Set by the TUI before each agent run so the run_command tool
 * can prompt the user for approval via readline.
 */
export type ApprovalRef = {
  requestApproval?: (command: string) => Promise<boolean>;
};

/** The agent instance returned by {@link createCodeAgent}. */
export type CodeAgent = ReturnType<typeof createDeepAgent>;

/** Callbacks for streaming agent output to the TUI. */
export type CodeAgentCallbacks = {
  onText?: (text: string, agentName: string) => void;
  onToolStart?: (toolName: string, agentName: string) => void;
  onStatus?: (message: string) => void;
};

/** Options for {@link runCodeAgent}. */
export type RunCodeAgentOptions = {
  input: string;
  threadId: string;
  callbacks: CodeAgentCallbacks;
  signal?: AbortSignal;
};

function createRunCommandTool(approvalRef: ApprovalRef) {
  return tool(
    async ({command}: {command: string}) => {
      if (approvalRef.requestApproval) {
        const approved = await approvalRef.requestApproval(command);
        if (!approved) {
          return 'Error: User denied execution of this command.';
        }
      }

      try {
        const {stdout, stderr} = await new Promise<{stdout: string; stderr: string}>((resolve, reject) => {
          exec(
            command,
            {
              cwd: process.cwd(),
              timeout: 30_000,
              // eslint-disable-next-line @typescript-eslint/naming-convention -- environment variable
              env: {...process.env, NODE_OPTIONS: undefined},
            },
            (error, stdout, stderr) => {
              if (error) reject(error);
              else resolve({stdout, stderr});
            },
          );
        });
        return [stdout, stderr].filter(Boolean).join('\n') || '(no output)';
      } catch (error: unknown) {
        const isObject = error !== null && error !== undefined && typeof error === 'object';
        const code = isObject && 'code' in error ? String(error.code) : 'unknown';
        const stdout = isObject && 'stdout' in error ? String(error.stdout) : '';
        const stderr = isObject && 'stderr' in error ? String(error.stderr) : '';
        const out = [stdout, stderr].filter(Boolean).join('\n');
        return `Exit code ${code} (or timeout):\n${out || String(error)}`;
      }
    },
    {
      name: 'run_command',
      description:
        'Run a shell command and return its output. This is a last resort if no other tools can handle the request.',
      schema: z.object({
        command: z.string().describe('The shell command to run'),
      }),
    },
  );
}

function extractText(content: AIMessageChunk['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : 'text' in p ? p.text : '')).join('');
  }

  return '';
}

function hasContent(value: unknown): value is {content: AIMessageChunk['content']} {
  return value !== null && value !== undefined && typeof value === 'object' && 'content' in value;
}

function resolveAgentName(metadata: Record<string, unknown> | undefined): string {
  const raw = metadata?.lc_agent_name;
  return typeof raw === 'string' ? raw : 'planner';
}

/**
 * Creates a DeepAgent configured with the planner, developer, and tester
 * sub-agents, filesystem backend, memory, and run_command tool with approval.
 */
export async function createCodeAgent(config: AppConfig, approvalRef: ApprovalRef): Promise<CodeAgent> {
  const [plannerPrompt, developerPrompt, testerPrompt] = await Promise.all([
    createPlannerPrompt(),
    createDeveloperPrompt(),
    createTesterPrompt(),
  ]);

  const runCommand = createRunCommandTool(approvalRef);

  const developerSubagent: SubAgent = {
    name: 'developer',
    description: 'Responsible for writing code to implement features and fix bugs.',
    systemPrompt: developerPrompt,
    model: `${config.developer.provider}:${config.developer.model}`,
    tools: [runCommand, deletePathTool],
  };

  const testerSubagent: SubAgent = {
    name: 'tester',
    description: 'Responsible for testing code to ensure it works correctly and meets requirements.',
    systemPrompt: testerPrompt,
    model: `${config.tester.provider}:${config.tester.model}`,
    tools: [runCommand, deletePathTool],
  };

  return createDeepAgent({
    name: 'planner',
    model: `${config.planner.provider}:${config.planner.model}`,
    systemPrompt: plannerPrompt,
    memory: ['/memory/index.md'],
    tools: [runCommand],
    checkpointer: new MemorySaver(),
    backend: () =>
      new CompositeBackend(new FilesystemBackend({rootDir: process.cwd()}), {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- CompositeBackend route prefix
        '/memory/': new FilesystemBackend({rootDir: memoryRootDir, virtualMode: true}),
      }),
    subagents: [developerSubagent, testerSubagent],
  });
}

function processStreamEvent(
  event: {event: string; data: Record<string, unknown>; metadata: Record<string, unknown>; name: string},
  callbacks: CodeAgentCallbacks,
): string {
  if (event.event === 'on_chat_model_stream' && hasContent(event.data?.chunk)) {
    const text = extractText(event.data.chunk.content);
    if (text) {
      callbacks.onText?.(text, resolveAgentName(event.metadata));
      return text;
    }
  }

  if (event.event === 'on_tool_start') {
    callbacks.onToolStart?.(event.name, resolveAgentName(event.metadata));
  }

  return '';
}

/**
 * Runs the code agent with streaming output via `streamEvents`. Captures
 * token-level LLM output and tool activity from both the planner and any
 * sub-agents, forwarding them through the provided callbacks.
 *
 * @returns The accumulated text output from the agent.
 */
export async function runCodeAgent(agent: CodeAgent, options: RunCodeAgentOptions): Promise<string> {
  const {input, threadId, callbacks, signal} = options;
  let fullText = '';

  const eventStream = agent.streamEvents(
    {messages: [new HumanMessage(input)]},
    {
      version: 'v2' as const,
      signal,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- LangGraph config key
      configurable: {thread_id: threadId},
    },
  );

  try {
    for await (const event of eventStream) {
      if (signal?.aborted) break;
      fullText += processStreamEvent(event, callbacks);
    }
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.startsWith('INTERRUPTED:'))) {
      throw new Error('INTERRUPTED: aborted', {cause: error});
    }

    throw error;
  }

  return fullText;
}
