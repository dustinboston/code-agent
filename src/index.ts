#!/usr/bin/env node
import { Command } from "commander";
import { ingestCommand } from "./commands/ingest.js";
import { chatCommand } from "./commands/chat.js";
import { configCommand } from "./commands/config.js";
import { storeCommand } from "./commands/store.js";
import { teamCommand } from "./commands/team.js";

const program = new Command();

program
  .name("rag-starter")
  .description("Interactive RAG chat powered by LangChain, Pinecone, and Claude")
  .version("0.1.0");

program.addCommand(ingestCommand);
program.addCommand(chatCommand);
program.addCommand(teamCommand);
program.addCommand(configCommand);
program.addCommand(storeCommand);

program.parse();
