import { randomUUID } from "crypto";
import chalk from "chalk";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { ChatOpenAI } from "@langchain/openai";
import type { ChatGoogle } from "@langchain/google";
import type { Runnable } from "@langchain/core/runnables";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { readFileTool, listDirectoryTool, writeFileTool, deletePathTool } from "../tools/filesystem.js";
import { runCommandTool } from "../tools/shell.js";
import { createDeveloperPrompt, createTesterPrompt } from "./prompt.js";
import type { DynamicStructuredTool } from "@langchain/core/tools";

type AgentModel = ChatAnthropic | ChatOpenAI | ChatGoogle;

// ─── Agent loop runner ─────────────────────────────────────────────────────────

interface RunAgentLoopCallbacks {
  onChunk?: (chunk: AIMessageChunk, iterationText: string) => void;
  onTurnComplete?: (
    accChunk: AIMessageChunk,
    iterationText: string,
    invokeMessages: BaseMessage[],
  ) => Promise<BaseMessage[]>;
  onToolCall?: (toolCall: any) => void;
  onActivity?: (line: string) => void;
  onStatus?: (msg: string) => void;
  requestApproval?: (command: string) => Promise<boolean>;
  onAgentMessage?: (agentName: string, message: string) => Promise<void>;
  agentName: string;
  agentTools: DynamicStructuredTool[];
}

export async function runAgentLoop(
  agent: Runnable<any, any>,
  invokeMessages: BaseMessage[],
  callbacks: RunAgentLoopCallbacks,
  signal?: AbortSignal,
): Promise<BaseMessage[]> {
  const {
    onChunk,
    onTurnComplete,
    onToolCall,
    onActivity,
    onStatus,
    requestApproval,
    onAgentMessage,
    agentName,
    agentTools,
  } = callbacks;

  let currentInvokeMessages = [...invokeMessages];
  let fullText = "";

  while (true) {
    if (signal?.aborted) {
      throw signal.reason;
    }

    let accChunk: AIMessageChunk | null = null;
    let iterationText = "";
    let announcedTools = new Set<string>();

    try {
      const stream = await agent.stream(currentInvokeMessages, { signal });
      for await (const chunk of stream) {
        if (signal?.aborted) {
          throw signal.reason instanceof Error ? signal.reason : new Error("INTERRUPTED: aborted");
        }
        const c = chunk as AIMessageChunk;
        accChunk = accChunk ? (accChunk.concat(c) as AIMessageChunk) : c;

        if (c.tool_call_chunks && onActivity) {
          for (const tcc of c.tool_call_chunks) {
            if (tcc.name && !announcedTools.has(tcc.index?.toString() ?? tcc.id ?? "")) {
              const key = tcc.index?.toString() ?? tcc.id ?? "";
              if (key) announcedTools.add(key);
              onActivity(`${agentName} preparing ${tcc.name}...`);
            }
          }
        }

        const text =
          typeof c.content === "string"
            ? c.content
            : Array.isArray(c.content)
              ? c.content.map((p) => (typeof p === "string" ? p : "text" in p ? p.text : "")).join("")
              : "";
        iterationText += text;
        fullText += text;

        onChunk?.(c, iterationText);
      }
    } catch (e: any) {
      if (e.name === "AbortError" || (e instanceof Error && e.message.startsWith("INTERRUPTED:"))) {
        if (accChunk) {
          currentInvokeMessages.push(
            new AIMessage({
              content: accChunk.content,
              tool_calls: accChunk.tool_calls,
              additional_kwargs: accChunk.additional_kwargs,
              id: accChunk.id,
            }),
          );
          if (onTurnComplete) {
            currentInvokeMessages = await onTurnComplete(accChunk, iterationText, currentInvokeMessages);
          }
        }
        const interruptErr =
          signal?.reason instanceof Error && signal.reason.message.startsWith("INTERRUPTED:")
            ? signal.reason
            : new Error("INTERRUPTED: aborted");
        throw interruptErr;
      }
      throw e;
    }

    if (!accChunk) break;

    if (onAgentMessage && iterationText.trim()) {
      await onAgentMessage(agentName, iterationText.trim());
    }

    currentInvokeMessages.push(
      new AIMessage({
        content: accChunk.content,
        tool_calls: accChunk.tool_calls,
        additional_kwargs: accChunk.additional_kwargs,
        id: accChunk.id,
      }),
    );

    if (onTurnComplete) {
      currentInvokeMessages = await onTurnComplete(accChunk, iterationText, currentInvokeMessages);
    }

    const toolCalls = accChunk.tool_calls ?? [];
    if (toolCalls.length === 0) break;

    onStatus?.(`${agentName} using tools (${toolCalls.map((tc) => tc.name).join(", ")})...`);

    for (const tc of toolCalls) {
      onToolCall?.(tc);
    }

    const toolMessages = await Promise.all(
      toolCalls.map(async (toolCall) => {
        if (onActivity) {
          const argsSummary = Object.entries(toolCall.args ?? {})
            .filter(([k]) => !(toolCall.name === "write_file" && k === "content"))
            .map(([k, v]) => {
              const s = typeof v === "string" ? v : JSON.stringify(v);
              return `${k}: ${s.length > 60 ? s.slice(0, 57) + "..." : s}`;
            })
            .join(", ");
          onActivity(`${agentName}: ${toolCall.name}(${argsSummary})`);
        }
        const toolFn = agentTools.find((t) => t.name === toolCall.name);
        let toolMsg: ToolMessage;

        if (toolCall.name === "run_command" && requestApproval) {
          const approved = await requestApproval((toolCall.args as any).command || "");
          if (!approved) {
            const deniedMsg = "Error: User denied execution of this command.";
            if (onActivity) onActivity(chalk.red(`    ⚠ ${deniedMsg}`));
            return new ToolMessage({
              content: deniedMsg,
              tool_call_id: toolCall.id ?? randomUUID(),
              name: toolCall.name,
            });
          }
        }

        if (!toolFn) {
          toolMsg = new ToolMessage({
            content: `Unknown tool: ${toolCall.name}`,
            tool_call_id: toolCall.id ?? randomUUID(),
            name: toolCall.name,
          });
        } else {
          try {
            toolMsg = (await toolFn.invoke(toolCall)) as ToolMessage;
          } catch (e: any) {
            if (e instanceof Error && e.message.startsWith("INTERRUPTED:")) {
              throw e;
            }
            const errorMsg = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
            if (onActivity) onActivity(chalk.red(`    ⚠ ${errorMsg.slice(0, 500)}`));
            toolMsg = new ToolMessage({
              content: errorMsg,
              tool_call_id: toolCall.id ?? randomUUID(),
              name: toolCall.name,
            });
          }
        }

        if (
          typeof toolMsg.content === "string" &&
          (toolMsg.content.startsWith("Error ") || toolMsg.content.startsWith("Tool error:"))
        ) {
          if (onActivity) onActivity(chalk.red(`    ⚠ ${toolMsg.content.slice(0, 150)}`));
        }

        return toolMsg;
      }),
    );
    currentInvokeMessages.push(...toolMessages);
  }
  return currentInvokeMessages;
}

// ─── Sub-agent runner ──────────────────────────────────────────────────────────

/**
 * Runs a single sub-agent (developer or tester) in an agentic tool-use loop.
 *
 * Each iteration streams one LLM response. If the response contains tool
 * calls, every tool is invoked and its result is appended to the message
 * history before the next iteration begins. The loop exits when the model
 * produces a response with no tool calls — i.e. it has finished its task and
 * is reporting back in plain text.
 *
 * @param agent - The LLM instance that powers this sub-agent.
 * @param agentTools - Array of LangChain tools the agent is allowed to call.
 * @param promptFn - Factory that returns the agent's system prompt template.
 * @param message - The task description from the planner.
 * @param onStatus - Callback invoked to update the TUI status bar.
 * @param agentName - Display name used in status and activity messages.
 * @param onActivity - Optional callback for detailed activity log lines.
 * @param requestApproval - Optional callback to request user approval for commands.
 * @param onAgentMessage - Optional callback for when the agent produces a message.
 * @param signal - Optional AbortSignal to cancel the operation.
 * @returns The full concatenated text the agent produced across all iterations.
 */
export async function runSubAgent(
  agent: AgentModel,
  agentTools: DynamicStructuredTool[],
  promptFn: () => ReturnType<typeof createDeveloperPrompt>,
  message: string,
  onStatus: (msg: string) => void,
  agentName: string,
  onActivity?: (line: string) => void,
  requestApproval?: (command: string) => Promise<boolean>,
  onAgentMessage?: (agentName: string, message: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<string> {
  const agentWithTools = agent.bindTools(agentTools);
  const prompt = await promptFn();
  const promptMessages = await prompt.formatMessages({ input: message });
  let fullText = "";
  let lastStatus = "";

  const wrappedOnStatus = (msg: string) => {
    lastStatus = msg;
    onStatus(msg);
  };

  try {
    const updatedInvokeMessages = await runAgentLoop(
      agentWithTools,
      promptMessages,
      {
        onChunk: (c, iterText) => {
          const text =
            typeof c.content === "string"
              ? c.content
              : Array.isArray(c.content)
                ? c.content.map((p) => (typeof p === "string" ? p : "text" in p ? p.text : "")).join("")
                : "";
          fullText += text;
        },
        onTurnComplete: async (accChunk, iterationText, currentInvokeMessages) => {
          return currentInvokeMessages;
        },
        onActivity,
        onStatus: wrappedOnStatus,
        requestApproval,
        onAgentMessage,
        agentName,
        agentTools,
      },
      signal,
    );
  } catch (err: any) {
    if (err instanceof Error && err.message.startsWith("INTERRUPTED:")) {
      const statusStr = lastStatus ? ` Last status: ${lastStatus}` : "";
      const partial = fullText.trim() ? ` Output: ${fullText.trim()}` : "";
      err.message += `\n[System Note: Interrupted while ${agentName} was working.${statusStr}${partial}]`;
    }
    throw err;
  }

  return fullText;
}

// ─── send_message tool factory ────────────────────────────────────────────────

/**
 * Creates the `send_message` LangChain tool that the planner uses to delegate
 * work to sub-agents.
 *
 * When the planner calls `send_message({ id: "developer", message: "..." })`,
 * this tool spins up the corresponding sub-agent's agentic loop via
 * {@link runSubAgent} and returns the result as a JSON string. The planner
 * then decides whether to call the tester, ask a follow-up, or report back
 * to the user.
 *
 * Both sub-agents share the same tool set: `read_file`, `list_directory`,
 * `write_file`, `delete_path`, and `run_command`.
 *
 * @param developer - LLM instance for the developer sub-agent.
 * @param tester - LLM instance for the tester sub-agent.
 * @param onStatus - Callback invoked to update the TUI status bar.
 * @param onActivity - Optional callback for detailed activity log lines.
 * @param requestApproval - Optional callback to request user approval for commands.
 * @param onAgentMessage - Optional callback for when the agent produces a message.
 * @param signal - Optional AbortSignal to cancel the operation.
 * @returns A LangChain `DynamicStructuredTool` that the planner can call.
 */
export function createSendMessageTool(
  developer: AgentModel,
  tester: AgentModel,
  onStatus: (msg: string) => void,
  onActivity?: (line: string) => void,
  requestApproval?: (command: string) => Promise<boolean>,
  onAgentMessage?: (agentName: string, message: string) => Promise<void>,
  signal?: AbortSignal,
) {
  const developerTools = [readFileTool, listDirectoryTool, writeFileTool, deletePathTool, runCommandTool];
  const testerTools = [readFileTool, listDirectoryTool, writeFileTool, deletePathTool, runCommandTool];

  return tool(
    async ({ id, message }: { id: string; message: string }) => {
      if (id === "developer") {
        onStatus("Developer is working...");
        const result = await runSubAgent(
          developer,
          developerTools,
          createDeveloperPrompt,
          message,
          onStatus,
          "Developer",
          onActivity,
          requestApproval,
          onAgentMessage,
          signal,
        );
        return JSON.stringify({ id: "coordinator", status: "success", message: result });
      }

      if (id === "tester") {
        onStatus("Tester is working...");
        const result = await runSubAgent(
          tester,
          testerTools,
          createTesterPrompt,
          message,
          onStatus,
          "Tester",
          onActivity,
          requestApproval,
          onAgentMessage,
          signal,
        );
        return JSON.stringify({ id: "coordinator", status: "success", message: result });
      }

      return JSON.stringify({
        id: "coordinator",
        status: "failure",
        message: `Unknown agent: ${id}. Valid agents: developer, tester.`,
      });
    },
    {
      name: "send_message",
      description:
        "Delegate a task to a sub-agent. Use 'developer' to implement code changes, 'tester' to write and run tests.",
      schema: z.object({
        id: z.enum(["developer", "tester"]).describe("The sub-agent to message"),
        message: z.string().describe("A self-contained task description with all context the agent needs"),
      }),
    },
  );
}
