import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const runCommandTool = tool(
  async ({ command }: { command: string }) => {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: process.cwd() });
      return [stdout, stderr].filter(Boolean).join("\n") || "(no output)";
    } catch (e: unknown) {
      const err = e as { code?: number; stdout?: string; stderr?: string };
      const out = [err.stdout, err.stderr].filter(Boolean).join("\n");
      return `Exit code ${err.code ?? 1}:\n${out || String(e)}`;
    }
  },
  {
    name: "run_command",
    description:
      "Run a shell command and return its output. Use this to run tests (e.g. 'pnpm test -- --run'), " +
      "type-check ('pnpm exec tsc --noEmit'), or verify code changes.",
    schema: z.object({
      command: z.string().describe("The shell command to run"),
    }),
  }
);
