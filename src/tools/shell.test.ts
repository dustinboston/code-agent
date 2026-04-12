import process from 'node:process';
import {type ExecException, type ExecOptions} from 'node:child_process';
import {describe, it, expect, mock, beforeEach} from 'bun:test';
import {runCommandTool} from './shell.js';

type ExecCallback = (error: ExecException | undefined, stdout: string, stderr: string) => void;

function createExecImpl(handler: (callback: ExecCallback) => void) {
  return (_command: string, _options: ExecOptions | undefined, callback: ExecCallback | undefined) => {
    if (typeof callback === 'function') {
      handler(callback);
    }

    return {};
  };
}

const defaultExecImpl = createExecImpl((callback) => {
  process.nextTick(() => {
    callback(undefined, '', '');
  });
});

const execMock = mock(defaultExecImpl);

void mock.module('child_process', () => ({exec: execMock}));

describe('runCommandTool', () => {
  beforeEach(() => {
    execMock.mockClear();
    execMock.mockImplementation(defaultExecImpl);
  });
  it('should execute a command and return stdout', async () => {
    execMock.mockImplementationOnce(
      createExecImpl((callback) => {
        process.nextTick(() => {
          callback(undefined, 'hello from stdout', '');
        });
      }),
    );

    const result = await runCommandTool.invoke({command: 'echo hello'});

    expect(execMock).toHaveBeenCalledTimes(1);
    const [commandArg, optionsArg, callbackArg] = execMock.mock.calls[0];
    expect(commandArg).toBe('echo hello');
    expect(optionsArg?.cwd).toBe(process.cwd());
    expect(optionsArg?.timeout).toBe(30_000);
    expect(optionsArg?.env?.NODE_OPTIONS).toBeUndefined();
    expect(typeof callbackArg).toBe('function');
    expect(result).toBe('hello from stdout');
  });

  it('should execute a command and return stderr', async () => {
    execMock.mockImplementationOnce(
      createExecImpl((callback) => {
        process.nextTick(() => {
          callback(undefined, '', 'hello from stderr');
        });
      }),
    );

    const result = await runCommandTool.invoke({command: '>&2 echo hello'});

    expect(execMock).toHaveBeenCalledTimes(1);
    const [commandArg, optionsArg, callbackArg] = execMock.mock.calls[0];
    expect(commandArg).toBe('>&2 echo hello');
    expect(optionsArg?.cwd).toBe(process.cwd());
    expect(optionsArg?.timeout).toBe(30_000);
    expect(optionsArg?.env?.NODE_OPTIONS).toBeUndefined();
    expect(typeof callbackArg).toBe('function');
    expect(result).toBe('hello from stderr');
  });

  it('should return combined stdout and stderr', async () => {
    execMock.mockImplementationOnce(
      createExecImpl((callback) => {
        process.nextTick(() => {
          callback(undefined, 'out', 'err');
        });
      }),
    );

    const result = await runCommandTool.invoke({command: 'command'});
    expect(result).toBe('out\nerr');
  });

  it("should return '(no output)' if command produces no output", async () => {
    execMock.mockImplementationOnce(
      createExecImpl((callback) => {
        process.nextTick(() => {
          callback(undefined, '', '');
        });
      }),
    );

    const result = await runCommandTool.invoke({command: 'true'});
    expect(result).toBe('(no output)');
  });

  it('should return an error string if the command fails', async () => {
    const error = Object.assign(new Error('Command failed'), {
      code: 1,
      stdout: 'partial output',
      stderr: 'error message',
    });

    execMock.mockImplementationOnce(
      createExecImpl((callback) => {
        process.nextTick(() => {
          callback(error, 'partial output', 'error message');
        });
      }),
    );

    const result = await runCommandTool.invoke({command: 'false'});

    expect(execMock).toHaveBeenCalledTimes(1);
    const [commandArg, optionsArg, callbackArg] = execMock.mock.calls[0];
    expect(commandArg).toBe('false');
    expect(optionsArg?.cwd).toBe(process.cwd());
    expect(optionsArg?.timeout).toBe(30_000);
    expect(optionsArg?.env?.NODE_OPTIONS).toBeUndefined();
    expect(typeof callbackArg).toBe('function');
    expect(result).toContain('Exit code 1 (or timeout):\npartial output\nerror message');
  });

  it('should handle command timeout', async () => {
    const timeoutError = Object.assign(new Error('Command timed out'), {
      killed: true,
      signal: 'SIGTERM',
    });

    execMock.mockImplementationOnce(
      (_command: string, _options: ExecOptions | undefined, callback: ExecCallback | undefined) => {
        if (typeof callback === 'function') {
          setTimeout(() => {
            callback(timeoutError, '', '');
          }, 10);
        }

        return {};
      },
    );

    const result = await runCommandTool.invoke({command: 'sleep 5'});
    expect(result).toContain('Exit code unknown (or timeout):\nError: Command timed out');
  });

  it('should ensure NODE_OPTIONS is undefined in the child process environment', async () => {
    process.env.NODE_OPTIONS = '--require tsx';

    execMock.mockImplementationOnce(
      createExecImpl((callback) => {
        process.nextTick(() => {
          callback(undefined, '', '');
        });
      }),
    );

    await runCommandTool.invoke({command: 'env'});

    expect(execMock).toHaveBeenCalledTimes(1);
    const [commandArg, optionsArg, callbackArg] = execMock.mock.calls[0];
    expect(commandArg).toBe('env');
    expect(optionsArg?.cwd).toBe(process.cwd());
    expect(optionsArg?.timeout).toBe(30_000);
    expect(optionsArg?.env?.NODE_OPTIONS).toBeUndefined();
    expect(typeof callbackArg).toBe('function');

    delete process.env.NODE_OPTIONS;
  });
});
