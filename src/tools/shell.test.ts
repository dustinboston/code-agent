import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from "vitest"; // Import MockedFunction
import type { ExecOptions, ExecException, ChildProcess } from "child_process";
import { promisify } from "util";

vi.mock("child_process", async () => {
  const mockExec = vi.fn((
    command: string,
    options: ExecOptions | null | undefined,
    callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
  ) => {
    if (typeof callback === 'function') {
      process.nextTick(() => callback(null, "", ""));
    }
    return {} as ChildProcess;
  });

  Object.defineProperty(mockExec, promisify.custom, {
    value: (command: string, options: ExecOptions) => {
      return new Promise((resolve, reject) => {
        mockExec(command, options, (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });
    },
    configurable: true,
  });

  return {
    exec: mockExec,
  };
});

// Now import the module after mocks are set up
import { runCommandTool } from "./shell";
import { exec } from "child_process"; // Import exec from the mocked module

// Get a reference to the mocked exec for testing
const mockedExec = exec as MockedFunction<typeof exec>; // Use imported MockedFunction

describe("Shell Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExec.mockImplementation((
      command: string,
      options: ExecOptions | null | undefined, // Use imported types
      callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined // Use imported types
    ) => {
      if (typeof callback === 'function') {
        process.nextTick(() => callback(null, "", ""));
      }
      return {} as ChildProcess; // Use imported type
    });
  });

  it("should execute a command and return stdout", async () => {
    mockedExec.mockImplementationOnce((
      command: string,
      options: ExecOptions | null | undefined, // Use imported types
      callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
    ) => {
      if (typeof callback === 'function') {
        process.nextTick(() => callback(null, "hello from stdout", ""));
      }
      return {} as ChildProcess; // Use imported type
    });

    const result = await runCommandTool.call({ command: "echo hello" });

    expect(mockedExec).toHaveBeenCalledTimes(1);
    const [commandArg, optionsArg, callbackArg] = mockedExec.mock.calls[0];
    expect(commandArg).toBe("echo hello");
    // Use non-null assertions as runCommandTool always passes an object for options
    expect(optionsArg!.cwd).toBe(process.cwd());
    expect(optionsArg!.timeout).toBe(30000);
    expect(optionsArg!.env!.NODE_OPTIONS).toBeUndefined();
    expect(typeof callbackArg).toBe('function');
    expect(result).toBe("hello from stdout");
  });

  it("should execute a command and return stderr", async () => {
    mockedExec.mockImplementationOnce((
      command: string,
      options: ExecOptions | null | undefined,
      callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
    ) => {
      if (typeof callback === 'function') {
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
    expect(typeof callbackArg).toBe('function');
    expect(result).toBe("hello from stderr");
  });

  it("should return combined stdout and stderr", async () => {
    mockedExec.mockImplementationOnce((
      command: string,
      options: ExecOptions | null | undefined,
      callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
    ) => {
      if (typeof callback === 'function') {
        process.nextTick(() => callback(null, "out", "err"));
      }
      return {} as ChildProcess;
    });

    const result = await runCommandTool.call({ command: "command" });
    expect(result).toBe("out\nerr");
  });

  it("should return '(no output)' if command produces no output", async () => {
    mockedExec.mockImplementationOnce((
      command: string,
      options: ExecOptions | null | undefined,
      callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
    ) => {
      if (typeof callback === 'function') {
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

    mockedExec.mockImplementationOnce((
      command: string,
      options: ExecOptions | null | undefined,
      callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
    ) => {
      if (typeof callback === 'function') {
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
    expect(typeof callbackArg).toBe('function');
    expect(result).toContain("Exit code 1 (or timeout):\npartial output\nerror message");
  });

  it("should handle command timeout", async () => {
    const timeoutError = new Error("Command timed out") as ExecException;
    timeoutError.killed = true;
    timeoutError.signal = "SIGTERM";

    mockedExec.mockImplementationOnce((
      command: string,
      options: ExecOptions | null | undefined,
      callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
    ) => {
      if (typeof callback === 'function') {
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
    // Set a dummy NODE_OPTIONS in the current process to ensure it\'s cleared
    process.env.NODE_OPTIONS = "--require tsx";

    mockedExec.mockImplementationOnce((
      command: string,
      options: ExecOptions | null | undefined,
      callback: ((error: ExecException | null, stdout: string, stderr: string) => void) | undefined
    ) => {
      if (typeof callback === 'function') {
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
    expect(typeof callbackArg).toBe('function');

    // Clean up the dummy NODE_OPTIONS
    delete process.env.NODE_OPTIONS;
  });
});
