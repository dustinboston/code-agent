import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, Static } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { randomUUID } from "crypto";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { PineconeStore } from "@langchain/pinecone";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { ChatPromptTemplate } from "@langchain/core/prompts";
import { createVectorStore } from "../retrieval/store.js";
import { retrieve } from "../retrieval/retriever.js";
import { createDeveloper, createLLM, createPlanner, createTester } from "../generation/llm.js";
import { createChatPrompt, createTeamPrompt } from "../generation/prompt.js";
import { filesystemTools } from "../tools/filesystem.js";
import { ingestFile } from "../ingest/pipeline.js";
import { ChatMessageView } from "./chat.js";
import { StatusBar, type AppState } from "./status.js";
import type { AppConfig, ChatMessage, RetrievalResult } from "../types.js";
import { ChatOpenAI } from "@langchain/openai";

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
  // completedMessages feeds into <Static> — they're printed to stdout once
  // and don't re-render, keeping streaming updates snappy.
  const [completedMessages, setCompletedMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [currentSources, setCurrentSources] = useState<RetrievalResult[]>([]);
  const [lastSources, setLastSources] = useState<RetrievalResult[]>([]);

  // Text input
  const [input, setInput] = useState("");

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
    setCompletedMessages((prev) => [
      ...prev,
      {
        id: randomUUID(),
        role: "system" as const,
        content,
        timestamp: new Date().toISOString(),
      },
    ]);
  }, []);

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
      setCompletedMessages((prev) => [...prev, userMsg]);

      const chatHistory = completedMessages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)));

      // ── Team mode: agentic loop with filesystem tools, no RAG ─────────────
      if (mode === "team") {
        setAppState("generating");
        setStatusMsg("Thinking...");
        setStreamingText("");

        try {
          const planner = llm[0] as ChatAnthropic; // planner drives the team loop
          const plannerWithTools = planner.bindTools(filesystemTools);

          const promptMessages = await ragPrompt!.formatMessages({
            chat_history: chatHistory,
            input: trimmed,
          });

          const invokeMessages: BaseMessage[] = [...promptMessages];
          let fullText = "";

          while (true) {
            let accChunk: AIMessageChunk | null = null;

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
              fullText += text;
              setStreamingText(fullText);
            }

            if (!accChunk) break;

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
              const toolFn = filesystemTools.find((t) => t.name === toolCall.name);
              // invoke(ToolCall) returns a ToolMessage directly — push it as-is
              const toolMsg = toolFn
                ? await toolFn.invoke(toolCall)
                : new ToolMessage({
                    content: `Unknown tool: ${toolCall.name}`,
                    tool_call_id: toolCall.id ?? randomUUID(),
                    name: toolCall.name,
                  });
              invokeMessages.push(toolMsg as ToolMessage);
            }
          }

          const assistantMsg: ChatMessage = {
            id: randomUUID(),
            role: "assistant",
            content: fullText,
            timestamp: new Date().toISOString(),
          };
          setCompletedMessages((prev) => [...prev, assistantMsg]);
          setStreamingText("");
          setAppState("idle");
          setStatusMsg("");
        } catch (err) {
          setStreamingText("");
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
      setStreamingText("");

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
            setStreamingText(fullText);
          }
        }

        // 4. Move the completed response into Static
        const assistantMsg: ChatMessage = {
          id: randomUUID(),
          role: "assistant",
          content: fullText,
          sources,
          timestamp: new Date().toISOString(),
        };
        setCompletedMessages((prev) => [...prev, assistantMsg]);
        setLastSources(sources);
        setStreamingText("");
        setCurrentSources([]);
        setAppState("idle");
        setStatusMsg("");
      } catch (err) {
        setStreamingText("");
        setCurrentSources([]);
        setErrorMsg(`Generation failed: ${err instanceof Error ? err.message : String(err)}`);
        setAppState("error");
      }
    },
    [appState, mode, vectorStore, llm, ragPrompt, config, completedMessages, handleCommand],
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
      {/* ── Completed messages ─────────────────────────────────────────────
          Static renders each item once and prints it to stdout. New items
          are appended; existing items are never re-rendered. This keeps
          Ink's dynamic render area small (just the current status + input),
          so streaming updates don't flicker older messages.
      ─────────────────────────────────────────────────────────────────── */}
      <Static items={completedMessages}>{(msg) => <ChatMessageView key={msg.id} message={msg} />}</Static>

      {/* ── Currently streaming response ──────────────────────────────── */}
      {streamingText.length > 0 && (
        <ChatMessageView
          message={{
            id: "streaming",
            role: "assistant",
            content: streamingText,
            timestamp: "",
          }}
          streaming
        />
      )}

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
