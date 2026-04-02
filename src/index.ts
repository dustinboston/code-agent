#!/usr/bin/env node
/**
 * @module index
 *
 * CLI entry point for the RAG Starter application.
 *
 * Registers all sub-commands (`ingest`, `chat`, `team`, `config`, `store`)
 * with Commander and delegates argument parsing to the framework.
 */
import { Command } from "commander";
import { ingestCommand } from "./commands/ingest.js";
import { chatCommand } from "./commands/chat.js";
import { configCommand } from "./commands/config.js";
import { storeCommand } from "./commands/store.js";
import { teamCommand } from "./commands/team.js";

/**
 * Root Commander program instance.
 *
 * All sub-commands are attached to this object before `program.parse()` is
 * called, which hands control to Commander for argument dispatching.
 */
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
