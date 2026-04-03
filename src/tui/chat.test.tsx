
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ChatMessageView } from './chat.js';
import type { ChatMessage } from '../types.js';

describe('ChatMessageView', () => {
  // Mock the Date object and its toLocaleTimeString method to ensure consistent timestamps in tests
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-01-01T12:00:00.000Z'));
    // Mock toLocaleTimeString to return a consistent string
    vi.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue('12:00:00 PM');
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks(); // Restore all mocks after tests
  });

  it('renders a user message correctly', () => {
    const userMessage: ChatMessage = {
      id: '1',
      role: 'user',
      content: 'Hello, world!',
      timestamp: new Date().toISOString(),
    };
    const { lastFrame } = render(<ChatMessageView message={userMessage} />);
    expect(lastFrame()).toStrictEqual(
      'You [12:00:00 PM]\n  Hello, world!\n',
    );
  });

  it('renders an assistant message correctly', () => {
    const assistantMessage: ChatMessage = {
      id: '2',
      role: 'assistant',
      content: 'How can I help you?',
      timestamp: new Date().toISOString(),
    };
    const { lastFrame } = render(<ChatMessageView message={assistantMessage} />);
    expect(lastFrame()).toStrictEqual(
      'Assistant [12:00:00 PM]\n  How can I help you?\n',
    );
  });

  it('renders a system message correctly', () => {
    const systemMessage: ChatMessage = {
      id: '3',
      role: 'system',
      content: 'System message content.',
      timestamp: new Date().toISOString(),
    };
    const { lastFrame } = render(<ChatMessageView message={systemMessage} />);
    expect(lastFrame()).toStrictEqual(
      '╭──────────────────────────────────────────────────────────────────────────────────────────────────╮\n│ System message content.                                                                          │\n╰──────────────────────────────────────────────────────────────────────────────────────────────────╯',
    );
  });

  it('renders an assistant message with sources', () => {
    const assistantMessageWithSources: ChatMessage = {
      id: '4',
      role: 'assistant',
      content: 'Here is some information.',
      timestamp: new Date().toISOString(),
      sources: [
        { source: 'doc1.txt', score: 0.9, content: '' },
        { source: 'doc2.pdf', score: 0.75, content: '' },
      ],
    };
    const { lastFrame } = render(<ChatMessageView message={assistantMessageWithSources} />);
    expect(lastFrame()).toStrictEqual(
      'Assistant [12:00:00 PM]\n  Here is some information.\n  Sources: doc1.txt (90%) · doc2.pdf (75%)\n',
    );
  });

  it('renders a streaming message correctly', () => {
    const streamingMessage: ChatMessage = {
      id: '5',
      role: 'assistant',
      content: 'Streaming content...',
      timestamp: new Date().toISOString(),
    };
    const { lastFrame } = render(<ChatMessageView message={streamingMessage} streaming={true} />);
    expect(lastFrame()).toStrictEqual(
      'Assistant (streaming...)\n  Streaming content...\n',
    );
  });
});
