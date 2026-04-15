import {describe, it, expect} from 'bun:test';
import {createPlannerPrompt, createDeveloperPrompt, createTesterPrompt} from './prompt.js';

// ---------------------------------------------------------------------------
// createPlannerPrompt
// ---------------------------------------------------------------------------

describe('createPlannerPrompt', () => {
  it('returns a string', async () => {
    expect(typeof (await createPlannerPrompt())).toBe('string');
  });

  it('includes coordinator role description', async () => {
    const prompt = await createPlannerPrompt();
    expect(prompt).toMatch(/coordinator/iv);
  });

  it('mentions delegating to sub-agents', async () => {
    const prompt = await createPlannerPrompt();
    expect(prompt).toMatch(/developer/iv);
    expect(prompt).toMatch(/tester/iv);
  });

  it('includes the common system prompt', async () => {
    const prompt = await createPlannerPrompt();
    expect(prompt).toMatch(/software engineering/iv);
  });
});

// ---------------------------------------------------------------------------
// createDeveloperPrompt
// ---------------------------------------------------------------------------

describe('createDeveloperPrompt', () => {
  it('returns a string', async () => {
    expect(typeof (await createDeveloperPrompt())).toBe('string');
  });

  it('mentions reading files and implementing changes', async () => {
    const prompt = await createDeveloperPrompt();
    expect(prompt).toMatch(/read/iv);
    expect(prompt).toMatch(/implement/iv);
  });

  it('includes the common system prompt', async () => {
    const prompt = await createDeveloperPrompt();
    expect(prompt).toMatch(/software engineering/iv);
  });
});

// ---------------------------------------------------------------------------
// createTesterPrompt
// ---------------------------------------------------------------------------

describe('createTesterPrompt', () => {
  it('returns a string', async () => {
    expect(typeof (await createTesterPrompt())).toBe('string');
  });

  it('references bun test and typecheck commands', async () => {
    const prompt = await createTesterPrompt();
    expect(prompt).toMatch(/bun test/iv);
    expect(prompt).toMatch(/tsc/iv);
  });

  it('includes the common system prompt', async () => {
    const prompt = await createTesterPrompt();
    expect(prompt).toMatch(/software engineering/iv);
  });
});
