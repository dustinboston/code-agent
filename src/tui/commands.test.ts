import { describe, it, expect, mock } from "bun:test";
import { processSlashCommand } from "./commands.js";
import type { AppConfig } from "../types.js";

describe("processSlashCommand", () => {
  const mockConfig: AppConfig = {
    planner: { provider: "openai", model: "test", temperature: 0, maxTokens: 1000 },
    developer: { provider: "google", model: "test", temperature: 0, maxTokens: 1000 },
    tester: { provider: "anthropic", model: "test", temperature: 0, maxTokens: 1000 },
    allowedCommands: [],
  };

  it("should handle /help command", async () => {
    const callbacks = {
      addSystemMsg: mock(async (msg: string) => {}),
      setCompletedMessages: mock(() => {}),
      exit: mock(() => {}),
    };
    await processSlashCommand("/help", mockConfig, callbacks);
    expect(callbacks.addSystemMsg).toHaveBeenCalled();
    const callArg = callbacks.addSystemMsg.mock.calls[0][0];
    expect(callArg).toContain("/help");
    expect(callArg).toContain("/stop");
  });

  it("should handle /clear command", async () => {
    const callbacks = {
      addSystemMsg: mock(async (msg: string) => {}),
      setCompletedMessages: mock((msgs: any[]) => {}),
      exit: mock(() => {}),
    };
    await processSlashCommand("/clear", mockConfig, callbacks);
    expect(callbacks.setCompletedMessages).toHaveBeenCalledWith([]);
    expect(callbacks.addSystemMsg).toHaveBeenCalledWith("Conversation cleared.");
  });

  it("should handle /config command", async () => {
    const callbacks = {
      addSystemMsg: mock(async (msg: string) => {}),
      setCompletedMessages: mock(() => {}),
      exit: mock(() => {}),
    };
    await processSlashCommand("/config", mockConfig, callbacks);
    expect(callbacks.addSystemMsg).toHaveBeenCalledWith(JSON.stringify(mockConfig, null, 2));
  });

  it("should handle /stop command", async () => {
    const callbacks = {
      addSystemMsg: mock(async (msg: string) => {}),
      setCompletedMessages: mock(() => {}),
      exit: mock(() => {}),
    };
    await processSlashCommand("/stop", mockConfig, callbacks);
    expect(callbacks.addSystemMsg).toHaveBeenCalledWith("The /stop command can only be used while the AI is generating a response.");
  });

  it("should handle /quit command", async () => {
    const callbacks = {
      addSystemMsg: mock(async (msg: string) => {}),
      setCompletedMessages: mock(() => {}),
      exit: mock(() => {}),
    };
    await processSlashCommand("/quit", mockConfig, callbacks);
    expect(callbacks.exit).toHaveBeenCalled();
  });

  it("should handle /exit command", async () => {
    const callbacks = {
      addSystemMsg: mock(async (msg: string) => {}),
      setCompletedMessages: mock(() => {}),
      exit: mock(() => {}),
    };
    await processSlashCommand("/exit", mockConfig, callbacks);
    expect(callbacks.exit).toHaveBeenCalled();
  });

  it("should handle unknown commands", async () => {
    const callbacks = {
      addSystemMsg: mock(async (msg: string) => {}),
      setCompletedMessages: mock(() => {}),
      exit: mock(() => {}),
    };
    await processSlashCommand("/unknown", mockConfig, callbacks);
    expect(callbacks.addSystemMsg).toHaveBeenCalled();
    const callArg = callbacks.addSystemMsg.mock.calls[0][0];
    expect(callArg).toContain("Unknown command: /unknown");
  });
});
