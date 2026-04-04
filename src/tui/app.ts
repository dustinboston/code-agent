import * as readline from "readline/promises";
import { stdin, stdout } from "process";
import chalk from "chalk";
import { randomUUID } from "crypto";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { ChatPromptTemplate } from "@langchain/core/prompts";
import { type DynamicStructuredTool } from "@langchain/core/tools";
import { createDeveloper, createPlanner, createTester } from "../generation/llm.js";
import { createPlannerPrompt } from "../generation/prompt.js";
import { readFileTool, listDirectoryTool } from "../tools/filesystem.js";
import { createSendMessageTool } from "../generation/runner.js";
import { processSlashCommand } from "./commands.js";
import { printChatMessage } from "./format.js";
import type { AppConfig, ChatMessage, RetrievalResult } from "../types.js";
import type { ChatOpenAI } from "@langchain/openai";
import type { ChatGoogle } from "@langchain/google";

// Define a simple state type for the CLI application
interface CliAppState {
  state: "initializing" | "idle" | "generating" | "error" | "retrieving";
  statusMsg: string;
  errorMsg: string;
  llm: Array<ChatAnthropic | ChatOpenAI | ChatGoogle>;
  chatPromptTemplate: ChatPromptTemplate | null;
  completedMessages: ChatMessage[];
  lastSources: RetrievalResult[];
}

async function initializeApp(config: AppConfig): Promise<CliAppState> {
  const appState: CliAppState = {
    state: "initializing",
    statusMsg: "Initializing... ",
    errorMsg: "",
    llm: [],
    chatPromptTemplate: null,
    completedMessages: [],
    lastSources: [],
  };

  try {
    const planner = createPlanner(config);
    const developer = createDeveloper(config);
    const tester = createTester(config);

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

async function generateResponse(
  trimmedInput: string,
  appState: CliAppState,
  rl: readline.Interface,
  config: AppConfig,
) {
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

    const invokeMessages: BaseMessage[] = [...promptMessages];

    process.stdout.write(chalk.dim("Processing...\n"));
    while (true) {
      const allChunks: AIMessageChunk[] = [];
      let iterationText = "";
      let announcedTools = new Set<string>();
      let headerWritten = false;

      const stream = await plannerWithTools.stream(invokeMessages);
      for await (const chunk of stream) {
        const c = chunk as AIMessageChunk;
        allChunks.push(c);

        if (c.tool_call_chunks) {
          for (const tcc of c.tool_call_chunks) {
            if (tcc.name && !announcedTools.has(tcc.index?.toString() ?? tcc.id ?? "")) {
              const key = tcc.index?.toString() ?? tcc.id ?? "";
              if (key) announcedTools.add(key);
              appState.statusMsg = `Preparing ${tcc.name}...`;
            }
          }
        }

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
          iterationText += text;
        }
      }

      if (headerWritten) {
        process.stdout.write("\n\n");
      }

      const accChunk = allChunks.length > 0 ? allChunks.reduce((acc, c) => acc.concat(c) as AIMessageChunk) : null;
      if (!accChunk) break;

      if (iterationText.trim()) {
        const plannerMsg: ChatMessage = {
          id: randomUUID(),
          role: "assistant",
          content: iterationText,
          timestamp: new Date().toISOString(),
        };
        appState.completedMessages = [...appState.completedMessages, plannerMsg].slice(-20);
      }

      invokeMessages.push(
        new AIMessage({
          content: accChunk.content,
          tool_calls: accChunk.tool_calls,
          additional_kwargs: accChunk.additional_kwargs,
          id: accChunk.id,
        }),
      );

      const toolCalls = accChunk.tool_calls ?? [];
      if (toolCalls.length === 0) break; // Exit loop if no tool calls are made

      appState.statusMsg = `Using tools (${toolCalls.map((tc) => tc.name).join(", ")})...`;

      for (const tc of toolCalls) {
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
      }

      const toolMessages = await Promise.all(
        toolCalls.map(async (toolCall) => {
          if (toolCall.name !== "send_message") {
            const argsSummary = Object.entries(toolCall.args ?? {})
              .map(([k, v]) => {
                const s = typeof v === "string" ? v : JSON.stringify(v);
                return `${k}: ${s.length > 60 ? s.slice(0, 57) + "..." : s}`;
              })
              .join(", ");
            writeActivity(`Planner: ${toolCall.name}(${argsSummary})`);
          }
          const toolFn = plannerTools.find((t) => t.name === toolCall.name);
          let toolMsg: ToolMessage;

          if (!toolFn) {
            toolMsg = new ToolMessage({
              content: `Unknown tool: ${toolCall.name}`,
              tool_call_id: toolCall.id ?? randomUUID(),
              name: toolCall.name,
            });
          } else {
            try {
              toolMsg = (await toolFn.invoke(toolCall)) as ToolMessage;
            } catch (e) {
              toolMsg = new ToolMessage({
                content: `Tool error: ${e instanceof Error ? e.message : String(e)}`,
                tool_call_id: toolCall.id ?? randomUUID(),
                name: toolCall.name,
              });
            }
          }
          return toolMsg;
        }),
      );
      invokeMessages.push(...toolMessages);
    }

    appState.state = "idle";
    appState.statusMsg = "";
  } catch (err) {
    appState.errorMsg = `Generation failed: ${err instanceof Error ? err.message : String(err)}`;
    appState.state = "error";
    console.error(chalk.red(appState.errorMsg));
  }
}

export async function startApp(config: AppConfig) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
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
        setLastSources: (sources) => {
          appState.lastSources = sources;
        },
        setAppState: (state) => {
          appState.state = state;
        },
        setStatusMsg: (msg) => {
          appState.statusMsg = msg;
        },
        exit: () => {
          rl.close();
          process.exit(0);
        },
        lastSources: appState.lastSources,
      });
      continue;
    }

    await generateResponse(trimmedInput, appState, rl, config);
  }

  rl.close();
}
