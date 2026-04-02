/**
 * @module tui/chat
 *
 * Presentational component that renders a single chat message inside the Ink
 * TUI. User, assistant, and system messages each receive distinct visual
 * treatments (colour, border, label) so they are easy to distinguish in the
 * terminal scrollback.
 */
import React from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "../types.js";

/**
 * Props accepted by {@link ChatMessageView}.
 */
interface ChatMessageViewProps {
  /** The chat message to render. */
  message: ChatMessage;
  /** When `true`, shows a "(streaming…)" indicator instead of a timestamp. */
  streaming?: boolean;
}

/**
 * Renders a single chat message bubble.
 *
 * - **User messages** are labelled in cyan with a timestamp.
 * - **Assistant messages** are labelled in green, optionally showing source
 *   attributions beneath the body text.
 * - **System messages** (e.g. `/help` output) are displayed inside a muted
 *   rounded border.
 *
 * @param props - {@link ChatMessageViewProps}
 * @returns A React element representing the formatted message.
 */
export function ChatMessageView({ message, streaming = false }: ChatMessageViewProps) {
  if (message.role === "system") {
    return (
      <Box
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        marginY={0}
        flexDirection="column"
      >
        <Text dimColor>{message.content}</Text>
      </Box>
    );
  }

  const isUser = message.role === "user";

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header: role label + timestamp */}
      <Box gap={1}>
        <Text bold color={isUser ? "cyan" : "green"}>
          {isUser ? "You" : "Assistant"}
        </Text>
        {streaming ? (
          <Text dimColor>(streaming...)</Text>
        ) : message.timestamp ? (
          <Text dimColor>[{new Date(message.timestamp).toLocaleTimeString()}]</Text>
        ) : null}
      </Box>

      {/* Message body */}
      <Box paddingLeft={2}>
        <Text>{message.content}</Text>
      </Box>

      {/* Source attribution — only shown on completed assistant messages */}
      {!streaming && message.sources && message.sources.length > 0 && (
        <Box paddingLeft={2} marginTop={0}>
          <Text dimColor>
            {"Sources: "}
            {message.sources
              .map((s) => `${s.source} (${(s.score * 100).toFixed(0)}%)`)
              .join(" · ")}
          </Text>
        </Box>
      )}
    </Box>
  );
}
