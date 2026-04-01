import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";

export type AppState =
  | "initializing"
  | "idle"
  | "retrieving"
  | "generating"
  | "error";

interface StatusBarProps {
  state: AppState;
  message: string;
  sourcesCount?: number;
}

// Shows a spinner and status message during async operations.
// Returns null when idle so it takes up no space.
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
