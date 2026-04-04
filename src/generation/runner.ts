import { randomUUID } from "crypto";
import chalk from "chalk";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { ChatAnthropic } from "@langchain/anthropic";
import type { ChatOpenAI } from "@langchain/openai";
import type { ChatGoogle } from "@langchain/google";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { filesystemTools, readFileTool, listDirectoryTool, writeFileTool, deletePathTool } from "../tools/filesystem.js";
import { runCommandTool } from "../tools/shell.js";
import { createDeveloperPrompt, createTesterPrompt } from "../generation/prompt.js";

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
 * @returns The full concatenated text the agent produced across all iterations.
 */
export async function runSubAgent(
  agent: ChatAnthropic | ChatOpenAI | ChatGoogle,
  agentTools: typeof filesystemTools,
  promptFn: () => ReturnType<typeof createDeveloperPrompt>,
  message: string,
  onStatus: (msg: string) => void,
  agentName: string,
  onActivity?: (line: string) => void,
  requestApproval?: (command: string) => Promise<boolean>,
  onAgentMessage?: (agentName: string, message: string) => Promise<void>,
): Promise<string> {
  const agentWithTools = agent.bindTools(agentTools);
  const prompt = await promptFn();
  const promptMessages = await prompt.formatMessages({ input: message });
  const invokeMessages: BaseMessage[] = [...promptMessages];
  let fullText = "";

  while (true) {
    // Stream one LLM turn, accumulating chunks into a single AIMessageChunk
    // so we can inspect tool_calls after the stream ends.
    let accChunk: AIMessageChunk | null = null;
    let iterText = "";
    let announcedTools = new Set<string>();
    const stream = await agentWithTools.stream(invokeMessages);
    for await (const chunk of stream) {
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
      iterText += text;
      fullText += text;
    }

    if (!accChunk) break;

    // Surface full agent text as a top-level message
    if (onAgentMessage && iterText.trim()) {
      await onAgentMessage(agentName, iterText.trim());
    }

    // Append the assistant turn. AIMessageChunk must be converted to AIMessage
    // so Anthropic serializes tool_calls in the expected format.
    invokeMessages.push(
      new AIMessage({
        content: accChunk.content,
        tool_calls: accChunk.tool_calls,
        additional_kwargs: accChunk.additional_kwargs,
        id: accChunk.id,
      }),
    );

    const toolCalls = accChunk.tool_calls ?? [];
    if (toolCalls.length === 0) break; // no tool calls → agent is done

    onStatus(`${agentName} using tools (${toolCalls.map((tc) => tc.name).join(", ")})...`);
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
          } catch (e) {
            // Return the error as a ToolMessage so the agent can self-correct
            // rather than crashing the whole team loop.
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
      })
    );
    invokeMessages.push(...toolMessages);
  }

  return fullText;
}

// ─── send_message tool factory ────────────────────────────────────────────────

/**
 * Creates the `send_message` LangChain tool that the planner uses to delegate
 * work to sub-agents.
 *
 * When the planner calls `send_message({ id: "developer", message: "…" })`,
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
 * @returns A LangChain `DynamicStructuredTool` that the planner can call.
 */
export function createSendMessageTool(
  developer: ChatAnthropic | ChatOpenAI | ChatGoogle,
  tester: ChatAnthropic | ChatOpenAI | ChatGoogle,
  onStatus: (msg: string) => void,
  onActivity?: (line: string) => void,
  requestApproval?: (command: string) => Promise<boolean>,
  onAgentMessage?: (agentName: string, message: string) => Promise<void>,
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
