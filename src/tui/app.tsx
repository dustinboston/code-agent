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

// ─── Sub-agent runner ──────────────────────────────────────────────────────────
// Runs a single sub-agent (developer or tester) in an agentic tool-use loop.
//
// Each iteration streams one LLM response. If the response contains tool calls,
// each tool is invoked and its result is appended to `invokeMessages` before the
// next iteration. The loop exits when the model produces a response with no tool
// calls — i.e. it has finished its task and is reporting back in plain text.
//
// Returns the full concatenated text produced by the agent across all iterations,
// which the planner receives as the tool result of `send_message`.

async function runSubAgent(
  agent: ChatAnthropic | ChatOpenAI,
  agentTools: typeof filesystemTools,
  promptFn: () => ReturnType<typeof createDeveloperPrompt>,
  message: string,
  onStatus: (msg: string) => void,
  agentName: string,
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
    const stream = await agentWithTools.stream(invokeMessages);
    for await (const chunk of stream) {
      const c = chunk as AIMessageChunk;
      accChunk = accChunk ? (accChunk.concat(c) as AIMessageChunk) : c;
      const text =
        typeof c.content === "string"
          ? c.content
          : Array.isArray(c.content)
            ? c.content.map((p) => (typeof p === "string" ? p : "text" in p ? p.text : "")).join("")
            : "";
      fullText += text;
    }

    if (!accChunk) break;

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
    for (const toolCall of toolCalls) {
      const toolFn = agentTools.find((t) => t.name === toolCall.name);
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
          // Return the error as a ToolMessage so the agent can self-correct
          // rather than crashing the whole team loop.
          toolMsg = new ToolMessage({
            content: `Tool error: ${e instanceof Error ? e.message : String(e)}`,
            tool_call_id: toolCall.id ?? randomUUID(),
            name: toolCall.name,
          });
        }
      }
      invokeMessages.push(toolMsg);
    }
  }

  return fullText;
}

// ─── send_message tool factory ────────────────────────────────────────────────
// Returns the `send_message` LangChain tool that the planner uses to delegate
// work. When the planner calls send_message({ id: "developer", message: "..." }),
// this tool spins up the developer's agentic loop synchronously and returns its
// result as a JSON ToolMessage. The planner then decides whether to call the
// tester, ask a follow-up, or report back to the user.
//
// Tool access by role:
//   developer — read_file, list_directory, write_file
//   tester    — read_file, list_directory, write_file, run_command

function createSendMessageTool(
  developer: ChatAnthropic | ChatOpenAI,
  tester: ChatAnthropic | ChatOpenAI,
  onStatus: (msg: string) => void,
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
        );
        return JSON.stringify({ id: "coordinator", status: "success", message: result });
      }

      if (id === "tester") {
        onStatus("Tester is working...");
        const result = await runSubAgent(tester, testerTools, createTesterPrompt, message, onStatus, "Tester");
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

interface AppProps {
  config: AppConfig;
  mode?: "chat" | "team";
}

export function App({ config, mode = "chat" }: AppProps) {
  const { exit } = useApp();

  // App lifecycle state
  const [appState, setAppState] = useState<AppState>("initializing");
  const [statusMsg, setStatusMsg] = useState("Connecting to Pinecone...");
  const [errorMsg, setErrorMsg] = useState("");

  // LangChain instances (initialized on mount)
  const [vectorStore, setVectorStore] = useState<PineconeStore | null>(null);
  const [llm, setLlm] = useState<Array<ChatAnthropic | ChatOpenAI>>([]);
  const [ragPrompt, setRagPrompt] = useState<ChatPromptTemplate | null>(null);

  // Chat state
  const [completedMessages, setCompletedMessages] = useState<ChatMessage[]>([]);
  const [currentSources, setCurrentSources] = useState<RetrievalResult[]>([]);
  const [lastSources, setLastSources] = useState<RetrievalResult[]>([]);

  // Text input
  const [input, setInput] = useState("");

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
  };

  const createChat = async () => {
    const store = await createVectorStore(config);
    const model = createLLM(config);
    const prompt = createChatPrompt();
    setVectorStore(store);
    setLlm([model]);
    setRagPrompt(prompt);
    setAppState("idle");
    setStatusMsg("");
  };

  // ─── Initialization ────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      try {
        if (mode === "team") {
          createTeam();
        } else {
          createChat();
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

  // ─── Slash command handler ─────────────────────────────────────────────────

  const addSystemMsg = useCallback((content: string) => {
    const msg: ChatMessage = {
      id: randomUUID(),
      role: "system" as const,
      content,
      timestamp: new Date().toISOString(),
    };
    writeMsg(msg);
    setCompletedMessages((prev) => [...prev, msg]);
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
      setCompletedMessages((prev) => [...prev, userMsg]);

      const chatHistory = completedMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)));

      // ── Team mode: agentic loop with filesystem tools, no RAG ─────────────
      if (mode === "team") {
        setAppState("generating");
        setStatusMsg("Thinking...");


        try {
          const planner = llm[0] as ChatAnthropic;
          const developer = llm[1] as ChatAnthropic;
          const tester = llm[2] as ChatAnthropic;
          const sendMessageTool = createSendMessageTool(developer, tester, setStatusMsg);
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

            const stream = await plannerWithTools.stream(invokeMessages);
            for await (const chunk of stream) {
              const c = chunk as AIMessageChunk;
              accChunk = accChunk ? (accChunk.concat(c) as AIMessageChunk) : c;
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
              setCompletedMessages((prev) => [...prev, plannerMsg]);
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
            for (const toolCall of toolCalls) {
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
              invokeMessages.push(toolMsg);
            }
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
        setCompletedMessages((prev) => [...prev, assistantMsg]);
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
