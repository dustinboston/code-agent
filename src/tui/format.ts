import chalk from "chalk";
import type { ChatMessage } from "../types.js";

/**
 * Writes a chat message to the standard output, formatted based on the message role.
 * @param write - The function to write text to stdout.
 * @param msg - The chat message object to write.
 * @returns void
 */
export function printChatMessage(write: (text: string) => void, msg: ChatMessage) {
  if (msg.role === "system") {
    write(chalk.gray(`  ${msg.content}\n`));
  } else if (msg.role === "user") {
    write(chalk.bold.cyan("You") + chalk.dim(` [${new Date(msg.timestamp).toLocaleTimeString()}]`) + "\n");
    write(`  ${msg.content}\n\n`);
  } else if (msg.role === "developer") {
    write(chalk.bold.blue("Developer") + chalk.dim(` [${new Date(msg.timestamp).toLocaleTimeString()}]`) + "\n");
    write(`  ${msg.content.replace(/\n/g, "\n  ")}\n\n`);
  } else if (msg.role === "tester") {
    write(chalk.bold.magenta("Tester") + chalk.dim(` [${new Date(msg.timestamp).toLocaleTimeString()}]`) + "\n");
    write(`  ${msg.content.replace(/\n/g, "\n  ")}\n\n`);
  } else {
    write(chalk.bold.green("Assistant") + chalk.dim(` [${new Date(msg.timestamp).toLocaleTimeString()}]`) + "\n");
    write(`  ${msg.content.replace(/\n/g, "\n  ")}\n`);
    if (msg.sources && msg.sources.length > 0) {
      write(chalk.dim(`  Sources: ${msg.sources.map((s) => `${s.source} (${(s.score * 100).toFixed(0)}%)`).join(" · ")}\n`));
    }
    write("\n");
  }
}
