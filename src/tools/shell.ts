/**
 * @module tools/shell
 *
 * Provides a LangChain tool that executes arbitrary shell commands in the
 * project's working directory via Node.js `child_process.exec`. A hard
 * 30-second timeout guard prevents runaway processes (e.g. watch-mode servers)
 * from blocking the agent loop indefinitely. The `NODE_OPTIONS` environment
 * variable is cleared before each invocation so that the TUI's `tsx` loader
 * does not conflict with Vitest's own worker-thread bootstrapping.
 */
import process from 'node:process';
import {exec} from 'node:child_process';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
// Promisify removed in favor of manual Promise around exec

/**
 * Runs an arbitrary shell command in the project's working directory
 * (`process.cwd()`) and returns the combined stdout and stderr output as a
 * single string.
 *
 * Key behaviours:
 * - **Timeout** — the command is forcibly killed after 30 seconds to prevent
 *   long-running processes (e.g. `vite -w`) from hanging the agent loop.
 * - **`NODE_OPTIONS` clearing** — the variable is removed from the child
 *   process environment so the TUI's `tsx` ESM loader does not propagate into
 *   Vitest worker threads and cause loader conflicts.
 * - **Error handling** — when the command exits with a non-zero code (or times
 *   out), the exit code and any captured output are returned as a plain string
 *   rather than throwing, allowing the agent to inspect the failure and
 *   self-correct.
 */
export const runCommandTool = tool(
  async ({command}: {command: string}) => {
    try {
      // Pass a timeout to prevent the agent from hanging the app forever if it runs `vite -w` or similar.
      // Clear NODE_OPTIONS so the TUI's `tsx` loader doesn't interfere with Vitest's own worker threads.
      const {stdout, stderr} = await new Promise<{stdout: string; stderr: string}>((resolve, reject) => {
        exec(
          command,
          {
            cwd: process.cwd(),
            timeout: 30_000,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- environment variable
            env: {...process.env, NODE_OPTIONS: undefined},
          },
          (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve({stdout, stderr});
          },
        );
      });
      return [stdout, stderr].filter(Boolean).join('\n') || '(no output)';
    } catch (error: unknown) {
      const isObject = error !== null && error !== undefined && typeof error === 'object';
      const code = isObject && 'code' in error ? String(error.code) : 'unknown';
      const stdout = isObject && 'stdout' in error ? String(error.stdout) : '';
      const stderr = isObject && 'stderr' in error ? String(error.stderr) : '';
      const out = [stdout, stderr].filter(Boolean).join('\n');
      return `Exit code ${code} (or timeout):\n${out || String(error)}`;
    }
  },
  {
    name: 'run_command',
    description:
      'Run a shell command and return its output. This is a last resort if no other tools can handle the request.',
    schema: z.object({
      command: z.string().describe('The shell command to run'),
    }),
  },
);
