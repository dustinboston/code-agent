import React from "react";
import { render } from "ink-testing-library";
import { ChatMessageView } from "./chat.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import chalk from 'chalk';

describe("ChatMessageView", () => {
  const MOCK_DATE = new Date("2024-01-01T12:00:00.000Z");

  beforeEach(() => {
    vi.setSystemTime(MOCK_DATE);
    // Mock toLocaleTimeString to ensure consistent output regardless of locale
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("12:00:00 PM");
    chalk.level = 0; // Disable chalk colors for consistent snapshot testing
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks(); // Restore all mocks after each test
  });

  it("renders a user message with timestamp", () => {
    const message = {
      id: "mock-uuid-1", // Added id
      role: "user" as const, // Added 'as const'
      content: "Hello, world!",
      timestamp: MOCK_DATE.toISOString(),
    };
    const { lastFrame } = render(<ChatMessageView message={message} />);
    expect(lastFrame()).toMatchSnapshot();
  });

  it("renders an assistant message with streaming indicator", () => {
    const message = {
      id: "mock-uuid-2", // Added id
      role: "assistant" as const, // Added 'as const'
      content: "Thinking...",
      timestamp: MOCK_DATE.toISOString(), // Added timestamp
    };
    const { lastFrame } = render(<ChatMessageView message={message} streaming={true} />);
    expect(lastFrame()).toMatchSnapshot();
  });

  it("renders an assistant message with sources", () => {
    const message = {
      id: "mock-uuid-3", // Added id
      role: "assistant" as const, // Added 'as const'
      content: "Here is some information.",
      sources: [
        { source: "doc1.pdf", score: 0.9, content: "Content of doc1" }, // Added content
        { source: "webpage.html", score: 0.75, content: "Content of webpage" }, // Added content
      ],
      timestamp: MOCK_DATE.toISOString(), // Added timestamp
    };
    const { lastFrame } = render(<ChatMessageView message={message} />);
    expect(lastFrame()).toMatchSnapshot();
  });

  it("renders a system message", () => {
    const message = {
      id: "mock-uuid-4", // Added id
      role: "system" as const, // Added 'as const'
      content: "This is a system message.",
      timestamp: MOCK_DATE.toISOString(), // Added timestamp
    };
    const { lastFrame } = render(<ChatMessageView message={message} />);
    expect(lastFrame()).toMatchSnapshot();
  });
});
