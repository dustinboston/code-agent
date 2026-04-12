/**
 * Note: we don't cache this file so that the user can update it while the
 * application is running and see the changes immediately.
 */
import process from 'node:process';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * Find the first agent file that exists in the root directory of the project.
 * @returns the content of an agent file or an empty string
 */
export async function loadAgentsFile(agents = ['AGENTS.md', 'AGENT.md', 'CLAUDE.md', 'GEMINI.md', 'README.md']) {
  // Read all files in parallel, then return the first non-empty result
  // in priority order (AGENTS.md > AGENT.md > CLAUDE.md > ...).
  const results = await Promise.all(agents.map(async (agent) => readAgentsFile(agent)));
  return results.find((content) => content !== '') ?? '';
}

/**
 * Load an agent file from the root directory of the project.
 * @param agentFileName The name of the agent file to load.
 * @returns The content of the agent file or an empty string
 */
export async function readAgentsFile(agentFileName: string) {
  const agentFile = join(process.cwd(), agentFileName);
  if (!existsSync(agentFile)) return '';
  try {
    const fileContent = await readFile(agentFile, 'utf8');
    return fileContent;
  } catch {
    return '';
  }
}
