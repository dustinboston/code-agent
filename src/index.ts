#!/usr/bin/env node
/**
 * @module index
 *
 * CLI entry point for the Code Agent application.
 *
 * Registers all sub-commands (`ingest`, `team`, `config`, `store`)
 * with Commander and delegates argument parsing to the framework.
 * The default action (no sub-command) launches team mode.
 */
import {Command} from 'commander';
import packageJson from '../package.json' with {type: 'json'};
import {loadConfig, validateConfig} from './config.js';
import {startApp} from './tui/app.js';

const {version} = packageJson;

console.log(`Code Agent ${version}`);

/**
 * Root Commander program instance.
 *
 * All sub-commands are attached to this object before `program.parse()` is
 * called, which hands control to Commander for argument dispatching.
 */
const program = new Command();

program
  .name('code-agent')
  .description('AI code editing team')
  .version(version)
  .action(async () => {
    const config = loadConfig();
    validateConfig(config);
    await startApp(config);
  });

program.parse();
