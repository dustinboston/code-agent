import { randomUUID } from "crypto";
import type { AppConfig, ChatMessage, RetrievalResult } from "../types.js";
import { ingestFile } from "../ingest/pipeline.js";

// Duplicated from app.ts to avoid circular dependencies before a larger refactor.
interface CliAppState {
  state: "initializing" | "idle" | "generating" | "error" | "retrieving";
  statusMsg: string;
  errorMsg: string;
  completedMessages: ChatMessage[];
  lastSources: RetrievalResult[];
}

export interface SlashCommandCallbacks {
  addSystemMsg: (content: string) => Promise<void>;
  setCompletedMessages: (messages: ChatMessage[]) => void;
  setLastSources: (sources: RetrievalResult[]) => void;
  setAppState: (state: CliAppState["state"]) => void;
  setStatusMsg: (msg: string) => void;
  exit: () => void;
  lastSources: RetrievalResult[];
}

export async function processSlashCommand(
  cmd: string,
  config: AppConfig,
  callbacks: SlashCommandCallbacks,
) {
  const { addSystemMsg, setCompletedMessages, setLastSources, setAppState, setStatusMsg, exit } = callbacks;

  const parts = cmd.slice(1).trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() ?? "";

  switch (command) {
    case "help":
      await addSystemMsg(
        [
          "/help              — show this message",
          "/clear             — clear conversation history",
          "/sources           — show sources from the last response",
          "/ingest <path>     — ingest a file into the knowledge base",
          "/config            — show current configuration",
          "/quit              — exit the application",
        ].join("\n"),
      );
      break;

    case "clear":
      setCompletedMessages([]);
      setLastSources([]);
      await addSystemMsg("Conversation cleared.");
      break;

    case "sources":
      if (callbacks.lastSources.length === 0) {
        await addSystemMsg("No sources from the last response.");
      }
      else {
        const lines = callbacks.lastSources.map(
          (s, i) => `${i + 1}. ${s.source}\n   relevance: ${(s.score * 100).toFixed(0)}%`,
        );
        await addSystemMsg(`Sources from last response:\n\n${lines.join("\n\n")}`);
      }
      break;

    case "config":
      await addSystemMsg(JSON.stringify(config, null, 2));
      break;

    case "quit":
    case "exit":
      exit();
      break;

    case "ingest": {
      const filePath = parts.slice(1).join(" ");
      if (!filePath) {
        await addSystemMsg("Usage: /ingest <path-to-file>");
        break;
      }
      setAppState("retrieving");
      setStatusMsg(`Ingesting ${filePath}...`);
      try {
        const result = await ingestFile(filePath, config, (msg) => setStatusMsg(msg));
        await addSystemMsg(`Ingested: ${result.source}\n${result.chunkCount} chunks stored in Pinecone.`);
      } catch (err) {
        await addSystemMsg(`Ingest failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      setAppState("idle");
      setStatusMsg("");
      break;
    }

    default:
      await addSystemMsg(`Unknown command: /${command}\nType /help to see available commands.`);
  }
}
