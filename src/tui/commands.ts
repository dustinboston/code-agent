import type { AppConfig, ChatMessage } from "../types.js";

export interface SlashCommandCallbacks {
  addSystemMsg: (content: string) => Promise<void>;
  setCompletedMessages: (messages: ChatMessage[]) => void;
  exit: () => void;
}

export async function processSlashCommand(cmd: string, config: AppConfig, callbacks: SlashCommandCallbacks) {
  const { addSystemMsg, setCompletedMessages, exit } = callbacks;

  const parts = cmd.slice(1).trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() ?? "";

  switch (command) {
    case "help":
      await addSystemMsg(
        [
          "/help              — show this message",
          "/clear             — clear conversation history",
          "/config            — show current configuration",
          "/stop              — interrupt the current AI response",
          "/quit              — exit the application",
        ].join("\n"),
      );
      break;

    case "clear":
      setCompletedMessages([]);
      await addSystemMsg("Conversation cleared.");
      break;

    case "config":
      await addSystemMsg(JSON.stringify(config, null, 2));
      break;

    case "stop":
      await addSystemMsg("The /stop command can only be used while the AI is generating a response.");
      break;

    case "quit":
    case "exit":
      exit();
      break;

    default:
      await addSystemMsg(`Unknown command: /${command}\nType /help to see available commands.`);
  }
}
