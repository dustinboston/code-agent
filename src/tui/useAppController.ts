import React, { useState, useEffect, useCallback } from "react";
import { useApp, useInput, useStdout } from "ink";
import { randomUUID } from "crypto";
import chalk from "chalk";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { PineconeStore } from "@langchain/pinecone";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { ChatPromptTemplate } from "@langchain/core/prompts";
import { type DynamicStructuredTool } from "@langchain/core/tools";
import { createVectorStore } from "../retrieval/store.js";
import { createDeveloper, createPlanner, createTester } from "../generation/llm.js";
import { createTeamPrompt } from "../generation/prompt.js";
import { readFileTool, listDirectoryTool } from "../tools/filesystem.js";
import { ingestFile } from "../ingest/pipeline.js";
import type { AppState } from "./status.js";
import type { AppConfig, ChatMessage, RetrievalResult } from "../types.js";
import { ChatOpenAI } from "@langchain/openai";
import type { ChatGoogle } from "@langchain/google";
import { createSendMessageTool } from "../generation/runner.js";
import { processSlashCommand, type SlashCommandCallbacks } from "./commands.js";
import { printChatMessage } from "./format.js";

interface UseAppControllerProps {
  config: AppConfig;
}

export function useAppController({ config }: UseAppControllerProps) {
  const { exit } = useApp();
  const { write } = useStdout();

  // App lifecycle state
  const [appState, setAppState] = useState<AppState>("initializing");
  const [statusMsg, setStatusMsg] = useState("Connecting to Pinecone...");
  const [errorMsg, setErrorMsg] = useState("");

  // LangChain instances (initialized on mount)
  const [vectorStore, setVectorStore] = useState<PineconeStore | null>(null);
  const [llm, setLlm] = useState<Array<ChatAnthropic | ChatOpenAI | ChatGoogle>>([]);
  const [ragPrompt, setRagPrompt] = useState<ChatPromptTemplate | null>(null);

  // Chat state
  const [completedMessages, setCompletedMessages] = useState<ChatMessage[]>([]);
  const [currentSources, setCurrentSources] = useState<RetrievalResult[]>([]);
  const [lastSources, setLastSources] = useState<RetrievalResult[]>([]);

  // Text input
  const [input, setInput] = useState("");

  // Command approval queue
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ command: string; resolve: (approved: boolean) => void }>>([]);

  /**
   * Prompts the user for approval to run a command.
   * @param command - The command string that requires approval.
   * @returns A promise that resolves to `true` if approved, `false` otherwise.
   */
  const requestApproval = useCallback((command: string) => {
    return new Promise<boolean>((resolve) => {
      setPendingApprovals((prev) => [...prev, { command, resolve }]);
    });
  }, []);

  /**
   * Adds a system message to the chat history and displays it in the TUI.
   * @param content - The content of the system message.
   * @returns void
   */
  const addSystemMsg = useCallback((content: string) => {
    const msg: ChatMessage = {
      id: randomUUID(),
      role: "system" as const,
      content,
      timestamp: new Date().toISOString(),
    };
    printChatMessage(write, msg);
    setCompletedMessages((prev) => [...prev, msg].slice(-20));
  }, [write]);

  /**
   * Initializes the application for "team" mode, setting up the vector store
   * and multiple LLM instances (planner, developer, tester).
   * @returns Promise<void>
   */
  const createTeam = async () => {
    try {
      const store = await createVectorStore(config);
      const planner = createPlanner(config);
      const developer = createDeveloper(config);
      const tester = createTester(config);

      const prompt = createTeamPrompt();
      setVectorStore(store);
      setLlm([planner, developer, tester]);
      setRagPrompt(prompt);
      setAppState("idle");
      setStatusMsg("");
    } catch (err) {
      throw err;
    }
  };

  // ─── Initialization ────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      try {
        await createTeam();
      } catch (err) {
        setErrorMsg(`Initialization failed: ${err instanceof Error ? err.message : String(err)}`);
        setAppState("error");
      }
    }
    init();
  }, [config]);

  // ─── Error dismissal ───────────────────────────────────────────────────────

  // When in error state, TextInput is not mounted, so useInput captures Enter.
  useInput(
    (_, key) => {
      if (key.return) {
        setAppState("idle");
        setErrorMsg("");
      }
    },
    { isActive: appState === "error" },
  );

  // Command verification capturing
  useInput(
    (inputChars, key) => {
      if (pendingApprovals.length > 0) {
        const current = pendingApprovals[0];
        const lower = inputChars.toLowerCase();
        if (lower === "y") {
          current.resolve(true);
          setPendingApprovals((prev) => prev.slice(1));
        } else if (lower === "n" || key.return) {
          current.resolve(false);
          setPendingApprovals((prev) => prev.slice(1));
        }
      }
    },
    { isActive: pendingApprovals.length > 0 },
  );

  /**
   * Handles a chat query in "team" mode.
   * @param trimmedInput - The trimmed user input string.
   * @param chatHistory - The chat history for the LLM.
   * @returns Promise<void>
   */
  const handleTeamQuery = useCallback(async (trimmedInput: string, chatHistory: BaseMessage[]) => {
    setAppState("generating");
    setStatusMsg("Thinking...");

    try {
      const planner = llm[0] as ChatAnthropic | ChatOpenAI | ChatGoogle;
      const developer = llm[1] as ChatAnthropic | ChatOpenAI | ChatGoogle;
      const tester = llm[2] as ChatAnthropic | ChatOpenAI | ChatGoogle;
      const writeActivity = (line: string) => {
        write(chalk.dim(`    | ${line}`) + "\n");
      };
      const sendMessageTool = createSendMessageTool(developer, tester, setStatusMsg, writeActivity, requestApproval);
      const plannerTools: DynamicStructuredTool[] = [readFileTool, listDirectoryTool, sendMessageTool];
      const plannerWithTools = planner.bindTools(plannerTools);

      const promptMessages = await ragPrompt!.formatMessages({
        chat_history: chatHistory,
        input: trimmedInput,
      });

      const invokeMessages: BaseMessage[] = [...promptMessages];
      let fullText = "";

      while (true) {
        let accChunk: AIMessageChunk | null = null;
        let iterationText = "";
        let announcedTools = new Set<string>();

        const stream = await plannerWithTools.stream(invokeMessages);
        for await (const chunk of stream) {
          const c = chunk as AIMessageChunk;
          accChunk = accChunk ? (accChunk.concat(c) as AIMessageChunk) : c;

          if (c.tool_call_chunks) {
            for (const tcc of c.tool_call_chunks) {
              if (tcc.name && !announcedTools.has(tcc.index?.toString() ?? tcc.id ?? "")) {
                const key = tcc.index?.toString() ?? tcc.id ?? "";
                if (key) announcedTools.add(key);
                setStatusMsg(`Preparing ${tcc.name}...`);
              }
            }
          }

          const text =
            typeof c.content === "string"
              ? c.content
              : Array.isArray(c.content)
                ? c.content.map((p) => (typeof p === "string" ? p : "text" in p ? p.text : "")).join("")
                : "";
          iterationText += text;
          fullText += text;
        }

        if (!accChunk) break;

        // Write planner text from this iteration immediately so the user
        // can see intermediate planning messages before tool calls execute.
        if (iterationText.trim()) {
          const plannerMsg: ChatMessage = {
            id: randomUUID(),
            role: "assistant",
            content: iterationText,
            timestamp: new Date().toISOString(),
          };
          printChatMessage(write, plannerMsg);
          setCompletedMessages((prev) => [...prev, plannerMsg].slice(-20));
        }

        // Convert AIMessageChunk → AIMessage so Anthropic serializes tool_calls correctly
        invokeMessages.push(
          new AIMessage({
            content: accChunk.content,
            tool_calls: accChunk.tool_calls,
            additional_kwargs: accChunk.additional_kwargs,
            id: accChunk.id,
          }),
        );

        const toolCalls = accChunk.tool_calls ?? [];
        if (toolCalls.length === 0) break;

        setStatusMsg(`Using tools (${toolCalls.map((tc) => tc.name).join(", ")})...`);
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

      setAppState("idle");
      setStatusMsg("");
    } catch (err) {
      setErrorMsg(`Generation failed: ${err instanceof Error ? err.message : String(err)}`);
      setAppState("error");
    }
  }, [llm, ragPrompt, write, requestApproval, setAppState, setStatusMsg, setErrorMsg, setCompletedMessages]);

  /**
   * Handles the submission of user input, either as a chat message or a slash command.
   * @param value - The input string from the user.
   * @returns Promise<void>
   */
  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || appState !== "idle") return;

      setInput("");

      if (trimmed.startsWith("/")) {
        const commandCallbacks: SlashCommandCallbacks = {
          addSystemMsg,
          setCompletedMessages,
          setLastSources,
          setAppState,
          setStatusMsg,
          exit,
          lastSources, // Pass the current value of lastSources
        };
        await processSlashCommand(trimmed, config, commandCallbacks);
        return;
      }

      // 1. Add user message to the completed (Static) list
      const userMsg: ChatMessage = {
        id: randomUUID(),
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      printChatMessage(write, userMsg);
      setCompletedMessages((prev) => [...prev, userMsg].slice(-20));

      const chatHistory = completedMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)));

      await handleTeamQuery(trimmed, chatHistory);
    },
    [appState, completedMessages, addSystemMsg, setCompletedMessages, setLastSources, setAppState, setStatusMsg, exit, lastSources, config, write, handleTeamQuery],
  );

  return {
    appState,
    statusMsg,
    errorMsg,
    currentSources,
    input,
    pendingApprovals,
    setInput,
    handleSubmit,
  };
}
