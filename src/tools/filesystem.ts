/**
 * @module tools/filesystem
 *
 * Exposes LangChain `DynamicStructuredTool` wrappers around Node.js `fs`
 * operations so the LLM agent can read, write, and list files on the local
 * filesystem. All tool arguments are validated at runtime via Zod schemas
 * before the underlying `fs/promises` calls are made.
 */
import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";

/**
 * Reads a file at the given path and returns its full contents as a UTF-8
 * string. Relative paths are resolved against `process.cwd()` before the
 * file is opened. If the read fails for any reason (file not found,
 * permission denied, etc.) an error string is returned instead of throwing,
 * so the calling agent can self-correct.
 */
export const readFileTool = tool(
  async ({ path }: { path: string }) => {
    try {
      return await readFile(resolve(path), "utf-8");
    } catch (e) {
      return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
  {
    name: "read_file",
    description: "Read the full contents of a file. Returns the file contents as text.",
    schema: z.object({
      path: z.string().describe("Path to the file"),
    }),
  }
);

/**
 * Lists the entries (files and sub-directories) inside the directory at the
 * given path. Each entry is prefixed with `[dir] ` or `[file]` so the agent
 * can distinguish directories from regular files at a glance. Relative paths
 * are resolved against `process.cwd()`. Returns an error string on failure.
 */
export const listDirectoryTool = tool(
  async ({ path }: { path: string }) => {
    try {
      const entries = await readdir(resolve(path), { withFileTypes: true });
      return entries.map((e) => `${e.isDirectory() ? "[dir] " : "[file]"} ${e.name}`).join("\n");
    } catch (e) {
      return `Error listing directory: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
  {
    name: "list_directory",
    description: "List the files and subdirectories at the given path.",
    schema: z.object({
      path: z.string().describe("Path to the directory"),
    }),
  }
);

/**
 * Writes `content` to the file at `path`, creating any missing parent
 * directories recursively as needed. If the file already exists it is
 * overwritten in full. Relative paths are resolved against `process.cwd()`.
 * Returns a confirmation string on success or an error string on failure.
 */
export const writeFileTool = tool(
  async ({ path, content }: { path: string; content: string }) => {
    try {
      const resolved = resolve(path);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");
      return `File written: ${resolved}`;
    } catch (e) {
      return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
  {
    name: "write_file",
    description: "Write content to a file, creating parent directories as needed. Overwrites existing files.",
    schema: z.object({
      path: z.string().describe("Path to the file"),
      content: z.string().describe("Content to write"),
    }),
  }
);

/**
 * Convenience array that bundles {@link readFileTool}, {@link listDirectoryTool},
 * and {@link writeFileTool} together so they can be passed to
 * `llm.bindTools(filesystemTools)` in a single expression when wiring up an
 * LLM agent.
 */
export const filesystemTools: DynamicStructuredTool[] = [readFileTool, listDirectoryTool, writeFileTool];
