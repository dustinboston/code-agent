/**
 * @module tui/app
 *
 * Root Ink component for the Code Agent TUI. Manages the full application
 * lifecycle — Pinecone / LLM initialisation, user input handling, slash
 * commands, RAG retrieval, LLM streaming, and the multi-agent "team" mode
 * where a planner delegates to developer and tester sub-agents.
 */
import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { StatusBar } from "./status.js";
import type { AppConfig } from "../types.js";
import { useAppController } from "./useAppController.js";

/**
 * Props accepted by the root {@link App} component.
 */
interface AppProps {
  /** Resolved application configuration. */
  config: AppConfig;
}

/**
 * Root TUI component rendered by Ink.
 *
 * On mount the component initialises the Pinecone vector store and LLM
 * instance(s), then presents an interactive prompt. In **team mode** the planner orchestrates developer and tester sub-agents
 * through tool calls.
 *
 * Slash commands (`/help`, `/clear`, `/sources`, `/ingest`, `/config`,
 * `/quit`) are handled locally without invoking the LLM.
 *
 * @param props - {@link AppProps}
 * @returns The Ink element tree for the TUI.
 */
export function App({ config }: AppProps) {
  const {
    appState,
    statusMsg,
    errorMsg,
    currentSources,
    input,
    pendingApprovals,
    setInput,
    handleSubmit,
  } = useAppController({ config });

  // Full-screen spinner during init — nothing else to show yet
  // TODO: This isn't showing. Perhaps it's being blocked by the useAppController hook?
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
          <Text color="redBright">✖ {errorMsg}</Text>
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
          <Box flexGrow={1}>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              placeholder="Ask a question...  (or /help)"
            />
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
