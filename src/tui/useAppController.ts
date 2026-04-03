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
import { createPlannerPrompt } from "../generation/prompt.js";
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

/**
 * A React hook that provides the core application logic and state management for the
 * conversational AI TUI. It handles initialization, user input processing,
 * interaction with LangChain components (LLMs, vector store, prompts),
 * tool execution, and managing the chat history and application state.
 *
 * @param config - The application configuration object.
 * @returns An object containing various state variables and functions to interact with the app.
 */
export function useAppController({ config }: UseAppControllerProps) {
  const { exit } = useApp();
  const { write } = useStdout();

  // App lifecycle state
  // appState: Manages the current operational state of the application (e.g., "initializing", "idle", "generating", "error").
  const [appState, setAppState] = useState<AppState>("initializing");
  // statusMsg: Displays short, transient status messages to the user (e.g., "Processing...", "Preparing tool...").
  const [statusMsg, setStatusMsg] = useState("Initializing...");
  // errorMsg: Stores any error messages that occur, triggering an error display state.
  const [errorMsg, setErrorMsg] = useState("");

  // LangChain instances (initialized on mount)
  // vectorStore: The Pinecone vector store instance used for retrieval-augmented generation (RAG).
  const [vectorStore, setVectorStore] = useState<PineconeStore | null>(null);
  // llm: An array of LangChain LLM instances, typically including a planner, developer, and tester LLM.
  const [llm, setLlm] = useState<Array<ChatAnthropic | ChatOpenAI | ChatGoogle>>([]);
  // chatPromptTemplate: The LangChain chat prompt template used to format messages for the LLM, incorporating chat history and retrieved context.
  const [chatPromptTemplate, setChatPromptTemplate] = useState<ChatPromptTemplate | null>(null);

  // Chat state
  // completedMessages: An array of ChatMessage objects representing the full chat history displayed to the user.
  const [completedMessages, setCompletedMessages] = useState<ChatMessage[]>([]);
  // currentSources: Stores the retrieval results (sources) for the currently active query.
  const [currentSources, setCurrentSources] = useState<RetrievalResult[]>([]);
  // lastSources: Stores the retrieval results from the *previous* query, useful for commands like /sources.
  const [lastSources, setLastSources] = useState<RetrievalResult[]>([]);

  // Text input
  // input: The current value of the user's text input field.
  const [input, setInput] = useState("");

  // Command approval queue
  // pendingApprovals: A queue of commands that require user approval before execution, typically for sensitive operations.
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
   * Initializes the application. This involves:
   * 1. Creating and setting up the Pinecone vector store for document retrieval.
   * 2. Instantiating multiple LLM models (planner, developer, tester) based on the configuration.
   * 3. Creating the RAG prompt template used for guiding the LLMs.
   * 4. Updating the application state to "idle" once initialization is complete.
   * @returns Promise<void>
   */
  const initialize = async () => {
    try {
      const store = await createVectorStore(config);
      const planner = createPlanner(config);
      const developer = createDeveloper(config);
      const tester = createTester(config);
      const prompt = createPlannerPrompt();

      setVectorStore(store);
      setLlm([planner, developer, tester]);
      setChatPromptTemplate(prompt);
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
        await initialize();
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
   * Handles a user query by orchestrating the LLM (planner) to generate responses
   * and execute tools. This function implements the main event loop for a single query.
   *
   * The process involves:
   * 1. Setting the application state to "generating".
   * 2. Preparing the planner LLM with available tools (filesystem, send message).
   * 3. Formatting the prompt messages, including chat history and user input.
   * 4. Entering a `while (true)` loop to continuously stream responses from the planner.
   *    a. It streams `AIMessageChunk`s, accumulating them into `accChunk`.
   *    b. It updates the status message when tool calls are detected (e.g., "Preparing readFile...").
   *    c. It extracts and accumulates text content from the chunks to display intermediate planner thoughts.
   * 5. After each stream iteration, if there's accumulated text, it's displayed as a planner message.
   * 6. `AIMessageChunk` is converted to `AIMessage` before being added to `invokeMessages`.
   *    This is crucial because some LLMs (like Anthropic) require `tool_calls` to be
   *    fully formed on an `AIMessage` for correct serialization and subsequent tool execution.
   * 7. If tool calls are present, their execution is initiated in parallel using `Promise.all`.
   *    The status message is updated to reflect the tools being used.
   * 8. The results of the tool calls are added back to `invokeMessages` as `ToolMessage`s.
   * 9. The loop continues until the planner generates a response without any new tool calls.
   * 10. Finally, the application state is reset to "idle".
   *
   * @param trimmedInput - The trimmed user input string.
   * @param chatHistory - The chat history for the LLM, mapped to LangChain `BaseMessage`s.
   * @returns Promise<void>
   */
  const handleQuery = useCallback(async (trimmedInput: string, chatHistory: BaseMessage[]) => {
    setAppState("generating");
    setStatusMsg("Processing...");

    try {
      const [planner, developer, tester] = llm;
      const writeActivity = (line: string) => write(chalk.dim(`    | ${line}`) + "\n");
      const writeAgentMessage = (agentName: string, text: string) => {
        const msg: ChatMessage = {
          id: randomUUID(),
          role: agentName.toLowerCase() as "developer" | "tester",
          content: text,
          timestamp: new Date().toISOString(),
        };
        printChatMessage(write, msg);
        setCompletedMessages((prev) => [...prev, msg].slice(-20));
      };
      const sendMessageTool = createSendMessageTool(developer, tester, setStatusMsg, writeActivity, requestApproval, writeAgentMessage);
      const plannerTools: DynamicStructuredTool[] = [readFileTool, listDirectoryTool, sendMessageTool];
      const plannerWithTools = planner.bindTools(plannerTools);

      const promptMessages = await chatPromptTemplate?.formatMessages({
        chat_history: chatHistory,
        input: trimmedInput,
      }) ?? [];

      const invokeMessages: BaseMessage[] = [...promptMessages];
      let fullText = "";

      // Main event loop: Continuously stream responses from the planner LLM,
      // execute tools, and feed results back until a final answer is reached.
      while (true) {
        let accChunk: AIMessageChunk | null = null;
        let iterationText = "";
        let announcedTools = new Set<string>();

        // Stream the response from the planner LLM
        const stream = await plannerWithTools.stream(invokeMessages);
        for await (const chunk of stream) {
          const c = chunk as AIMessageChunk;
          // Accumulate chunks to form a complete message and extract tool calls
          accChunk = accChunk ? (accChunk.concat(c) as AIMessageChunk) : c;

          if (c.tool_call_chunks) {
            for (const tcc of c.tool_call_chunks) {
              // Update status message when a new tool call is identified
              if (tcc.name && !announcedTools.has(tcc.index?.toString() ?? tcc.id ?? "")) {
                const key = tcc.index?.toString() ?? tcc.id ?? "";
                if (key) announcedTools.add(key);
                setStatusMsg(`Preparing ${tcc.name}...`);
              }
            }
          }

          // Extract text content from the chunk for display
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

        // Convert AIMessageChunk → AIMessage so Anthropic serializes tool_calls correctly.
        // This conversion is necessary because some LLM providers (like Anthropic) expect
        // `tool_calls` to be fully formed on an `AIMessage` object when passed back
        // into the chat history for subsequent turns, rather than as partial `tool_call_chunks`.
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

        setStatusMsg(`Using tools (${toolCalls.map((tc) => tc.name).join(", ")})...`);
        // Execute tool calls in parallel and collect their results
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
                // Invoke the tool with its arguments
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
        // Add tool execution results back to the invokeMessages for the next LLM turn
        invokeMessages.push(...toolMessages);
      }

      setAppState("idle");
      setStatusMsg("");
    } catch (err) {
      setErrorMsg(`Generation failed: ${err instanceof Error ? err.message : String(err)}`);
      setAppState("error");
    }
  }, [llm, chatPromptTemplate, write, requestApproval, setAppState, setStatusMsg, setErrorMsg, setCompletedMessages]);

  /**
   * Handles the submission of user input, either as a chat message or a slash command.
   *
   * 1. Trims the input and checks if the app is in an "idle" state.
   * 2. Clears the input field.
   * 3. **Slash Command Handling:** If the input starts with "/", it's treated as a slash command.
   *    The `processSlashCommand` function is called with the command and a set of callbacks
   *    to interact with the app's state.
   * 4. **Regular Query Handling:** If it's not a slash command:
   *    a. The user's message is added to the `completedMessages` chat history and displayed.
   *    b. The `completedMessages` array is filtered to include only "user" and "assistant" roles,
   *       and then **mapped to LangChain `BaseMessage` objects** (`HumanMessage` or `AIMessage`).
   *       This conversion is necessary because LangChain's LLM chains expect specific
   *       message types for their `chat_history` input.
   *    c. The `handleQuery` function is then called with the trimmed input and the prepared
   *       chat history to initiate the LLM generation process.
   *
   * @param value - The input string from the user.
   * @returns Promise<void>
   */
  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || appState !== "idle") return;

      setInput("");

      // Handle slash commands
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

      // Map internal ChatMessage objects to LangChain's BaseMessage format
      // for compatibility with the LLM's chat history input.
      const chatHistory = completedMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)));

      await handleQuery(trimmed, chatHistory);
    },
    [appState, completedMessages, addSystemMsg, setCompletedMessages, setLastSources, setAppState, setStatusMsg, exit, lastSources, config, write, handleQuery],
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
