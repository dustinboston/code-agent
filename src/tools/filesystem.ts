import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";

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

export const filesystemTools: DynamicStructuredTool[] = [readFileTool, listDirectoryTool, writeFileTool];
