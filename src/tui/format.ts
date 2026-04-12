import chalk from 'chalk';
import type {ChatMessage} from '../types.js';

/**
 * Writes a chat message to the standard output, formatted based on the message role.
 * @param write - The function to write text to stdout.
 * @param msg - The chat message object to write.
 * @returns void
 */
export function printChatMessage(write: (text: string) => void, message: ChatMessage) {
  switch (message.role) {
    case 'system': {
      write(chalk.gray(`  ${message.content}\n`));

      break;
    }

    case 'user': {
      write(chalk.bold.cyan('You') + chalk.dim(` [${new Date(message.timestamp).toLocaleTimeString()}]`) + '\n');
      write(`  ${message.content}\n\n`);

      break;
    }

    case 'developer': {
      write(chalk.bold.blue('Developer') + chalk.dim(` [${new Date(message.timestamp).toLocaleTimeString()}]`) + '\n');
      write(`  ${message.content}\n\n`);

      break;
    }

    case 'tester': {
      write(chalk.bold.magenta('Tester') + chalk.dim(` [${new Date(message.timestamp).toLocaleTimeString()}]`) + '\n');
      write(`  ${message.content}\n\n`);

      break;
    }

    case 'assistant': {
      write(chalk.bold.green('Planner') + chalk.dim(` [${new Date(message.timestamp).toLocaleTimeString()}]`) + '\n');
      write(`  ${message.content}\n\n`);

      break;
    }
  }
}
