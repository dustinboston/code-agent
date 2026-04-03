import * as readline from "readline/promises";
import { stdin, stdout } from "process";
import chalk from "chalk";
import { randomUUID } from "crypto";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { PineconeStore } from "@langchain/pinecone";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { ChatPromptTemplate } from "@langchain/core/prompts";
import { type DynamicStructuredTool } from "@langchain/core/tools";
import { createVectorStore } from "../retrieval/store.js";
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
  vectorStore: PineconeStore | null;
  llm: Array<ChatAnthropic | ChatOpenAI | ChatGoogle>;
  chatPromptTemplate: ChatPromptTemplate | null;
  completedMessages: ChatMessage[];
  lastSources: RetrievalResult[];
  pendingApprovals: Array<{ command: string; resolve: (approved: boolean) => void }>;
}

export async function startApp(config: AppConfig) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  rl.on("SIGINT", () => {
    process.exit(0);
  });

  const appState: CliAppState = {
    state: "initializing",
    statusMsg: "Initializing... ",
    errorMsg: "",
    vectorStore: null,
    llm: [],
    chatPromptTemplate: null,
    completedMessages: [],
    lastSources: [],
    pendingApprovals: [],
  };

  const addSystemMsg = (content: string) => {
    const msg: ChatMessage = {
      id: randomUUID(),
      role: "system" as const,
      content,
      timestamp: new Date().toISOString(),
    };
    printChatMessage(process.stdout.write.bind(process.stdout), msg);
    appState.completedMessages = [...appState.completedMessages, msg].slice(-20);
  };

  const requestApproval = (command: string) => {
    return new Promise<boolean>(async (resolve) => {
      try {
        const answer = (await rl.question(
          chalk.yellow(`⚠ Agent wants to run:\n${command}\n`) + chalk.dim("Allow? (y/N) "),
        )).toLowerCase();
        resolve(answer === "y");
      } catch (err: any) {
        if (err?.code === "ABORT_ERR" || err?.name === "AbortError") {
          process.exit(0);
        }
        resolve(false);
      }
    });
  };

  // Initialization logic
  try {
    const store = await createVectorStore(config);
    const planner = createPlanner(config);
    const developer = createDeveloper(config);
    const tester = createTester(config);
    const prompt = createPlannerPrompt();

    appState.vectorStore = store;
    appState.llm = [planner, developer, tester];
    appState.chatPromptTemplate = prompt;
    appState.state = "idle";
    appState.statusMsg = "";
  } catch (err) {
    appState.errorMsg = `Initialization failed: ${err instanceof Error ? err.message : String(err)}`;
    appState.state = "error";
    console.error(chalk.red(appState.errorMsg));
    rl.close();
    return;
  }

  // Main CLI loop
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

    // Handle slash commands
    if (trimmedInput.startsWith("/")) {
      await processSlashCommand(trimmedInput, config, {
        addSystemMsg,
        setCompletedMessages: (messages) => { appState.completedMessages = messages; },
        setLastSources: (sources) => { appState.lastSources = sources; },
        setAppState: (state) => { appState.state = state; },
        setStatusMsg: (msg) => { appState.statusMsg = msg; },
        exit: () => { rl.close(); process.exit(0); },
        lastSources: appState.lastSources,
      });
      continue;
    }

    // Regular query handling
    const userMsg: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: trimmedInput,
      timestamp: new Date().toISOString(),
    };
    printChatMessage(process.stdout.write.bind(process.stdout), userMsg);
    appState.completedMessages = [...appState.completedMessages, userMsg].slice(-20);

    // Map internal ChatMessage objects to LangChain's BaseMessage format
    const chatHistory = appState.completedMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)));

    // handleQuery logic (adapted from useAppController)
    appState.state = "generating";
    appState.statusMsg = "Processing...";

    try {
      const [planner, developer, tester] = appState.llm;
      const writeActivity = (line: string) => process.stdout.write(chalk.dim(`    | ${line}`) + "\n");
      const writeAgentMessage = (agentName: string, text: string) => {
        const msg: ChatMessage = {
          id: randomUUID(),
          role: agentName.toLowerCase() as "developer" | "tester",
          content: text,
          timestamp: new Date().toISOString(),
        };
        printChatMessage(process.stdout.write.bind(process.stdout), msg);
        appState.completedMessages = [...appState.completedMessages, msg].slice(-20);
      };
      const sendMessageTool = createSendMessageTool(developer, tester, (msg) => { appState.statusMsg = msg; }, writeActivity, requestApproval, writeAgentMessage);
      const plannerTools: DynamicStructuredTool[] = [readFileTool, listDirectoryTool, sendMessageTool];
      const plannerWithTools = planner.bindTools(plannerTools);

      const promptMessages = await appState.chatPromptTemplate?.formatMessages({
        chat_history: chatHistory,
        input: trimmedInput,
      }) ?? [];

      const invokeMessages: BaseMessage[] = [...promptMessages];
      let fullText = ""; // Not strictly needed for display in this CLI, but kept for consistency

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
                chalk.bold.green("Assistant") + chalk.dim(` [${new Date().toLocaleTimeString()}]`) + "\n  ",
              );
              headerWritten = true;
            }
            process.stdout.write(text.replace(/\n/g, "\n  "));
            iterationText += text;
            fullText += text;
          }
        }

        if (headerWritten) {
          process.stdout.write("\n\n");
        }

        const accChunk = allChunks.length > 0
          ? allChunks.reduce((acc, c) => acc.concat(c) as AIMessageChunk)
          : null;
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
        const toolMessages = await Promise.all(
          toolCalls.map(async (toolCall) => {
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
          })
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

  rl.close();
}
