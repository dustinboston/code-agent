  The `src/tui/app.tsx` file is currently doing too many things at once: managing React state, formatting terminal output, handling slash commands, running LangChain agent loops, and rendering the UI.

  Here are 5 concrete ways you can refactor it to make it simpler, shorter, and much more maintainable:

### 1. Extract Sub-Agent Logic (`runSubAgent` & `createSendMessageTool`)

  **Why:** These two functions take up ~150 lines at the top of the file. They contain pure LangChain orchestration logic and have nothing to do with React components.
  **How:** Move them into a new file like `src/agent/runner.ts` or `src/generation/runner.ts`. You can pass the necessary callbacks (`onStatus`, `onActivity`, `requestApproval`) as arguments.

### 2. Break up the massive `handleSubmit` function

  **Why:** Currently, `handleSubmit` is ~150 lines long. It acts as a router for slash commands, handles the complex `while` loop for "Team" mode, and manages the RAG retrieval for "Chat" mode.
  **How:** Split it into smaller, dedicated functions:

* `handleTeamQuery(...)` - extracts the `mode === "team"` block.
* `handleChatQuery(...)` - extracts the RAG retrieval and single-shot generation.
* Keep `handleSubmit` short by just delegating to these functions.

### 3. Move Slash Commands to a separate file

  **Why:** The `handleCommand` function is a large `switch` statement (~60 lines) handling commands like `/help`, `/clear`, and `/ingest`.
  **How:** Extract this into a standalone file like `src/tui/commands.ts`. You can export a function like `processSlashCommand(cmd, config, callbacks)` that handles the logic and uses callbacks to update the UI state.

### 4. Extract the Message Formatter (`writeMsg`)

  **Why:** The `writeMsg` callback mixes UI styling (using `chalk`) with standard output logic.
  **How:** Move this to a helper file like `src/tui/format.ts`. You can create a function `export function printChatMessage(write: (text: string) => void, msg: ChatMessage)` and pass Ink's `useStdout().write` function to it.

### 5. Create a `useAppController` Hook

  **Why:** The `App` component has over 10 `useState` declarations and multiple `useCallback` / `useEffect` hooks. This clutters the rendering logic.
  **How:** Move all the state management, initialization (`createTeam`/`createChat`), and event handlers into a custom hook (e.g., `src/tui/useAppController.ts`).
  Your `App.tsx` will then shrink to just a few lines of rendering logic:

  ```tsx
  export function App({ config, mode = "chat" }: AppProps) {
    const {
      appState, statusMsg, errorMsg, input, setInput,
      handleSubmit, pendingApprovals, currentSources
    } = useAppController(config, mode);

    if (appState === "initializing") return <InitializingView msg={statusMsg} />;

    return (
      <Box flexDirection="column">
        <StatusBar state={appState} message={statusMsg} sourcesCount={currentSources.length} />
        {/* Input area logic... */}
      </Box>
    );
  }
  ```

  Would you like me to assign a developer to start implementing any of these specific refactoring steps?
