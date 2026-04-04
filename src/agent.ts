/**
 * Note: we don't cache this file so that the user can update it while the
 * application is running and see the changes immediately.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Find the first agent file that exists in the root directory of the project.
 * @returns the content of an agent file or an empty string
 */
export async function loadAgentsFile() {
  // Not using Promise.all, Promise.race, or Promise.any because we want to
  // return the first file that exists in the order below (deterministically).

  const agentsFile = await readAgentsFile("AGENTS.md");
  if (agentsFile) return agentsFile;

  const agentFile = await readAgentsFile("AGENT.md");
  if (agentFile) return agentFile;

  const claudeFile = await readAgentsFile("CLAUDE.md");
  if (claudeFile) return claudeFile;

  const geminiFile = await readAgentsFile("GEMINI.md");
  if (geminiFile) return geminiFile;

  const readmeFile = await readAgentsFile("README.md");
  if (readmeFile) return readmeFile;

  return "";
}

/**
 * Load an agent file from the root directory of the project.
 * @param agentFileName The name of the agent file to load.
 * @returns The content of the agent file or an empty string
 */
export async function readAgentsFile(agentFileName: string) {
  const agentFile = resolve(agentFileName);
  if (!existsSync(agentFile)) return "";
  try {
    const fileContent = await readFile(agentFile, "utf-8");
    return fileContent;
  } catch {
    return "";
  }
}
