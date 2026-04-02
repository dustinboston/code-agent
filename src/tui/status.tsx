/**
 * @module tui/status
 *
 * Renders a compact status bar for the TUI that shows a spinner and a
 * contextual message while asynchronous operations (initialisation, retrieval,
 * generation) are in progress. The bar hides itself automatically when the app
 * is idle or in an error state.
 */
import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

/**
 * Finite set of lifecycle states the application can be in.
 *
 * - `"initializing"` — connecting to Pinecone and creating LLM instances.
 * - `"idle"` — waiting for user input.
 * - `"retrieving"` — performing a similarity search against the vector store.
 * - `"generating"` — streaming a response from the LLM.
 * - `"error"` — an operation failed; the user must dismiss the error.
 */
export type AppState =
  | "initializing"
  | "idle"
  | "retrieving"
  | "generating"
  | "error";

/**
 * Props accepted by {@link StatusBar}.
 */
interface StatusBarProps {
  /** Current application lifecycle state. */
  state: AppState;
  /** Human-readable status message displayed next to the spinner. */
  message: string;
  /** Number of retrieval sources found so far (shown during generation). */
  sourcesCount?: number;
}

/**
 * Displays a spinner and contextual status message while async operations are
 * running. Returns `null` when the app is idle or in an error state so the
 * component takes up no vertical space in the terminal.
 *
 * @param props - {@link StatusBarProps}
 * @returns A React element containing the spinner and label, or `null`.
 */
export function StatusBar({ state, message, sourcesCount = 0 }: StatusBarProps) {
  if (state === "idle" || state === "error") return null;

  const label =
    state === "initializing"
      ? message || "Initializing..."
      : state === "retrieving"
      ? message || "Searching knowledge base..."
      : state === "generating"
      ? message || "Generating response..."
      : message;

  return (
    <Box gap={1}>
      <Text color="green">
        <Spinner type="dots" />
      </Text>
      <Text dimColor>{label}</Text>
      {sourcesCount > 0 && state === "generating" && (
        <Text dimColor>· {sourcesCount} source{sourcesCount !== 1 ? "s" : ""} found</Text>
      )}
    </Box>
  );
}
