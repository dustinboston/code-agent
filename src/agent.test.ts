import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadAgentsFile, readAgentsFile } from "./agent";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// List of files that might be created by the tests or looked for by the functions
const TEST_FILES = [
  "AGENTS.md",
  "AGENT.md",
  "CLAUDE.md",
  "GEMINI.md",
  "README.md",
  "test_file.md", // For readAgentsFile tests
];

describe("agent.ts", () => {
  // Clean up any potential test files before each test to ensure a clean slate
  beforeEach(() => {
    TEST_FILES.forEach((file) => {
      const filePath = resolve(file);
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
      }
    });
  });

  // Clean up any potential test files after each test
  afterEach(() => {
    TEST_FILES.forEach((file) => {
      const filePath = resolve(file);
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
      }
    });
  });

  describe("readAgentsFile", () => {
    it("should return the content of an existing file", async () => {
      const fileName = "test_file.md";
      const fileContent = "This is a test file content.";
      writeFileSync(resolve(fileName), fileContent, "utf-8");

      const result = await readAgentsFile(fileName);
      expect(result).toBe(fileContent);
    });

    it("should return an empty string for a non-existing file", async () => {
      const fileName = "non_existent_file.md"; // This file will not be created
      const result = await readAgentsFile(fileName);
      expect(result).toBe("");
    });

    it("should return an empty string if file exists but is empty", async () => {
      const fileName = "test_file.md";
      const fileContent = "";
      writeFileSync(resolve(fileName), fileContent, "utf-8");

      const result = await readAgentsFile(fileName);
      expect(result).toBe(fileContent);
    });
  });

  describe("loadAgentsFile", () => {
    it("should return the content of AGENTS.md if it exists", async () => {
      const content = "Content from AGENTS.md";
      writeFileSync(resolve("AGENTS.md"), content, "utf-8");

      const result = await loadAgentsFile();
      expect(result).toBe(content);
    });

    it("should return the content of AGENT.md if AGENTS.md does not exist but AGENT.md does", async () => {
      const content = "Content from AGENT.md";
      writeFileSync(resolve("AGENT.md"), content, "utf-8");

      const result = await loadAgentsFile();
      expect(result).toBe(content);
    });

    it("should return the content of CLAUDE.md if AGENTS.md and AGENT.md do not exist but CLAUDE.md does", async () => {
      const content = "Content from CLAUDE.md";
      writeFileSync(resolve("CLAUDE.md"), content, "utf-8");

      const result = await loadAgentsFile();
      expect(result).toBe(content);
    });

    it("should return the content of GEMINI.md if AGENTS.md, AGENT.md, and CLAUDE.md do not exist but GEMINI.md does", async () => {
      const content = "Content from GEMINI.md";
      writeFileSync(resolve("GEMINI.md"), content, "utf-8");

      const result = await loadAgentsFile();
      expect(result).toBe(content);
    });

    it("should return the content of README.md if none of the preferred agent files exist but README.md does", async () => {
      const content = "Content from README.md";
      writeFileSync(resolve("README.md"), content, "utf-8");

      const result = await loadAgentsFile();
      expect(result).toBe(content);
    });

    it("should return an empty string if none of the fallback files exist", async () => {
      const result = await loadAgentsFile();
      expect(result).toBe("");
    });

    it("should prioritize AGENTS.md over other files if multiple exist", async () => {
      writeFileSync(resolve("AGENTS.md"), "AGENTS.md content", "utf-8");
      writeFileSync(resolve("AGENT.md"), "AGENT.md content", "utf-8");
      writeFileSync(resolve("CLAUDE.md"), "CLAUDE.md content", "utf-8");

      const result = await loadAgentsFile();
      expect(result).toBe("AGENTS.md content");
    });

    it("should prioritize AGENT.md over CLAUDE.md if AGENTS.md does not exist but others do", async () => {
      writeFileSync(resolve("AGENT.md"), "AGENT.md content", "utf-8");
      writeFileSync(resolve("CLAUDE.md"), "CLAUDE.md content", "utf-8");

      const result = await loadAgentsFile();
      expect(result).toBe("AGENT.md content");
    });

    it("should prioritize CLAUDE.md over GEMINI.md if AGENTS.md, AGENT.md do not exist but others do", async () => {
      writeFileSync(resolve("CLAUDE.md"), "CLAUDE.md content", "utf-8");
      writeFileSync(resolve("GEMINI.md"), "GEMINI.md content", "utf-8");

      const result = await loadAgentsFile();
      expect(result).toBe("CLAUDE.md content");
    });

    it("should prioritize GEMINI.md over README.md if AGENTS.md, AGENT.md, CLAUDE.md do not exist but others do", async () => {
      writeFileSync(resolve("GEMINI.md"), "GEMINI.md content", "utf-8");
      writeFileSync(resolve("README.md"), "README.md content", "utf-8");

      const result = await loadAgentsFile();
      expect(result).toBe("GEMINI.md content");
    });
  });
});
