import { describe, it, expect, mock, beforeEach, Mock } from "bun:test";
import { readFileTool, listDirectoryTool, writeFileTool } from "./filesystem";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";

// Mock fs/promises module
mock.module("fs/promises", () => ({
  readFile: mock(() => {}),
  readdir: mock(() => {}),
  writeFile: mock(() => {}),
  mkdir: mock(() => {}),
}));

// Mock path module with inline implementations (importOriginal not supported in Bun)
mock.module("path", () => ({
  resolve: mock((p: string) => {
    // Paths with .. are treated as sandbox escapes for testing
    if (p.includes("..")) return "/outside/path";
    return p;
  }),
  dirname: mock((p: string) => {
    const idx = p.lastIndexOf("/");
    return idx === -1 ? "." : p.substring(0, idx);
  }),
  relative: mock((from: string, to: string) => {
    if (to === "/outside/path") return "../../outside";
    // For same-directory paths, return as-is (no traversal)
    return to;
  }),
  isAbsolute: mock((p: string) => p.startsWith("/") || /^[A-Za-z]:/.test(p)),
}));

describe("Filesystem Tools", () => {
  beforeEach(() => {
    // Clear mock call counts between tests
    (readFile as any).mockReset();
    (readdir as any).mockReset();
    (writeFile as any).mockReset();
    (mkdir as any).mockReset();
  });

  describe("readFileTool", () => {
    it("should read the content of an existing file", async () => {
      (readFile as any).mockResolvedValue("file content");
      const result = await readFileTool.call({ path: "test.txt" });
      expect(readFile).toHaveBeenCalledWith("test.txt", "utf-8");
      expect(result).toBe("file content");
    });

    it("should return an error string if the file does not exist", async () => {
      (readFile as any).mockRejectedValue(new Error("File not found"));
      const result = await readFileTool.call({ path: "nonexistent.txt" });
      expect(readFile).toHaveBeenCalledWith("nonexistent.txt", "utf-8");
      expect(result).toContain("Error reading file: File not found");
    });

    it("should return an error string for other read errors", async () => {
      (readFile as any).mockRejectedValue("Permission denied");
      const result = await readFileTool.call({ path: "protected.txt" });
      expect(readFile).toHaveBeenCalledWith("protected.txt", "utf-8");
      expect(result).toContain("Error reading file: Permission denied");
    });

    it("should return an error string if path escapes workspace", async () => {
      const result = await readFileTool.call({ path: "../../etc/passwd" });
      expect(readFile).not.toHaveBeenCalled();
      expect(result).toContain("Error: Access denied.");
    });
  });

  describe("listDirectoryTool", () => {
    it("should list files and directories correctly", async () => {
      (readdir as any).mockResolvedValue([
        { name: "file1.txt", isDirectory: () => false, isFile: () => true, isBlockDevice: () => false, isCharacterDevice: () => false, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false },
        { name: "subdir", isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false },
      ] as any);
      const result = await listDirectoryTool.call({ path: "testdir" });
      expect(readdir).toHaveBeenCalledWith("testdir", { withFileTypes: true });
      expect(result).toBe("[file] file1.txt\n[dir]  subdir");
    });

    it("should return an empty string for an empty directory", async () => {
      (readdir as any).mockResolvedValue([]);
      const result = await listDirectoryTool.call({ path: "emptydir" });
      expect(readdir).toHaveBeenCalledWith("emptydir", { withFileTypes: true });
      expect(result).toBe("");
    });

    it("should return an error string if the directory does not exist", async () => {
      (readdir as any).mockRejectedValue(new Error("Directory not found"));
      const result = await listDirectoryTool.call({ path: "nonexistentdir" });
      expect(readdir).toHaveBeenCalledWith("nonexistentdir", { withFileTypes: true });
      expect(result).toContain("Error listing directory: Directory not found");
    });
  });

  describe("writeFileTool", () => {
    it("should write content to a new file and create parent directories", async () => {
      (mkdir as any).mockResolvedValue(undefined);
      (writeFile as any).mockResolvedValue(undefined);
      const result = await writeFileTool.call({ path: "newdir/newfile.txt", content: "new content" });
      expect(mkdir).toHaveBeenCalledWith("newdir", { recursive: true });
      expect(writeFile).toHaveBeenCalledWith("newdir/newfile.txt", "new content", "utf-8");
      expect(result).toBe("File written: newdir/newfile.txt");
    });

    it("should overwrite an existing file", async () => {
      (mkdir as any).mockResolvedValue(undefined);
      (writeFile as any).mockResolvedValue(undefined);
      const result = await writeFileTool.call({ path: "existing.txt", content: "updated content" });
      expect(mkdir).toHaveBeenCalledWith(".", { recursive: true }); // dirname of "existing.txt" is "."
      expect(writeFile).toHaveBeenCalledWith("existing.txt", "updated content", "utf-8");
      expect(result).toBe("File written: existing.txt");
    });

    it("should return an error string on write failure", async () => {
      (mkdir as any).mockResolvedValue(undefined);
      (writeFile as any).mockRejectedValue(new Error("Disk full"));
      const result = await writeFileTool.call({ path: "fail.txt", content: "some content" });
      expect(writeFile).toHaveBeenCalledWith("fail.txt", "some content", "utf-8");
      expect(result).toContain("Error writing file: Disk full");
    });

    it("should return an error string on mkdir failure", async () => {
      (mkdir as any).mockRejectedValue(new Error("Permission denied to create directory"));
      (writeFile as any).mockResolvedValue(undefined);
      const result = await writeFileTool.call({ path: "protecteddir/file.txt", content: "some content" });
      expect(mkdir).toHaveBeenCalledWith("protecteddir", { recursive: true });
      expect(writeFile).not.toHaveBeenCalled();
      expect(result).toContain("Error writing file: Permission denied to create directory");
    });
  });
});
