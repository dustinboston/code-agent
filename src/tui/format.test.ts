import {randomUUID} from 'node:crypto';
import {describe, it, expect, beforeEach} from 'bun:test';
import {type ChatMessage} from '../types.js';
import {printChatMessage} from './format.js';

describe('printChatMessage', () => {
  let capturedOutput: string[] = [];
  const captureWrite = (text: string): void => {
    capturedOutput.push(text);
  };

  beforeEach(() => {
    capturedOutput = [];
  });

  it('should print developer messages as plain text', () => {
    const message: ChatMessage = {
      id: randomUUID(),
      role: 'developer',
      content: 'This is a **bold** word.',
      timestamp: new Date().toISOString(),
    };

    printChatMessage(captureWrite, message);

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

    printChatMessage(captureWrite, message);

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

    printChatMessage(captureWrite, message);

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

    printChatMessage(captureWrite, message);

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

    printChatMessage(captureWrite, message);

    const output = capturedOutput.join('');
    expect(output).toContain('**bold**');
  });
});
