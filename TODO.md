# TODO

## 5. Graceful Error Recovery (`src/tui/app.ts`)

When an LLM throws an error (e.g., rate limit, context window exceeded), the app enters an "error" state and blocks the UI with a prompt asking the user to "Press Enter to continue or /quit to exit". This could be improved to print the error in red and immediately return to the input prompt so the user can easily retry or adjust their request.
