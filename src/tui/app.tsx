/**
 * @module tui/app
 *
 * Root Ink component for the RAG Starter TUI. Manages the full application
 * lifecycle — Pinecone / LLM initialisation, user input handling, slash
 * commands, RAG retrieval, LLM streaming, and the multi-agent "team" mode
 * where a planner delegates to developer and tester sub-agents.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { randomUUID } from "crypto";
import chalk from "chalk";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { PineconeStore } from "@langchain/pinecone";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { createVectorStore } from "../retrieval/store.js";
import { retrieve } from "../retrieval/retriever.js";
import { createDeveloper, createLLM, createPlanner, createTester } from "../generation/llm.js";
import { createChatPrompt, createDeveloperPrompt, createTesterPrompt, createTeamPrompt } from "../generation/prompt.js";
import { filesystemTools, readFileTool, listDirectoryTool, writeFileTool } from "../tools/filesystem.js";
import { runCommandTool } from "../tools/shell.js";
import { ingestFile } from "../ingest/pipeline.js";
import { StatusBar, type AppState } from "./status.js";
import type { AppConfig, ChatMessage, RetrievalResult } from "../types.js";
import { ChatOpenAI } from "@langchain/openai";
import type { ChatGoogle } from "@langchain/google";

// ─── Sub-agent runner ──────────────────────────────────────────────────────────

/**
 * Runs a single sub-agent (developer or tester) in an agentic tool-use loop.
 *
 * Each iteration streams one LLM response. If the response contains tool
 * calls, every tool is invoked and its result is appended to the message
 * history before the next iteration begins. The loop exits when the model
 * produces a response with no tool calls — i.e. it has finished its task and
 * is reporting back in plain text.
 *
 * @param agent - The LLM instance that powers this sub-agent.
 * @param agentTools - Array of LangChain tools the agent is allowed to call.
 * @param promptFn - Factory that returns the agent's system prompt template.
 * @param message - The task description from the planner.
 * @param onStatus - Callback invoked to update the TUI status bar.
 * @param agentName - Display name used in status and activity messages.
 * @param onActivity - Optional callback for detailed activity log lines.
 * @returns The full concatenated text the agent produced across all iterations.
 */
async function runSubAgent(
  agent: ChatAnthropic | ChatOpenAI | ChatGoogle,
  agentTools: typeof filesystemTools,
  promptFn: () => ReturnType<typeof createDeveloperPrompt>,
  message: string,
  onStatus: (msg: string) => void,
  agentName: string,
  onActivity?: (line: string) => void,
  requestApproval?: (command: string) => Promise<boolean>,
): Promise<string> {
  const agentWithTools = agent.bindTools(agentTools);
  const prompt = promptFn();
  const promptMessages = await prompt.formatMessages({ input: message });
  const invokeMessages: BaseMessage[] = [...promptMessages];
  let fullText = "";

  while (true) {
    // Stream one LLM turn, accumulating chunks into a single AIMessageChunk
    // so we can inspect tool_calls after the stream ends.
    let accChunk: AIMessageChunk | null = null;
    let iterText = "";
    let announcedTools = new Set<string>();
    const stream = await agentWithTools.stream(invokeMessages);
    for await (const chunk of stream) {
      const c = chunk as AIMessageChunk;
      accChunk = accChunk ? (accChunk.concat(c) as AIMessageChunk) : c;

      if (c.tool_call_chunks && onActivity) {
        for (const tcc of c.tool_call_chunks) {
          if (tcc.name && !announcedTools.has(tcc.index?.toString() ?? tcc.id ?? "")) {
            const key = tcc.index?.toString() ?? tcc.id ?? "";
            if (key) announcedTools.add(key);
            onActivity(`${agentName} preparing ${tcc.name}...`);
          }
        }
      }

      const text =
        typeof c.content === "string"
          ? c.content
          : Array.isArray(c.content)
            ? c.content.map((p) => (typeof p === "string" ? p : "text" in p ? p.text : "")).join("")
            : "";
      iterText += text;
      fullText += text;
    }

    if (!accChunk) break;

    // Surface agent text to the activity log (truncated for readability)
    if (onActivity && iterText.trim()) {
      const preview = iterText.trim().replace(/\n/g, " ");
      onActivity(`${agentName}: ${preview.length > 120 ? preview.slice(0, 117) + "..." : preview}`);
    }

    // Append the assistant turn. AIMessageChunk must be converted to AIMessage
    // so Anthropic serializes tool_calls in the expected format.
    invokeMessages.push(
      new AIMessage({
        content: accChunk.content,
        tool_calls: accChunk.tool_calls,
        additional_kwargs: accChunk.additional_kwargs,
        id: accChunk.id,
      }),
    );

    const toolCalls = accChunk.tool_calls ?? [];
    if (toolCalls.length === 0) break; // no tool calls → agent is done

    onStatus(`${agentName} using tools (${toolCalls.map((tc) => tc.name).join(", ")})...`);
    const toolMessages = await Promise.all(
      toolCalls.map(async (toolCall) => {
        if (onActivity) {
          const argsSummary = Object.entries(toolCall.args ?? {})
            .filter(([k]) => !(toolCall.name === "write_file" && k === "content"))
            .map(([k, v]) => {
              const s = typeof v === "string" ? v : JSON.stringify(v);
              return `${k}: ${s.length > 60 ? s.slice(0, 57) + "..." : s}`;
            })
            .join(", ");
          onActivity(`${agentName} → ${toolCall.name}(${argsSummary})`);
        }
        const toolFn = agentTools.find((t) => t.name === toolCall.name);
        let toolMsg: ToolMessage;

        if (toolCall.name === "run_command" && requestApproval) {
          const approved = await requestApproval((toolCall.args as any).command || "");
          if (!approved) {
            const deniedMsg = "Error: User denied execution of this command.";
            if (onActivity) onActivity(chalk.red(`    ⚠ ${deniedMsg}`));
            return new ToolMessage({
              content: deniedMsg,
              tool_call_id: toolCall.id ?? randomUUID(),
              name: toolCall.name,
            });
          }
        }

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
            // Return the error as a ToolMessage so the agent can self-correct
            // rather than crashing the whole team loop.
            const errorMsg = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
            if (onActivity) onActivity(chalk.red(`    ⚠ ${errorMsg.slice(0, 500)}`));
            toolMsg = new ToolMessage({
              content: errorMsg,
              tool_call_id: toolCall.id ?? randomUUID(),
              name: toolCall.name,
            });
          }
        }
        
        if (
          typeof toolMsg.content === "string" && 
          (toolMsg.content.startsWith("Error ") || toolMsg.content.startsWith("Tool error:"))
        ) {
          if (onActivity) onActivity(chalk.red(`    ⚠ ${toolMsg.content.slice(0, 150)}`));
        }

        return toolMsg;
      })
    );
    invokeMessages.push(...toolMessages);
  }

  return fullText;
}

// ─── send_message tool factory ────────────────────────────────────────────────

/**
 * Creates the `send_message` LangChain tool that the planner uses to delegate
 * work to sub-agents.
 *
 * When the planner calls `send_message({ id: "developer", message: "…" })`,
 * this tool spins up the corresponding sub-agent's agentic loop via
 * {@link runSubAgent} and returns the result as a JSON string. The planner
 * then decides whether to call the tester, ask a follow-up, or report back
 * to the user.
 *
 * **Tool access by role:**
 * - **developer** — `read_file`, `list_directory`, `write_file`
 * - **tester** — `read_file`, `list_directory`, `write_file`, `run_command`
 *
 * @param developer - LLM instance for the developer sub-agent.
 * @param tester - LLM instance for the tester sub-agent.
 * @param onStatus - Callback invoked to update the TUI status bar.
 * @param onActivity - Optional callback for detailed activity log lines.
 * @returns A LangChain `DynamicStructuredTool` that the planner can call.
 */
function createSendMessageTool(
  developer: ChatAnthropic | ChatOpenAI | ChatGoogle,
  tester: ChatAnthropic | ChatOpenAI | ChatGoogle,
  onStatus: (msg: string) => void,
  onActivity?: (line: string) => void,
  requestApproval?: (command: string) => Promise<boolean>,
) {
  const developerTools = [readFileTool, listDirectoryTool, writeFileTool];
  const testerTools = [readFileTool, listDirectoryTool, writeFileTool, runCommandTool];

  return tool(
    async ({ id, message }: { id: string; message: string }) => {
      if (id === "developer") {
        onStatus("Developer is working...");
        const result = await runSubAgent(
          developer,
          developerTools,
          createDeveloperPrompt,
          message,
          onStatus,
          "Developer",
          onActivity,
          requestApproval,
        );
        return JSON.stringify({ id: "coordinator", status: "success", message: result });
      }

      if (id === "tester") {
        onStatus("Tester is working...");
        const result = await runSubAgent(tester, testerTools, createTesterPrompt, message, onStatus, "Tester", onActivity, requestApproval);
        return JSON.stringify({ id: "coordinator", status: "success", message: result });
      }

      return JSON.stringify({
        id: "coordinator",
        status: "failure",
        message: `Unknown agent: ${id}. Valid agents: developer, tester.`,
      });
    },
    {
      name: "send_message",
      description:
        "Delegate a task to a sub-agent. Use 'developer' to implement code changes, 'tester' to write and run tests.",
      schema: z.object({
        id: z.enum(["developer", "tester"]).describe("The sub-agent to message"),
        message: z.string().describe("A self-contained task description with all context the agent needs"),
      }),
    },
  );
}

/**
 * Props accepted by the root {@link App} component.
 */
interface AppProps {
  /** Resolved application configuration. */
  config: AppConfig;
  /** Operating mode — `"chat"` for single-model RAG, `"team"` for multi-agent. */
  mode?: "chat" | "team";
}

/**
 * Root TUI component rendered by Ink.
 *
 * On mount the component initialises the Pinecone vector store and LLM
 * instance(s), then presents an interactive prompt. In **chat mode** each
 * query triggers a RAG retrieval followed by a single-shot LLM generation.
 * In **team mode** the planner orchestrates developer and tester sub-agents
 * through tool calls.
 *
 * Slash commands (`/help`, `/clear`, `/sources`, `/ingest`, `/config`,
 * `/quit`) are handled locally without invoking the LLM.
 *
 * @param props - {@link AppProps}
 * @returns The Ink element tree for the TUI.
 */
export function App({ config, mode = "chat" }: AppProps) {
  const { exit } = useApp();

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

  const requestApproval = useCallback((command: string) => {
    return new Promise<boolean>((resolve) => {
      setPendingApprovals((prev) => [...prev, { command, resolve }]);
    });
  }, []);

  // Write messages directly to stdout above Ink's dynamic area.
  // useStdout().write() is Ink's sanctioned escape hatch — it outputs text
  // that persists in the terminal scrollback without interfering with Ink's
  // cursor management of the dynamic render area below.
  const { write } = useStdout();
  const writeMsg = useCallback(
    (msg: ChatMessage) => {
      if (msg.role === "system") {
        write(chalk.gray(`  ${msg.content}\n`));
      } else if (msg.role === "user") {
        write(chalk.bold.cyan("You") + chalk.dim(` [${new Date(msg.timestamp).toLocaleTimeString()}]`) + "\n");
        write(`  ${msg.content}\n\n`);
      } else {
        write(chalk.bold.green("Assistant") + chalk.dim(` [${new Date(msg.timestamp).toLocaleTimeString()}]`) + "\n");
        write(`  ${msg.content.replace(/\n/g, "\n  ")}\n`);
        if (msg.sources && msg.sources.length > 0) {
          write(chalk.dim(`  Sources: ${msg.sources.map((s) => `${s.source} (${(s.score * 100).toFixed(0)}%)`).join(" · ")}\n`));
        }
        write("\n");
      }
    },
    [write],
  );

  const createTeam = async () => {
    try {
      const store = await createVectorStore(config);
      const planner = await Promise.resolve(createPlanner(config));
      const developer = await Promise.resolve(createDeveloper(config));
      const tester = await Promise.resolve(createTester(config));

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

  const createChat = async () => {
    try {
      const store = await createVectorStore(config);
      const model = await Promise.resolve(createLLM(config));
      const prompt = createChatPrompt();
      setVectorStore(store);
      setLlm([model]);
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
        if (mode === "team") {
          await createTeam();
        } else {
          await createChat();
        }
      } catch (err) {
        setErrorMsg(`Initialization failed: ${err instanceof Error ? err.message : String(err)}`);
        setAppState("error");
      }
    }
    init();
  }, []);

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

  // ─── Slash command handler ─────────────────────────────────────────────────

  const addSystemMsg = useCallback((content: string) => {
    const msg: ChatMessage = {
      id: randomUUID(),
      role: "system" as const,
      content,
      timestamp: new Date().toISOString(),
    };
    writeMsg(msg);
    setCompletedMessages((prev) => [...prev, msg].slice(-20));
  }, [writeMsg]);

  const handleCommand = useCallback(
    async (cmd: string) => {
      const parts = cmd.slice(1).trim().split(/\s+/);
      const command = parts[0]?.toLowerCase() ?? "";

      switch (command) {
        case "help":
          addSystemMsg(
            [
              "/help              — show this message",
              "/clear             — clear conversation history",
              "/sources           — show sources from the last response",
              "/ingest <path>     — ingest a file into the knowledge base",
              "/config            — show current configuration",
              "/quit              — exit the application",
            ].join("\n"),
          );
          break;

        case "clear":
          // Static items already printed to stdout can't be un-rendered,
          // but we reset the state so no new items reference old context.
          setCompletedMessages([]);
          setLastSources([]);
          addSystemMsg("Conversation cleared.");
          break;

        case "sources":
          if (lastSources.length === 0) {
            addSystemMsg("No sources from the last response.");
          } else {
            const lines = lastSources.map(
              (s, i) => `${i + 1}. ${s.source}\n   relevance: ${(s.score * 100).toFixed(0)}%`,
            );
            addSystemMsg(`Sources from last response:\n\n${lines.join("\n\n")}`);
          }
          break;

        case "config":
          addSystemMsg(JSON.stringify(config, null, 2));
          break;

        case "quit":
        case "exit":
          exit();
          break;

        case "ingest": {
          const filePath = parts.slice(1).join(" ");
          if (!filePath) {
            addSystemMsg("Usage: /ingest <path-to-file>");
            break;
          }
          setAppState("retrieving");
          setStatusMsg(`Ingesting ${filePath}...`);
          try {
            const result = await ingestFile(filePath, config, (msg) => setStatusMsg(msg));
            // Refresh the vector store so new docs are immediately searchable
            const newStore = await createVectorStore(config);
            setVectorStore(newStore);
            addSystemMsg(`Ingested: ${result.source}\n${result.chunkCount} chunks stored in Pinecone.`);
          } catch (err) {
            addSystemMsg(`Ingest failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          setAppState("idle");
          setStatusMsg("");
          break;
        }

        default:
          addSystemMsg(`Unknown command: /${command}\nType /help to see available commands.`);
      }
    },
    [lastSources, config, addSystemMsg, exit],
  );

  // ─── Query submission ──────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || appState !== "idle") return;

      setInput("");

      if (trimmed.startsWith("/")) {
        await handleCommand(trimmed);
        return;
      }

      // 1. Add user message to the completed (Static) list
      const userMsg: ChatMessage = {
        id: randomUUID(),
        role: "user",
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      writeMsg(userMsg);
      setCompletedMessages((prev) => [...prev, userMsg].slice(-20));

      const chatHistory = completedMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)));

      // ── Team mode: agentic loop with filesystem tools, no RAG ─────────────
      if (mode === "team") {
        setAppState("generating");
        setStatusMsg("Thinking...");


        try {
          const planner = llm[0] as ChatAnthropic | ChatOpenAI | ChatGoogle;
          const developer = llm[1] as ChatAnthropic | ChatOpenAI | ChatGoogle;
          const tester = llm[2] as ChatAnthropic | ChatOpenAI | ChatGoogle;
          const writeActivity = (line: string) => {
            write(chalk.dim(`    ⋮ ${line}`) + "\n");
          };
          const sendMessageTool = createSendMessageTool(developer, tester, setStatusMsg, writeActivity, requestApproval);
          const plannerTools: DynamicStructuredTool[] = [readFileTool, listDirectoryTool, sendMessageTool];
          const plannerWithTools = planner.bindTools(plannerTools);

          const promptMessages = await ragPrompt!.formatMessages({
            chat_history: chatHistory,
            input: trimmed,
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
              writeMsg(plannerMsg);
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
        return;
      }

      // ── Chat mode: RAG retrieval + single-shot generation ─────────────────

      // 2. Retrieve relevant context from Pinecone
      setAppState("retrieving");
      setStatusMsg("Searching knowledge base...");

      let sources: RetrievalResult[] = [];
      let context = "";

      try {
        const result = await retrieve(vectorStore!, trimmed, config);
        sources = result.sources;
        context = result.context;
        setCurrentSources(sources);
      } catch (err) {
        setErrorMsg(`Retrieval failed: ${err instanceof Error ? err.message : String(err)}`);
        setAppState("error");
        return;
      }

      // 3. Stream the LLM response
      setAppState("generating");
      setStatusMsg("Generating response...");

      try {
        // Build LangChain chat history from completed messages.
        // System messages (in-app notices) are excluded — they're not part of
        // the conversation context the LLM should be aware of.
        const promptMessages = await ragPrompt!.formatMessages({
          context,
          chat_history: chatHistory,
          input: trimmed,
        });

        let fullText = "";
        for (const x of llm) {
          const stream = await x!.stream(promptMessages);

          for await (const chunk of stream) {
            const text =
              typeof chunk.content === "string"
                ? chunk.content
                : Array.isArray(chunk.content)
                  ? chunk.content.map((c) => (typeof c === "string" ? c : "text" in c ? c.text : "")).join("")
                  : "";
            fullText += text;
          }
        }

        // 4. Write the completed response to stdout
        const assistantMsg: ChatMessage = {
          id: randomUUID(),
          role: "assistant",
          content: fullText,
          sources,
          timestamp: new Date().toISOString(),
        };
        writeMsg(assistantMsg);
        setCompletedMessages((prev) => [...prev, assistantMsg].slice(-20));
        setLastSources(sources);
        setCurrentSources([]);
        setAppState("idle");
        setStatusMsg("");
      } catch (err) {
        setCurrentSources([]);
        setErrorMsg(`Generation failed: ${err instanceof Error ? err.message : String(err)}`);
        setAppState("error");
      }
    },
    [appState, mode, vectorStore, llm, ragPrompt, config, completedMessages, handleCommand, writeMsg],
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  // Full-screen spinner during init — nothing else to show yet
  if (appState === "initializing") {
    return (
      <Box gap={1} padding={1}>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text>{statusMsg}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* ── Status bar ────────────────────────────────────────────────── */}
      <StatusBar state={appState} message={statusMsg} sourcesCount={currentSources.length} />

      {/* ── Input area ────────────────────────────────────────────────── */}
      {appState === "error" ? (
        <Box flexDirection="column" gap={0}>
          <Text color="red">✖ {errorMsg}</Text>
          <Text dimColor>Press Enter to continue...</Text>
        </Box>
      ) : pendingApprovals.length > 0 ? (
        <Box gap={1}>
          <Text color="yellow">⚠ Agent wants to run:</Text>
          <Text>{pendingApprovals[0].command}</Text>
          <Text dimColor>Allow? (y/N)</Text>
        </Box>
      ) : appState === "idle" ? (
        <Box gap={1}>
          <Text bold color="cyan">
            You:
          </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Ask a question...  (or /help)"
          />
        </Box>
      ) : null}
    </Box>
  );
}
