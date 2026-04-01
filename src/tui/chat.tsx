import React from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "../types.js";

interface ChatMessageViewProps {
  message: ChatMessage;
  streaming?: boolean;
}

// Renders a single chat message. User and assistant messages have distinct
// colors and labels. System messages (in-app notices like /help output) are
// rendered in a muted style.
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
