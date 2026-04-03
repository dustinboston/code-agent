/// <reference types="vitest/globals" />
import { printChatMessage } from './format';
import { ChatMessage } from '../types';
import { vi, expect } from 'vitest';
import { stdout } from 'process';
import chalk from 'chalk';
import { randomUUID } from 'crypto';

describe('printChatMessage', () => {
  let originalStdoutWrite: (chunk: any, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => boolean;
  let capturedOutput: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOutput = [];
    originalStdoutWrite = stdout.write;
    (stdout as any).write = vi.fn((chunk: any, cb?: (err?: Error | null) => void) => {
      capturedOutput.push(chunk.toString());
      if (cb) cb(null);
      return true;
    });
  });

  afterEach(() => {
    (stdout as any).write = originalStdoutWrite;
  });

  it('should print developer messages as plain text', () => {
    const message: ChatMessage = {
      id: randomUUID(),
      role: 'developer',
      content: 'This is a **bold** word.',
      timestamp: new Date().toISOString(),
    };

    printChatMessage((text) => stdout.write(text), message);

    const output = capturedOutput.join('');
    expect(output).toContain('This is a **bold** word.');
  });

  it('should print tester messages as plain text', () => {
    const message: ChatMessage = {
      id: randomUUID(),
      role: 'tester',
      content: 'This is a **bold** word.',
      timestamp: new Date().toISOString(),
    };

    printChatMessage((text) => stdout.write(text), message);

    const output = capturedOutput.join('');
    expect(output).toContain('This is a **bold** word.');
  });

  it('should print assistant messages as plain text', () => {
    const message: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: 'This is a **bold** word.',
      timestamp: new Date().toISOString(),
    };

    printChatMessage((text) => stdout.write(text), message);

    const output = capturedOutput.join('');
    expect(output).toContain('This is a **bold** word.');
  });

  it('should print user messages as plain text', () => {
    const message: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      content: 'This is a **bold** word.',
      timestamp: new Date().toISOString(),
    };

    printChatMessage((text) => stdout.write(text), message);

    const output = capturedOutput.join('');
    expect(output).toContain('**bold**');
  });

  it('should print system messages as plain text', () => {
    const message: ChatMessage = {
      id: randomUUID(),
      role: 'system',
      content: 'This is a **bold** word.',
      timestamp: new Date().toISOString(),
    };

    printChatMessage((text) => stdout.write(text), message);

    const output = capturedOutput.join('');
    expect(output).toContain('**bold**');
  });
});
