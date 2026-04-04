import { describe, it, expect, mock, beforeEach, Mock } from "bun:test";
import type { ExecOptions, ExecException, ChildProcess } from "child_process";
import { promisify } from "util";

// Mock child_process before importing shell.ts so that promisify(exec) uses our mock.
// The factory creates exec inline (no module-level variable references) to avoid TDZ issues.
// promisify.custom is set so that promisify(exec) returns our async wrapper.
mock.module("child_process", () => {
  const execMock = mock((
    command: string,
    options: ExecOptions | null | undefined,
    callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
  ) => {
    if (typeof callback === "function") {
      process.nextTick(() => callback(null, "", ""));
    }
    return {} as ChildProcess;
  });



  return { exec: execMock };
});

// Import after mock is registered
import { runCommandTool } from "./shell";
import { exec } from "child_process"; // Gets the mocked exec

// Reference to the mock for assertions and per-test setup
const mockedExec = exec as unknown as Mock<typeof exec>;

describe("Shell Tools", () => {
  beforeEach(() => {
    mockedExec.mockClear();
    // Restore default: successful empty output
    (mockedExec as any).mockImplementation((
      command: string,
      options: ExecOptions | null | undefined,
      callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
    ) => {
      if (typeof callback === "function") {
        process.nextTick(() => callback(null, "", ""));
      }
      return {} as ChildProcess;
    });
  });

  describe("runCommandTool", () => {
    it("should execute a command and return stdout", async () => {
      (mockedExec as any).mockImplementationOnce((
        command: string,
        options: ExecOptions | null | undefined,
        callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
      ) => {
        if (typeof callback === "function") {
          process.nextTick(() => callback(null, "hello from stdout", ""));
        }
        return {} as ChildProcess;
      });

      const result = await runCommandTool.call({ command: "echo hello" });

      expect(mockedExec).toHaveBeenCalledTimes(1);
      const [commandArg, optionsArg, callbackArg] = mockedExec.mock.calls[0];
      expect(commandArg).toBe("echo hello");
      expect(optionsArg!.cwd).toBe(process.cwd());
      expect(optionsArg!.timeout).toBe(30000);
      expect(optionsArg!.env!.NODE_OPTIONS).toBeUndefined();
      expect(typeof callbackArg).toBe("function");
      expect(result).toBe("hello from stdout");
    });

    it("should execute a command and return stderr", async () => {
      (mockedExec as any).mockImplementationOnce((
        command: string,
        options: ExecOptions | null | undefined,
        callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
      ) => {
        if (typeof callback === "function") {
          process.nextTick(() => callback(null, "", "hello from stderr"));
        }
        return {} as ChildProcess;
      });

      const result = await runCommandTool.call({ command: ">&2 echo hello" });

      expect(mockedExec).toHaveBeenCalledTimes(1);
      const [commandArg, optionsArg, callbackArg] = mockedExec.mock.calls[0];
      expect(commandArg).toBe(">&2 echo hello");
      expect(optionsArg!.cwd).toBe(process.cwd());
      expect(optionsArg!.timeout).toBe(30000);
      expect(optionsArg!.env!.NODE_OPTIONS).toBeUndefined();
      expect(typeof callbackArg).toBe("function");
      expect(result).toBe("hello from stderr");
    });

    it("should return combined stdout and stderr", async () => {
      (mockedExec as any).mockImplementationOnce((
        command: string,
        options: ExecOptions | null | undefined,
        callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
      ) => {
        if (typeof callback === "function") {
          process.nextTick(() => callback(null, "out", "err"));
        }
        return {} as ChildProcess;
      });

      const result = await runCommandTool.call({ command: "command" });
      expect(result).toBe("out\nerr");
    });

    it("should return '(no output)' if command produces no output", async () => {
      (mockedExec as any).mockImplementationOnce((
        command: string,
        options: ExecOptions | null | undefined,
        callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
      ) => {
        if (typeof callback === "function") {
          process.nextTick(() => callback(null, "", ""));
        }
        return {} as ChildProcess;
      });

      const result = await runCommandTool.call({ command: "true" });
      expect(result).toBe("(no output)");
    });

    it("should return an error string if the command fails", async () => {
      const error = new Error("Command failed") as ExecException;
      error.code = 1;
      error.stdout = "partial output";
      error.stderr = "error message";

      (mockedExec as any).mockImplementationOnce((
        command: string,
        options: ExecOptions | null | undefined,
        callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
      ) => {
        if (typeof callback === "function") {
          process.nextTick(() => callback(error, "partial output", "error message"));
        }
        return {} as ChildProcess;
      });

      const result = await runCommandTool.call({ command: "false" });

      expect(mockedExec).toHaveBeenCalledTimes(1);
      const [commandArg, optionsArg, callbackArg] = mockedExec.mock.calls[0];
      expect(commandArg).toBe("false");
      expect(optionsArg!.cwd).toBe(process.cwd());
      expect(optionsArg!.timeout).toBe(30000);
      expect(optionsArg!.env!.NODE_OPTIONS).toBeUndefined();
      expect(typeof callbackArg).toBe("function");
      expect(result).toContain("Exit code 1 (or timeout):\npartial output\nerror message");
    });

    it("should handle command timeout", async () => {
      const timeoutError = new Error("Command timed out") as ExecException;
      timeoutError.killed = true;
      timeoutError.signal = "SIGTERM";

      // Use mockImplementationOnce instead of re-registering mock.module
      (mockedExec as any).mockImplementationOnce((
        command: string,
        options: ExecOptions | null | undefined,
        callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
      ) => {
        if (typeof callback === "function") {
          setTimeout(() => {
            callback(timeoutError, "", "");
          }, 10);
        }
        return {} as ChildProcess;
      });

      const result = await runCommandTool.call({ command: "sleep 5" });
      expect(result).toContain("Exit code unknown (or timeout):\nError: Command timed out");
    });

    it("should ensure NODE_OPTIONS is undefined in the child process environment", async () => {
      process.env.NODE_OPTIONS = "--require tsx";

      (mockedExec as any).mockImplementationOnce((
        command: string,
        options: ExecOptions | null | undefined,
        callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
      ) => {
        if (typeof callback === "function") {
          process.nextTick(() => callback(null, "", ""));
        }
        return {} as ChildProcess;
      });

      await runCommandTool.call({ command: "env" });

      expect(mockedExec).toHaveBeenCalledTimes(1);
      const [commandArg, optionsArg, callbackArg] = mockedExec.mock.calls[0];
      expect(commandArg).toBe("env");
      expect(optionsArg!.cwd).toBe(process.cwd());
      expect(optionsArg!.timeout).toBe(30000);
      expect(optionsArg!.env!.NODE_OPTIONS).toBeUndefined();
      expect(typeof callbackArg).toBe("function");

      delete process.env.NODE_OPTIONS;
    });
  });
});
