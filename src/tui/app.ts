import * as readline from "readline/promises";
import { stdin, stdout } from "process";
import chalk from "chalk";
import { randomUUID } from "crypto";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { ChatPromptTemplate } from "@langchain/core/prompts";
import { type DynamicStructuredTool } from "@langchain/core/tools";
import { createDeveloper, createPlanner, createTester } from "../llm/llm.js";
import { createPlannerPrompt } from "../llm/prompt.js";
import { readFileTool, listDirectoryTool } from "../tools/filesystem.js";
import { createSendMessageTool, runAgentLoop } from "../llm/runner.js";
import { processSlashCommand } from "./commands.js";
import { printChatMessage } from "./format.js";
import type { AppConfig, ChatMessage } from "../types.js";
import type { ChatOpenAI } from "@langchain/openai";
import type { ChatGoogle } from "@langchain/google";
import type { Runnable } from "@langchain/core/runnables";

type AgentModel = ChatAnthropic | ChatOpenAI | ChatGoogle;

/**
 * @interface CliAppState
 * @description Defines the structure for the CLI application's state.
 * @property {("initializing" | "idle" | "generating" | "error" | "retrieving")} state - The current operational state of the application.
 * @property {string} statusMsg - A message indicating the current status or ongoing operation.
 * @property {string} errorMsg - An error message if the application is in an error state.
 * @property {Array<Runnable<any, any>>} llm - An array of language model instances used by the application.
 * @property {ChatPromptTemplate | null} chatPromptTemplate - The chat prompt template used for generating responses.
 * @property {ChatMessage[]} completedMessages - An array of messages that have been completed in the chat.
 */
interface CliAppState {
  state: "initializing" | "idle" | "generating" | "error" | "retrieving";
  statusMsg: string;
  errorMsg: string;
  llm: Array<AgentModel>;
  chatPromptTemplate: ChatPromptTemplate | null;
  completedMessages: ChatMessage[];
}

/**
 * @async
 * @function initializeApp
 * @description Initializes the CLI application by setting up the language models and chat prompt template.
 * @param {AppConfig} config - The application configuration object.
 * @returns {Promise<CliAppState>} A promise that resolves to the initialized application state.
 */
async function initializeApp(config: AppConfig): Promise<CliAppState> {
  const appState: CliAppState = {
    state: "initializing",
    statusMsg: "Initializing... ",
    errorMsg: "",
    llm: [],
    chatPromptTemplate: null,
    completedMessages: [],
  };

  try {
    const planner: AgentModel = createPlanner(config);
    const developer: AgentModel = createDeveloper(config);
    const tester: AgentModel = createTester(config);

    const prompt = await createPlannerPrompt();

    appState.llm = [planner, developer, tester];
    appState.chatPromptTemplate = prompt;
    appState.state = "idle";
    appState.statusMsg = "";
  } catch (err) {
    appState.errorMsg = `Initialization failed: ${err instanceof Error ? err.message : String(err)}`;
    appState.state = "error";
    console.error(chalk.red(appState.errorMsg));
  }
  return appState;
}

/**
 * @async
 * @function generateResponse
 * @description Generates a response from the language model based on user input and updates the application state.
 * @param trimmedInput - The user's trimmed input string.
 * @param appState - The current state of the CLI application.
 * @param rl - The readline interface for user interaction.
 * @param config - The application configuration object.
 * @returns A promise that resolves when the response generation is complete.
 */
async function generateResponse(
  trimmedInput: string,
  appState: CliAppState,
  rl: readline.Interface,
  config: AppConfig,
): Promise<void> {
  const requestApproval = (command: string) => {
    const patterns = config.allowedCommands.map((p) => new RegExp(p));
    if (patterns.some((re) => re.test(command))) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>(async (resolve) => {
      try {
        const answer = (
          await rl.question(chalk.yellow(`⚠  Agent wants to run: ${command} `) + chalk.dim("Allow? (Y/n) "))
        )
          .toLowerCase()
          .trim();
        resolve(answer === "y" || answer === "");
      } catch (err: any) {
        if (err?.code === "ABORT_ERR" || err?.name === "AbortError") {
          process.exit(0);
        }
        resolve(false);
      }
    });
  };

  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: trimmedInput,
    timestamp: new Date().toISOString(),
  };
  appState.completedMessages = [...appState.completedMessages, userMsg].slice(-20);

  // LangChain requires specific message classes, so we must map our internal ChatMessage objects to HumanMessage and AIMessage.
  const chatHistory = appState.completedMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)));

  // Lock the application state to prevent concurrent queries while the LLM is generating a response.

  appState.state = "generating";
  appState.statusMsg = "Processing...";

  try {
    const [planner, developer, tester] = appState.llm;
    const writeActivity = (line: string) => process.stdout.write(chalk.dim(`    | ${line}`) + "\n");
    const writeAgentMessage = async (agentName: string, text: string) => {
      const msg: ChatMessage = {
        id: randomUUID(),
        role: agentName.toLowerCase() as "developer" | "tester",
        content: text,
        timestamp: new Date().toISOString(),
      };
      printChatMessage(process.stdout.write.bind(process.stdout), msg);
      appState.completedMessages = [...appState.completedMessages, msg].slice(-20);
    };
    const sendMessageTool = createSendMessageTool(
      developer,
      tester,
      (msg) => {
        appState.statusMsg = msg;
      },
      writeActivity,
      requestApproval,
      writeAgentMessage,
    );
    const plannerTools: DynamicStructuredTool[] = [readFileTool, listDirectoryTool, sendMessageTool];
    const plannerWithTools = planner.bindTools(plannerTools);

    const promptMessages =
      (await appState.chatPromptTemplate?.formatMessages({
        chat_history: chatHistory,
        input: trimmedInput,
      })) ?? [];

    let invokeMessages: BaseMessage[] = [...promptMessages];

    process.stdout.write(chalk.dim("Processing...\n"));

    let headerWritten = false;

    invokeMessages = await runAgentLoop(plannerWithTools, invokeMessages, {
      onChunk: (c, iterationText) => {
        const text =
          typeof c.content === "string"
            ? c.content
            : Array.isArray(c.content)
              ? c.content.map((p) => (typeof p === "string" ? p : "text" in p ? p.text : "")).join("")
              : "";

        if (text) {
          if (!headerWritten) {
            process.stdout.write(
              chalk.bold.green("Planner") + chalk.dim(` [${new Date().toLocaleTimeString()}]`) + "\n  ",
            );
            headerWritten = true;
          }
          process.stdout.write(text.replace(/\n/g, "\n  "));
        }
      },
      onTurnComplete: async (accChunk, iterationText, currentInvokeMessages) => {
        if (headerWritten) {
          process.stdout.write("\n\n");
          headerWritten = false;
        }

        if (iterationText.trim()) {
          const plannerMsg: ChatMessage = {
            id: randomUUID(),
            role: "assistant",
            content: iterationText,
            timestamp: new Date().toISOString(),
          };
          appState.completedMessages = [...appState.completedMessages, plannerMsg].slice(-20);
        }
        return currentInvokeMessages;
      },
      onToolCall: (tc) => {
        if (
          tc.name === "send_message" &&
          tc.args &&
          typeof tc.args === "object" &&
          "id" in tc.args &&
          "message" in tc.args
        ) {
          const args = tc.args as { id: string; message: string };
          const target = args.id.charAt(0).toUpperCase() + args.id.slice(1);
          const m: ChatMessage = {
            id: randomUUID(),
            role: "system",
            content: `[Planner → ${target}]\n${args.message}`,
            timestamp: new Date().toISOString(),
          };
          printChatMessage(process.stdout.write.bind(process.stdout), m);
          appState.completedMessages = [...appState.completedMessages, m].slice(-20);
        }
      },
      onActivity: writeActivity,
      onStatus: (msg) => {
        appState.statusMsg = msg;
      },
      requestApproval: requestApproval,
      agentName: "Planner",
      agentTools: plannerTools,
    });

    appState.state = "idle";
    appState.statusMsg = "";
  } catch (err) {
    appState.errorMsg = `Generation failed: ${err instanceof Error ? err.message : String(err)}`;
    appState.state = "error";
    console.error(chalk.red(appState.errorMsg));
  }
}

/**
 * @async
 * @function startApp
 * @description Starts the main loop of the CLI application, handling user input and generating responses.
 * @param {AppConfig} config - The application configuration object.
 * @returns {Promise<void>} A promise that resolves when the application exits.
 */
export async function startApp(config: AppConfig) {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: stdin.isTTY ?? false,
    historySize: 1000,
  });
  rl.on("SIGINT", () => {
    process.exit(0);
  });

  const appState = await initializeApp(config);

  const addSystemMsg = async (content: string) => {
    const msg: ChatMessage = {
      id: randomUUID(),
      role: "system" as const,
      content,
      timestamp: new Date().toISOString(),
    };
    await printChatMessage(process.stdout.write.bind(process.stdout), msg);
    appState.completedMessages = [...appState.completedMessages, msg].slice(-20);
  };

  while (true) {
    if (appState.state === "error") {
      console.log(chalk.red(`Error: ${appState.errorMsg}`));
      let answer = "";
      try {
        answer = await rl.question(chalk.yellow("Press Enter to continue or /quit to exit..."));
      } catch (err: any) {
        if (err?.code === "ABORT_ERR" || err?.name === "AbortError") {
          break;
        }
        throw err;
      }
      if (answer.toLowerCase() === "/quit") {
        break;
      }
      appState.state = "idle";
      appState.errorMsg = "";
      continue;
    }

    if (appState.statusMsg) {
      console.log(chalk.dim(`Status: ${appState.statusMsg}`));
    }

    let input = "";
    try {
      input = await rl.question(chalk.bold.cyan("You:\n> "));
    } catch (err: any) {
      if (err?.code === "ABORT_ERR" || err?.name === "AbortError") {
        break;
      }
      throw err;
    }
    const trimmedInput = input.trim();

    if (!trimmedInput) {
      continue;
    }

    if (trimmedInput.startsWith("/")) {
      await processSlashCommand(trimmedInput, config, {
        addSystemMsg,
        setCompletedMessages: (messages) => {
          appState.completedMessages = messages;
        },
        exit: () => {
          rl.close();
          process.exit(0);
        },
      });
      continue;
    }

    await generateResponse(trimmedInput, appState, rl, config);
  }

  rl.close();
}
