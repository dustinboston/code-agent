import process, {stdin, stdout} from 'node:process';
import * as readline from 'node:readline/promises';
import {randomUUID} from 'node:crypto';
import chalk from 'chalk';
import {
  type ApprovalRef,
  type CodeAgent,
  type RunCodeAgentOptions,
  createCodeAgent,
  runCodeAgent,
} from '../llm/darunner.js';
import type {AppConfig, ChatMessage} from '../types.js';
import {processSlashCommand} from './commands.js';
import {printChatMessage} from './format.js';

type CliAppState = {
  state: 'initializing' | 'idle' | 'generating' | 'error';
  statusMsg: string;
  errorMsg: string;
  agent: CodeAgent | undefined;
  approvalRef: ApprovalRef;
  completedMessages: ChatMessage[];
  abortController?: AbortController | undefined;
  threadId: string;
};

function writeToStdout(text: string): void {
  process.stdout.write(text);
}

async function initializeApp(config: AppConfig, approvalRef: ApprovalRef): Promise<CliAppState> {
  const appState: CliAppState = {
    state: 'initializing',
    statusMsg: 'Initializing...',
    errorMsg: '',
    agent: undefined,
    approvalRef,
    completedMessages: [],
    abortController: undefined,
    threadId: randomUUID(),
  };

  try {
    appState.agent = await createCodeAgent(config, approvalRef);
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

function resolveAgentColor(agentName: string): (text: string) => string {
  const lower = agentName.toLowerCase();
  if (lower === 'developer') return chalk.bold.blue;
  if (lower === 'tester') return chalk.bold.magenta;
  return chalk.bold.green;
}

async function generateResponse(
  trimmedInput: string,
  appState: CliAppState,
  rl: readline.Interface,
  config: AppConfig,
): Promise<void> {
  appState.abortController = new AbortController();
  appState.approvalRef.requestApproval = buildRequestApproval(rl, config);

  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    content: trimmedInput,
    timestamp: new Date().toISOString(),
  };
  appState.completedMessages = [...appState.completedMessages, userMessage].slice(-20);

  appState.state = 'generating';
  appState.statusMsg = 'Processing...';

  try {
    writeToStdout(chalk.dim('Processing...\n'));

    let currentSpeaker = '';

    const agentOptions: RunCodeAgentOptions = {
      input: trimmedInput,
      threadId: appState.threadId,
      signal: appState.abortController.signal,
      callbacks: {
        onText(text, agentName) {
          if (agentName !== currentSpeaker) {
            if (currentSpeaker) writeToStdout('\n\n');
            currentSpeaker = agentName;
            const label = agentName.charAt(0).toUpperCase() + agentName.slice(1);
            const colorFn = resolveAgentColor(agentName);
            writeToStdout(colorFn(label) + chalk.dim(` [${new Date().toLocaleTimeString()}]`) + '\n  ');
          }

          writeToStdout(text.replaceAll('\n', '\n  '));
        },
        onToolStart(toolName, agentName) {
          if (currentSpeaker) {
            writeToStdout('\n\n');
            currentSpeaker = '';
          }

          const label = agentName.charAt(0).toUpperCase() + agentName.slice(1);
          writeToStdout(chalk.dim(`    | ${label}: ${toolName}...`) + '\n');
        },
        onStatus(message) {
          appState.statusMsg = message;
        },
      },
    };

    const fullText = await runCodeAgent(appState.agent!, agentOptions);

    if (currentSpeaker) writeToStdout('\n\n');

    if (fullText.trim()) {
      const assistantMessage: ChatMessage = {
        id: randomUUID(),
        role: 'assistant',
        content: fullText,
        timestamp: new Date().toISOString(),
      };
      appState.completedMessages = [...appState.completedMessages, assistantMessage].slice(-20);
    }

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
      if (messages.length === 0) {
        appState.threadId = randomUUID();
      }
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

  const approvalRef: ApprovalRef = {};
  const appState = await initializeApp(config, approvalRef);

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
