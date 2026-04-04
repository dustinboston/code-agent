import { describe, it, expect } from "bun:test";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { createPlannerPrompt, createDeveloperPrompt, createTesterPrompt } from "./prompt.js";

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
      // New SystemMessage(agentsFile) exposes its content via `.content`
      if ((m as any).content) return (m as any).content;
      const prompt = (m as any).prompt;
      return prompt?.template || "";
    });
}

// ---------------------------------------------------------------------------
// createTeamPrompt
// ---------------------------------------------------------------------------

describe("createTeamPrompt", () => {
  it("returns a ChatPromptTemplate", async () => {
    expect(await createPlannerPrompt()).toBeInstanceOf(ChatPromptTemplate);
  });

  it("includes a chat_history MessagesPlaceholder", async () => {
    const placeholders = getPlaceholderNames(await createPlannerPrompt());
    expect(placeholders).toContain("chat_history");
  });

  it("includes an {input} slot in the human message", async () => {
    const contents = getMessageContents(await createPlannerPrompt());
    expect(contents.some((c) => c.includes("{input}"))).toBe(true);
  });

  it("has exactly 3 non-placeholder messages (system + agents + human)", async () => {
    const contents = getMessageContents(await createPlannerPrompt());
    expect(contents).toHaveLength(2);
  });

  it("returns a new instance on each call", async () => {
    expect(await createPlannerPrompt()).not.toBe(await createPlannerPrompt());
  });
});

// ---------------------------------------------------------------------------
// createDeveloperPrompt
// ---------------------------------------------------------------------------

describe("createDeveloperPrompt", () => {
  it("returns a ChatPromptTemplate", async () => {
    expect(await createDeveloperPrompt()).toBeInstanceOf(ChatPromptTemplate);
  });

  it("does NOT include a chat_history placeholder", async () => {
    const placeholders = getPlaceholderNames(await createDeveloperPrompt());
    expect(placeholders).not.toContain("chat_history");
  });

  it("includes an {input} slot in the human message", async () => {
    const contents = getMessageContents(await createDeveloperPrompt());
    expect(contents.some((c) => c.includes("{input}"))).toBe(true);
  });

  it("has exactly 2 messages (system + agents + human)", async () => {
    expect((await createDeveloperPrompt()).promptMessages).toHaveLength(2);
  });

  it("system message mentions reading files and implementing changes", async () => {
    const contents = getMessageContents(await createDeveloperPrompt());
    const systemMsg = contents[0];
    expect(systemMsg).toMatch(/read/i);
    expect(systemMsg).toMatch(/implement/i);
  });

  it("returns a new instance on each call", async () => {
    expect(await createDeveloperPrompt()).not.toBe(await createDeveloperPrompt());
  });
});

// ---------------------------------------------------------------------------
// createTesterPrompt
// ---------------------------------------------------------------------------

describe("createTesterPrompt", () => {
  it("returns a ChatPromptTemplate", async () => {
    expect(await createTesterPrompt()).toBeInstanceOf(ChatPromptTemplate);
  });

  it("does NOT include a chat_history placeholder", async () => {
    const placeholders = getPlaceholderNames(await createTesterPrompt());
    expect(placeholders).not.toContain("chat_history");
  });

  it("includes an {input} slot in the human message", async () => {
    const contents = getMessageContents(await createTesterPrompt());
    expect(contents.some((c) => c.includes("{input}"))).toBe(true);
  });

  it("has exactly 2 messages (system + agents + human)", async () => {
    expect((await createTesterPrompt()).promptMessages).toHaveLength(2);
  });

  it("system message references bun test and typecheck commands", async () => {
    const contents = getMessageContents(await createTesterPrompt());
    const systemMsg = contents[0];
    expect(systemMsg).toMatch(/bun test/i);
    expect(systemMsg).toMatch(/tsc/i);
  });

  it("returns a new instance on each call", async () => {
    expect(await createTesterPrompt()).not.toBe(await createTesterPrompt());
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: structural consistency
// ---------------------------------------------------------------------------

describe("prompt factory structural consistency", () => {
  it("team prompt carries chat_history; developer and tester do not", async () => {
    expect(getPlaceholderNames(await createPlannerPrompt())).toContain("chat_history");
    expect(getPlaceholderNames(await createDeveloperPrompt())).not.toContain("chat_history");
    expect(getPlaceholderNames(await createTesterPrompt())).not.toContain("chat_history");
  });

  it("all three prompts expose an {input} variable", async () => {
    const factories = [createPlannerPrompt, createDeveloperPrompt, createTesterPrompt];
    for (const factory of factories) {
      const template = await factory();
      expect(template.inputVariables).toContain("input");
    }
  });

  it("chat_history-bearing prompts expose chat_history as an input variable", async () => {
    expect((await createPlannerPrompt()).inputVariables).toContain("chat_history");
  });
});
