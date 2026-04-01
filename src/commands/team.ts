import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { loadConfig, validateConfig } from "../config.js";
import { App } from "../tui/app.js";

export const teamCommand = new Command("team")
  .description("Start a team")
  .action((_options) => {
    const config = loadConfig();
    validateConfig(config);

    render(React.createElement(App, { config, mode: "team" }));
  });
