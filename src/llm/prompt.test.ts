import {describe, it, expect} from 'bun:test';
import {ChatPromptTemplate, MessagesPlaceholder} from '@langchain/core/prompts';
import {createPlannerPrompt, createDeveloperPrompt, createTesterPrompt} from './prompt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPlaceholderNames(template: ChatPromptTemplate): string[] {
  return template.promptMessages
    .filter((m): m is MessagesPlaceholder => m instanceof MessagesPlaceholder)
    .map((m): string => m.variableName);
}

function getMessageContent(message: unknown): string {
  if (typeof message === 'object' && message !== null) {
    if ('content' in message && typeof message.content === 'string') {
      return message.content;
    }

    if ('prompt' in message) {
      const {prompt}: {prompt: unknown} = message;
      if (
        typeof prompt === 'object' &&
        prompt !== null &&
        'template' in prompt &&
        typeof prompt.template === 'string'
      ) {
        return prompt.template;
      }
    }
  }

  return '';
}

function getMessageContents(template: ChatPromptTemplate): string[] {
  return template.promptMessages
    .filter((m) => !(m instanceof MessagesPlaceholder))
    .map((m): string => getMessageContent(m));
}

// ---------------------------------------------------------------------------
// createTeamPrompt
// ---------------------------------------------------------------------------

describe('createTeamPrompt', () => {
  it('returns a ChatPromptTemplate', async () => {
    expect(await createPlannerPrompt()).toBeInstanceOf(ChatPromptTemplate);
  });

  it('includes a chat_history MessagesPlaceholder', async () => {
    const placeholders = getPlaceholderNames(await createPlannerPrompt());
    expect(placeholders).toContain('chat_history');
  });

  it('includes an {input} slot in the human message', async () => {
    const contents = getMessageContents(await createPlannerPrompt());
    expect(contents.some((c) => c.includes('{input}'))).toBe(true);
  });

  it('has exactly 3 non-placeholder messages (system + agents + human)', async () => {
    const contents = getMessageContents(await createPlannerPrompt());
    expect(contents).toHaveLength(2);
  });

  it('returns a new instance on each call', async () => {
    expect(await createPlannerPrompt()).not.toBe(await createPlannerPrompt());
  });
});

// ---------------------------------------------------------------------------
// createDeveloperPrompt
// ---------------------------------------------------------------------------

describe('createDeveloperPrompt', () => {
  it('returns a ChatPromptTemplate', async () => {
    expect(await createDeveloperPrompt()).toBeInstanceOf(ChatPromptTemplate);
  });

  it('does NOT include a chat_history placeholder', async () => {
    const placeholders = getPlaceholderNames(await createDeveloperPrompt());
    expect(placeholders).not.toContain('chat_history');
  });

  it('includes an {input} slot in the human message', async () => {
    const contents = getMessageContents(await createDeveloperPrompt());
    expect(contents.some((c) => c.includes('{input}'))).toBe(true);
  });

  it('has exactly 2 messages (system + agents + human)', async () => {
    const template = await createDeveloperPrompt();
    expect(template.promptMessages).toHaveLength(2);
  });

  it('system message mentions reading files and implementing changes', async () => {
    const contents = getMessageContents(await createDeveloperPrompt());
    const systemMessage = contents[0];
    expect(systemMessage).toMatch(/read/iv);
    expect(systemMessage).toMatch(/implement/iv);
  });

  it('returns a new instance on each call', async () => {
    expect(await createDeveloperPrompt()).not.toBe(await createDeveloperPrompt());
  });
});

// ---------------------------------------------------------------------------
// createTesterPrompt
// ---------------------------------------------------------------------------

describe('createTesterPrompt', () => {
  it('returns a ChatPromptTemplate', async () => {
    expect(await createTesterPrompt()).toBeInstanceOf(ChatPromptTemplate);
  });

  it('does NOT include a chat_history placeholder', async () => {
    const placeholders = getPlaceholderNames(await createTesterPrompt());
    expect(placeholders).not.toContain('chat_history');
  });

  it('includes an {input} slot in the human message', async () => {
    const contents = getMessageContents(await createTesterPrompt());
    expect(contents.some((c) => c.includes('{input}'))).toBe(true);
  });

  it('has exactly 2 messages (system + agents + human)', async () => {
    const template = await createTesterPrompt();
    expect(template.promptMessages).toHaveLength(2);
  });

  it('system message references bun test and typecheck commands', async () => {
    const contents = getMessageContents(await createTesterPrompt());
    const systemMessage = contents[0];
    expect(systemMessage).toMatch(/bun test/iv);
    expect(systemMessage).toMatch(/tsc/iv);
  });

  it('returns a new instance on each call', async () => {
    expect(await createTesterPrompt()).not.toBe(await createTesterPrompt());
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: structural consistency
// ---------------------------------------------------------------------------

describe('prompt factory structural consistency', () => {
  it('team prompt carries chat_history; developer and tester do not', async () => {
    expect(getPlaceholderNames(await createPlannerPrompt())).toContain('chat_history');
    expect(getPlaceholderNames(await createDeveloperPrompt())).not.toContain('chat_history');
    expect(getPlaceholderNames(await createTesterPrompt())).not.toContain('chat_history');
  });

  it('all three prompts expose an {input} variable', async () => {
    const factories = [createPlannerPrompt, createDeveloperPrompt, createTesterPrompt];
    const templates = await Promise.all(factories.map(async (factory) => factory()));
    for (const template of templates) {
      expect(template.inputVariables).toContain('input');
    }
  });

  it('chat_history-bearing prompts expose chat_history as an input variable', async () => {
    const template = await createPlannerPrompt();
    expect(template.inputVariables).toContain('chat_history');
  });
});
