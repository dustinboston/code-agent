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
    write(`  ${msg.content}\n\n`);
  } else if (msg.role === "tester") {
    write(chalk.bold.magenta("Tester") + chalk.dim(` [${new Date(msg.timestamp).toLocaleTimeString()}]`) + "\n");
    write(`  ${msg.content}\n\n`);
  } else {
    write(chalk.bold.green("Planner") + chalk.dim(` [${new Date(msg.timestamp).toLocaleTimeString()}]`) + "\n");
    write(`  ${msg.content}\n`);
    write("\n");
  }
}
