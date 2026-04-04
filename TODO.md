# TODO

## [x] 1. Fix API Key Validation (`src/config.ts`)

Currently, `validateConfig` forces the user to provide `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY` all at once. If a user only wants to use Claude, the app will still crash asking for OpenAI and Google keys. The validation should be updated to only check for the API keys of the providers that are actually configured for the planner, developer, and tester agents.

## 2. Refactor the Monolithic `generateResponse` (`src/tui/app.ts`)

The `generateResponse` function is nearly 200 lines long and handles everything from building LangChain messages and executing the Planner's streaming loop to parsing tool calls, displaying UI updates, and managing app state. Extracting the LangChain interaction loop into `src/generation/runner.ts` would make the TUI code much cleaner.

## 3. Unify Agent Execution Logic (`src/generation/runner.ts`)

Both `generateResponse` (which runs the Planner) and `runSubAgent` implement very similar `while(true)` loops for streaming LLM responses, accumulating chunks, parsing tool calls, executing tools, and appending tool messages. This logic could be deduplicated into a single `runAgentLoop` utility that all agents share.

## 4. Clean Up Stale Pinecone References

The `package.json` description and JSDoc comments in `src/config.ts` still mention Pinecone (`PINECONE_API_KEY`, `config.pinecone.indexName`, etc.), but it appears Pinecone functionality was removed in a previous refactor. Removing these stale references will avoid confusion.

## 5. Graceful Error Recovery (`src/tui/app.ts`)

When an LLM throws an error (e.g., rate limit, context window exceeded), the app enters an "error" state and blocks the UI with a prompt asking the user to "Press Enter to continue or /quit to exit". This could be improved to print the error in red and immediately return to the input prompt so the user can easily retry or adjust their request.
