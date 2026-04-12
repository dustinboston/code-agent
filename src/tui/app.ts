import process, {stdin, stdout} from 'node:process';
import * as readline from 'node:readline/promises';
import {randomUUID} from 'node:crypto';
import chalk from 'chalk';
import {HumanMessage, AIMessage, type AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import type {ChatAnthropic} from '@langchain/anthropic';
import type {ChatPromptTemplate} from '@langchain/core/prompts';
import {type DynamicStructuredTool} from '@langchain/core/tools';
import type {ChatOpenAI} from '@langchain/openai';
import type {ChatGoogle} from '@langchain/google';
import {createDeveloper, createPlanner, createTester} from '../llm/llm.js';
import {createPlannerPrompt} from '../llm/prompt.js';
import {readFileTool, listDirectoryTool} from '../tools/filesystem.js';
import {createSendMessageTool, runAgentLoop} from '../llm/runner.js';
import type {AppConfig, ChatMessage} from '../types.js';
import {processSlashCommand} from './commands.js';
import {printChatMessage} from './format.js';

type AgentModel = ChatAnthropic | ChatOpenAI | ChatGoogle;

type CliAppState = {
  state: 'initializing' | 'idle' | 'generating' | 'error' | 'retrieving';
  statusMsg: string;
  errorMsg: string;
  llm: AgentModel[];
  chatPromptTemplate: ChatPromptTemplate | undefined;
  completedMessages: ChatMessage[];
  abortController?: AbortController | undefined;
};

function writeToStdout(text: string): void {
  process.stdout.write(text);
}

async function initializeApp(config: AppConfig): Promise<CliAppState> {
  const appState: CliAppState = {
    state: 'initializing',
    statusMsg: 'Initializing... ',
    errorMsg: '',
    llm: [],
    chatPromptTemplate: undefined,
    completedMessages: [],
    abortController: undefined,
  };

  try {
    const planner: AgentModel = createPlanner(config);
    const developer: AgentModel = createDeveloper(config);
    const tester: AgentModel = createTester(config);

    const prompt = await createPlannerPrompt();

    appState.llm = [planner, developer, tester];
    appState.chatPromptTemplate = prompt;
    appState.state = 'idle';
    appState.statusMsg = '';
  } catch (error) {
    appState.errorMsg = `Initialization failed: ${error instanceof Error ? error.message : String(error)}`;
    appState.state = 'error';
    console.error(chalk.red(appState.errorMsg));
  }

  return appState;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || ('code' in error && error.code === 'ABORT_ERR'));
}

async function promptForApproval(rl: readline.Interface, command: string): Promise<boolean> {
  try {
    const rawAnswer = await rl.question(
      chalk.yellow(`⚠  Agent wants to run: ${command} `) + chalk.dim('Allow? (Y/n) '),
    );
    const answer = rawAnswer.toLowerCase().trim();
    return answer === 'y' || answer === '';
  } catch (error: unknown) {
    if (isAbortError(error)) {
      throw new Error('Process terminated by user', {cause: error});
    }

    return false;
  }
}

function buildRequestApproval(rl: readline.Interface, config: AppConfig) {
  return async (command: string): Promise<boolean> => {
    const patterns = config.allowedCommands.map((p) => new RegExp(p, 'v'));
    if (patterns.some((re) => re.test(command))) {
      return true;
    }

    return promptForApproval(rl, command);
  };
}

function extractText(content: AIMessageChunk['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : 'text' in p ? p.text : '')).join('');
  }

  return '';
}

function resolveAgentRole(agentName: string): 'developer' | 'tester' {
  const lower = agentName.toLowerCase();
  if (lower === 'developer' || lower === 'tester') return lower;
  return 'developer';
}

async function generateResponse(
  trimmedInput: string,
  appState: CliAppState,
  rl: readline.Interface,
  config: AppConfig,
): Promise<void> {
  appState.abortController = new AbortController();

  const requestApproval = buildRequestApproval(rl, config);

  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    content: trimmedInput,
    timestamp: new Date().toISOString(),
  };
  appState.completedMessages = [...appState.completedMessages, userMessage].slice(-20);

  const chatHistory = appState.completedMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)));

  appState.state = 'generating';
  appState.statusMsg = 'Processing...';

  try {
    const [planner, developer, tester] = appState.llm;
    const writeActivity = (line: string): void => {
      writeToStdout(chalk.dim(`    | ${line}`) + '\n');
    };

    const writeAgentMessage = async (agentName: string, text: string): Promise<void> => {
      const message: ChatMessage = {
        id: randomUUID(),
        role: resolveAgentRole(agentName),
        content: text,
        timestamp: new Date().toISOString(),
      };
      printChatMessage(writeToStdout, message);
      appState.completedMessages = [...appState.completedMessages, message].slice(-20);
    };

    const sendMessageTool = createSendMessageTool({
      developer,
      tester,
      onStatus(message) {
        appState.statusMsg = message;
      },
      onActivity: writeActivity,
      requestApproval,
      onAgentMessage: writeAgentMessage,
      signal: appState.abortController.signal,
    });
    const plannerTools: DynamicStructuredTool[] = [readFileTool, listDirectoryTool, sendMessageTool];
    const plannerWithTools = planner.bindTools(plannerTools);

    const promptMessages =
      (await appState.chatPromptTemplate?.formatMessages({
        // eslint-disable-next-line @typescript-eslint/naming-convention -- LangChain template variable
        chat_history: chatHistory,
        input: trimmedInput,
      })) ?? [];

    let invokeMessages: BaseMessage[] = [...promptMessages];

    writeToStdout(chalk.dim('Processing...\n'));

    let headerWritten = false;

    invokeMessages = await runAgentLoop(
      plannerWithTools,
      invokeMessages,
      {
        onChunk(c) {
          const text = extractText(c.content);
          if (text) {
            if (!headerWritten) {
              writeToStdout(chalk.bold.green('Planner') + chalk.dim(` [${new Date().toLocaleTimeString()}]`) + '\n  ');
              headerWritten = true;
            }

            writeToStdout(text.replaceAll('\n', '\n  '));
          }
        },
        async onTurnComplete(accChunk, iterationText, currentInvokeMessages) {
          if (headerWritten) {
            writeToStdout('\n\n');
            headerWritten = false;
          }

          if (iterationText.trim()) {
            const plannerMessage: ChatMessage = {
              id: randomUUID(),
              role: 'assistant',
              content: iterationText,
              timestamp: new Date().toISOString(),
            };
            appState.completedMessages = [...appState.completedMessages, plannerMessage].slice(-20);
          }

          return currentInvokeMessages;
        },
        onToolCall(tc) {
          if (
            tc.name === 'send_message' &&
            tc.args &&
            typeof tc.args === 'object' &&
            'id' in tc.args &&
            'message' in tc.args
          ) {
            const sendArgs = {
              id: String(tc.args.id),
              message: String(tc.args.message),
            };
            const target = sendArgs.id.charAt(0).toUpperCase() + sendArgs.id.slice(1);
            const m: ChatMessage = {
              id: randomUUID(),
              role: 'system',
              content: `[Planner → ${target}]\n${sendArgs.message}`,
              timestamp: new Date().toISOString(),
            };
            printChatMessage(writeToStdout, m);
            appState.completedMessages = [...appState.completedMessages, m].slice(-20);
          }
        },
        onActivity: writeActivity,
        onStatus(message) {
          appState.statusMsg = message;
        },
        requestApproval,
        agentName: 'Planner',
        agentTools: plannerTools,
      },
      appState.abortController.signal,
    );

    appState.state = 'idle';
    appState.statusMsg = '';
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('INTERRUPTED:')) {
      throw error;
    }

    const errorMessage = `Generation failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(chalk.red(errorMessage));
    appState.state = 'idle';
    appState.errorMsg = '';
  }
}

async function handleErrorState(appState: CliAppState, rl: readline.Interface): Promise<'continue' | 'break'> {
  console.log(chalk.red(`Error: ${appState.errorMsg}`));
  let answer = '';
  try {
    answer = await rl.question(chalk.yellow('Press Enter to continue or /quit to exit...'));
  } catch (error: unknown) {
    if (isAbortError(error)) {
      return 'break';
    }

    throw error;
  }

  if (answer.toLowerCase() === '/quit') {
    return 'break';
  }

  appState.state = 'idle';
  appState.errorMsg = '';
  return 'continue';
}

async function readUserInput(rl: readline.Interface): Promise<string | undefined> {
  try {
    const input = await rl.question(chalk.bold.cyan('You:\n> '));
    return input.trim();
  } catch (error: unknown) {
    if (isAbortError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function handleSlashCommand(
  trimmedInput: string,
  config: AppConfig,
  appState: CliAppState,
  rl: readline.Interface,
): Promise<void> {
  const addSystemMessage = async (content: string): Promise<void> => {
    const message: ChatMessage = {
      id: randomUUID(),
      role: 'system' as const,
      content,
      timestamp: new Date().toISOString(),
    };
    printChatMessage(writeToStdout, message);
    appState.completedMessages = [...appState.completedMessages, message].slice(-20);
  };

  await processSlashCommand(trimmedInput, config, {
    addSystemMsg: addSystemMessage,
    setCompletedMessages(messages) {
      appState.completedMessages = messages;
    },
    exit() {
      rl.close();
      throw new Error('EXIT');
    },
  });
}

async function handleGenerateWithInterrupt(
  trimmedInput: string,
  appState: CliAppState,
  rl: readline.Interface,
  config: AppConfig,
): Promise<void> {
  const addSystemMessage = async (content: string): Promise<void> => {
    const message: ChatMessage = {
      id: randomUUID(),
      role: 'system' as const,
      content,
      timestamp: new Date().toISOString(),
    };
    printChatMessage(writeToStdout, message);
    appState.completedMessages = [...appState.completedMessages, message].slice(-20);
  };

  const lineHandler = (line: string) => {
    const trimmed = line.trim();
    if (trimmed === '/stop') {
      appState.abortController?.abort(new Error('INTERRUPTED:'));
    }
  };

  rl.on('line', lineHandler);

  try {
    await generateResponse(trimmedInput, appState, rl, config);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('INTERRUPTED:')) {
      await addSystemMessage('[Interrupted by user]');
      appState.state = 'idle';
      appState.errorMsg = '';
    }
  } finally {
    rl.off('line', lineHandler);
    appState.abortController = undefined;
  }
}

async function replIteration(appState: CliAppState, rl: readline.Interface, config: AppConfig): Promise<void> {
  if (appState.state === 'error') {
    const result = await handleErrorState(appState, rl);
    if (result === 'break') return;
    return replIteration(appState, rl, config);
  }

  if (appState.statusMsg) {
    console.log(chalk.dim(`Status: ${appState.statusMsg}`));
  }

  const input = await readUserInput(rl);
  if (input === undefined || !input) {
    if (input === undefined) return;
    return replIteration(appState, rl, config);
  }

  if (input.startsWith('/')) {
    await handleSlashCommand(input, config, appState, rl);
    return replIteration(appState, rl, config);
  }

  await handleGenerateWithInterrupt(input, appState, rl, config);
  return replIteration(appState, rl, config);
}

export async function startApp(config: AppConfig): Promise<void> {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: stdin.isTTY ?? false,
    historySize: 1000,
  });
  rl.on('SIGINT', () => {
    rl.close();
    throw new Error('SIGINT');
  });

  const appState = await initializeApp(config);

  try {
    await replIteration(appState, rl, config);
  } catch (error) {
    if (error instanceof Error && (error.message === 'EXIT' || error.message === 'SIGINT')) {
      return;
    }

    throw error;
  } finally {
    rl.close();
  }
}
