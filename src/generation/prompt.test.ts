import { describe, it, expect } from "vitest";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import {
  createPlannerPrompt,
  createDeveloperPrompt,
  createTesterPrompt,
} from "./prompt.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the names of every MessagesPlaceholder found in a ChatPromptTemplate.
 */
function getPlaceholderNames(template: ChatPromptTemplate): string[] {
  return template.promptMessages
    .filter((m): m is MessagesPlaceholder => m instanceof MessagesPlaceholder)
    .map((m) => m.variableName);
}

/**
 * Returns the string content of every non-placeholder message in a
 * ChatPromptTemplate, in order.
 */
function getMessageContents(template: ChatPromptTemplate): string[] {
  return template.promptMessages
    .filter((m) => !(m instanceof MessagesPlaceholder))
    .map((m) => {
      // Each non-placeholder entry exposes its template via `.prompt.template`
      const prompt = (m as any).prompt;
      return prompt.template;
    });
}

// ---------------------------------------------------------------------------
// createTeamPrompt
// ---------------------------------------------------------------------------

describe("createTeamPrompt", () => {
  it("returns a ChatPromptTemplate", () => {
    expect(createPlannerPrompt()).toBeInstanceOf(ChatPromptTemplate);
  });

  it("includes a chat_history MessagesPlaceholder", () => {
    const placeholders = getPlaceholderNames(createPlannerPrompt());
    expect(placeholders).toContain("chat_history");
  });

  it("includes an {input} slot in the human message", () => {
    const contents = getMessageContents(createPlannerPrompt());
    expect(contents.some((c) => c.includes("{input}"))).toBe(true);
  });

  it("has exactly 2 non-placeholder messages (system + human)", () => {
    const contents = getMessageContents(createPlannerPrompt());
    expect(contents).toHaveLength(2);
  });

  it("returns a new instance on each call", () => {
    expect(createPlannerPrompt()).not.toBe(createPlannerPrompt());
  });
});

// ---------------------------------------------------------------------------
// createDeveloperPrompt
// ---------------------------------------------------------------------------

describe("createDeveloperPrompt", () => {
  it("returns a ChatPromptTemplate", () => {
    expect(createDeveloperPrompt()).toBeInstanceOf(ChatPromptTemplate);
  });

  it("does NOT include a chat_history placeholder", () => {
    const placeholders = getPlaceholderNames(createDeveloperPrompt());
    expect(placeholders).not.toContain("chat_history");
  });

  it("includes an {input} slot in the human message", () => {
    const contents = getMessageContents(createDeveloperPrompt());
    expect(contents.some((c) => c.includes("{input}"))).toBe(true);
  });

  it("has exactly 2 messages (system + human)", () => {
    expect(createDeveloperPrompt().promptMessages).toHaveLength(2);
  });

  it("system message mentions reading files and implementing changes", () => {
    const contents = getMessageContents(createDeveloperPrompt());
    const systemMsg = contents[0];
    expect(systemMsg).toMatch(/read/i);
    expect(systemMsg).toMatch(/implement/i);
  });

  it("returns a new instance on each call", () => {
    expect(createDeveloperPrompt()).not.toBe(createDeveloperPrompt());
  });
});

// ---------------------------------------------------------------------------
// createTesterPrompt
// ---------------------------------------------------------------------------

describe("createTesterPrompt", () => {
  it("returns a ChatPromptTemplate", () => {
    expect(createTesterPrompt()).toBeInstanceOf(ChatPromptTemplate);
  });

  it("does NOT include a chat_history placeholder", () => {
    const placeholders = getPlaceholderNames(createTesterPrompt());
    expect(placeholders).not.toContain("chat_history");
  });

  it("includes an {input} slot in the human message", () => {
    const contents = getMessageContents(createTesterPrompt());
    expect(contents.some((c) => c.includes("{input}"))).toBe(true);
  });

  it("has exactly 2 messages (system + human)", () => {
    expect(createTesterPrompt().promptMessages).toHaveLength(2);
  });

  it("system message references pnpm test and typecheck commands", () => {
    const contents = getMessageContents(createTesterPrompt());
    const systemMsg = contents[0];
    expect(systemMsg).toMatch(/pnpm test/i);
    expect(systemMsg).toMatch(/tsc/i);
  });

  it("returns a new instance on each call", () => {
    expect(createTesterPrompt()).not.toBe(createTesterPrompt());
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: structural consistency
// ---------------------------------------------------------------------------

describe("prompt factory structural consistency", () => {
  it("team prompt carries chat_history; developer and tester do not", () => {
    expect(getPlaceholderNames(createPlannerPrompt())).toContain("chat_history");
    expect(getPlaceholderNames(createDeveloperPrompt())).not.toContain("chat_history");
    expect(getPlaceholderNames(createTesterPrompt())).not.toContain("chat_history");
  });

  it("all three prompts expose an {input} variable", () => {
    const factories = [createPlannerPrompt, createDeveloperPrompt, createTesterPrompt];
    for (const factory of factories) {
      const template = factory();
      expect(template.inputVariables).toContain("input");
    }
  });

  it("chat_history-bearing prompts expose chat_history as an input variable", () => {
    expect(createPlannerPrompt().inputVariables).toContain("chat_history");
  });
});
