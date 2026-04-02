import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileTool, listDirectoryTool, writeFileTool } from "./filesystem";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";

// Mock fs/promises module
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock path module to control resolve behavior
vi.mock("path", () => ({
  resolve: vi.fn((p) => p), // Simply return the path as is for testing
  dirname: vi.fn((p) => p.substring(0, p.lastIndexOf('/')) || '.'),
}));

describe("Filesystem Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("readFileTool", () => {
    it("should read the content of an existing file", async () => {
      vi.mocked(readFile).mockResolvedValue("file content");
      const result = await readFileTool.call({ path: "test.txt" });
      expect(readFile).toHaveBeenCalledWith("test.txt", "utf-8");
      expect(result).toBe("file content");
    });

    it("should return an error string if the file does not exist", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("File not found"));
      const result = await readFileTool.call({ path: "nonexistent.txt" });
      expect(readFile).toHaveBeenCalledWith("nonexistent.txt", "utf-8");
      expect(result).toContain("Error reading file: File not found");
    });

    it("should return an error string for other read errors", async () => {
      vi.mocked(readFile).mockRejectedValue("Permission denied");
      const result = await readFileTool.call({ path: "protected.txt" });
      expect(readFile).toHaveBeenCalledWith("protected.txt", "utf-8");
      expect(result).toContain("Error reading file: Permission denied");
    });
  });

  describe("listDirectoryTool", () => {
    it("should list files and directories correctly", async () => {
      vi.mocked(readdir).mockResolvedValue([
        { name: "file1.txt", isDirectory: () => false, isFile: () => true, isBlockDevice: () => false, isCharacterDevice: () => false, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false },
        { name: "subdir", isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false },
      ] as any);
      const result = await listDirectoryTool.call({ path: "testdir" });
      expect(readdir).toHaveBeenCalledWith("testdir", { withFileTypes: true });
      expect(result).toBe("[file] file1.txt\n[dir]  subdir");
    });

    it("should return an empty string for an empty directory", async () => {
      vi.mocked(readdir).mockResolvedValue([]);
      const result = await listDirectoryTool.call({ path: "emptydir" });
      expect(readdir).toHaveBeenCalledWith("emptydir", { withFileTypes: true });
      expect(result).toBe("");
    });

    it("should return an error string if the directory does not exist", async () => {
      vi.mocked(readdir).mockRejectedValue(new Error("Directory not found"));
      const result = await listDirectoryTool.call({ path: "nonexistentdir" });
      expect(readdir).toHaveBeenCalledWith("nonexistentdir", { withFileTypes: true });
      expect(result).toContain("Error listing directory: Directory not found");
    });
  });

  describe("writeFileTool", () => {
    it("should write content to a new file and create parent directories", async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);
      const result = await writeFileTool.call({ path: "newdir/newfile.txt", content: "new content" });
      expect(mkdir).toHaveBeenCalledWith("newdir", { recursive: true });
      expect(writeFile).toHaveBeenCalledWith("newdir/newfile.txt", "new content", "utf-8");
      expect(result).toBe("File written: newdir/newfile.txt");
    });

    it("should overwrite an existing file", async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined); // mkdir might still be called even if dir exists
      vi.mocked(writeFile).mockResolvedValue(undefined);
      const result = await writeFileTool.call({ path: "existing.txt", content: "updated content" });
      expect(mkdir).toHaveBeenCalledWith(".", { recursive: true }); // dirname of "existing.txt" is "."
      expect(writeFile).toHaveBeenCalledWith("existing.txt", "updated content", "utf-8");
      expect(result).toBe("File written: existing.txt");
    });

    it("should return an error string on write failure", async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockRejectedValue(new Error("Disk full"));
      const result = await writeFileTool.call({ path: "fail.txt", content: "some content" });
      expect(writeFile).toHaveBeenCalledWith("fail.txt", "some content", "utf-8");
      expect(result).toContain("Error writing file: Disk full");
    });

    it("should return an error string on mkdir failure", async () => {
      vi.mocked(mkdir).mockRejectedValue(new Error("Permission denied to create directory"));
      // writeFile should not be called if mkdir fails, so we mock it to ensure it's not called
      vi.mocked(writeFile).mockResolvedValue(undefined);
      const result = await writeFileTool.call({ path: "protecteddir/file.txt", content: "some content" });
      expect(mkdir).toHaveBeenCalledWith("protecteddir", { recursive: true });
      expect(writeFile).not.toHaveBeenCalled(); // Assertion after the call
      expect(result).toContain("Error writing file: Permission denied to create directory");
    });
  });
});
