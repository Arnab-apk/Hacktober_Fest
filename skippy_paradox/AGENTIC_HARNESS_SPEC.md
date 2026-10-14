# 🧠 Skiffy Architecture & Agentic Harness Feasibility Study

**Team**: Team Ascension  
**Track**: Open Innovation  
**Document Type**: Technical Assessment & Architecture Specification  
**Status**: Ready for Planning & Evaluation  

---

## 1. Executive Summary

### Can a fully functional Agentic Harness be built into Skiffy in 3 Hours?
**Yes**, absolutely.

The codebase is already uniquely primed for an agentic harness:
1. **Existing Gemini Foundation**: [GeminiPanel.tsx](file:///c:/Users/Somaditya/Desktop/skiffy_12/Skiffy/frontend/src/components/GeminiPanel.tsx) already implements direct streaming to Google Generative AI (`gemini-2.0-flash` / `gemini-1.5-pro`) and has a multi-key rotation engine ([geminiKeyRotation.ts](file:///c:/Users/Somaditya/Desktop/skiffy_12/Skiffy/frontend/src/services/geminiKeyRotation.ts)).
2. **Existing Execution Infrastructure**: [CodeRunner.tsx](file:///c:/Users/Somaditya/Desktop/skiffy_12/Skiffy/frontend/src/components/CodeRunner.tsx) and [judge0Service.ts](file:///c:/Users/Somaditya/Desktop/skiffy_12/Skiffy/frontend/src/services/judge0Service.ts) already execute code in multiple languages.
3. **CRDT Collaboration Architecture**: Real-time multi-peer sync via Yjs (`y-websocket` + `y-monaco`) means **an agent can edit files directly, and its changes stream immediately to every connected collaborator in the room**.

With **two Gemini Pro accounts**, token exhaustion and rate limits will not be a blocker.

---

## 2. Current State of the Codebase

### A. Repository Topology
```
Skiffy/
├── frontend/             # React 19 + TypeScript + Vite 6 + Tailwind CSS 3
│   ├── src/
│   │   ├── components/
│   │   │   ├── CollabMonacoEditor.tsx  # Monaco editor bound to Yjs CRDT
│   │   │   ├── EditorView.tsx          # Master layout (editor, tabs, modals, panes)
│   │   │   ├── FileExplorer.tsx        # File tree navigation & management
│   │   │   ├── GeminiPanel.tsx         # Streaming chat with Gemini 2.0 Flash
│   │   │   ├── CodeRunner.tsx          # Code execution output drawer
│   │   │   ├── ChatPanel.tsx           # Multi-user chat
│   │   │   └── VoiceLobbyPanel.tsx     # WebRTC voice rooms
│   │   ├── services/
│   │   │   ├── storageService.ts       # Local file persistence (LocalStorage)
│   │   │   ├── collabService.ts        # Dual WebSocket client (control + Yjs)
│   │   │   ├── geminiKeyRotation.ts    # Multi-API-key balancer
│   │   │   └── judge0Service.ts        # Code execution client
│   │   └── hooks/                      # Room, transition, and theme hooks
├── backend/              # FastAPI (Python 3.10+) REST Server
│   ├── main.py
│   └── routers/
│       ├── auth.py       # GitHub OAuth token exchange
│       ├── github.py     # GitHub repo fetching proxy
│       └── judge0.py     # Code execution proxy
└── backend-socket/       # Node.js WebSocket Collaboration Server
    └── server.js         # Yjs binary sync + JSON room management
```

### B. How Multi-User Collaboration Currently Works
* **JSON Control Channel** (`/room/:roomId`): Syncs room membership, approvals, file sharing metadata, and chat messages.
* **Binary Yjs Doc Channel** (`/doc/:roomId/:fileId`): Uses `y-protocols` (sync & awareness) to stream keystrokes and remote cursors.
* **Shared File State**: When a file is modified, its CRDT document emits updates across the WebSocket server, which updates all clients deterministically without merge conflicts.

### C. Current State of Gemini Integration
* **Model**: Defaults to `gemini-2.0-flash` with fallback to `gemini-1.5-pro`.
* **Current Mode**: Read-only advisory chatbot. It reads `activeFile.content` (truncated to 12,000 characters), sends it with history, and streams the markdown answer to the user.
* **What is missing for full Agentic Harness**:
  - The model has no **Tool Use / Function Calling** loop.
  - The model cannot **read other files** in the file tree.
  - The model cannot **write/modify files** directly into the workspace or Yjs doc.
  - The model cannot **trigger code execution or automated tests** and observe the output.

---

## 3. What is an "Agentic Harness" in this Context?

An **Agentic Harness** turns an LLM from a passive chat bot into an **autonomous pair-programmer** that:
1. **Perceives**: Scans the workspace file tree and reads any file requested.
2. **Reasons**: Formulates a plan using chain-of-thought (powered by Gemini Pro).
3. **Acts (Tool Calling)**:
   - `list_files()`: Discover files in the workspace.
   - `read_file(filename)`: Read exact code.
   - `write_file(filename, content)`: Create or update files (which auto-syncs to all room collaborators!).
   - `execute_code(language, code)`: Run code against Judge0/Piston or browser sandbox to verify syntax and output.
4. **Iterates**: Inspects stderr or test output, self-corrects code, and presents the final working result.

---

## 4. Recommended Model Matrix (Gemini Pro Tier)

| Feature | Recommended Model | Why |
|---|---|---|
| **Fast Planning & Discovery** | `gemini-2.0-flash` | Sub-500ms latency, handles tool calls instantly |
| **Deep Reasoning & Bug Fixing** | `gemini-1.5-pro` or `gemini-2.0-pro-exp` | 1M–2M context window, high coding benchmark accuracy |
| **Code Execution Validation** | `gemini-2.0-flash` | Quick evaluation of test cases and console outputs |

*Note: Having 2 Pro accounts means you can distribute keys across [geminiKeyRotation.ts](file:///c:/Users/Somaditya/Desktop/skiffy_12/Skiffy/frontend/src/services/geminiKeyRotation.ts) to eliminate rate limits.*

---

## 5. Architectural Blueprint for the Harness

```
 +-----------------------------------------------------------------------+
 |                         COLLABORATIVE IDE                             |
 |                                                                       |
 |   +--------------------+     +------------------------------------+   |
 |   | FileExplorer       |     | CollabMonacoEditor (Yjs CRDT)      |   |
 |   | [Files & Folders]  |     | (Collaborators see Agent edits     |   |
 |   +---------+----------+     |  streaming in real-time)           |   |
 |             ^                +------------------+-----------------+   |
 |             |                                   ^                     |
 |             | tool_write_file                   | tool_edit_doc       |
 |             v                                   v                     |
 |   +---------+-----------------------------------+-----------------+   |
 |   |                     AGENTIC HARNESS ENGINE                    |   |
 |   |                                                               |   |
 |   |  • ReAct Agent Loop (Perceive -> Reason -> Act -> Observe)    |   |
 |   |  • Gemini Function Calling Schema                             |   |
 |   |                                                               |   |
 |   |  Tools:                                                       |   |
 |   |    1. listFiles()                                             |   |
 |   |    2. readFile(fileId / path)                                 |   |
 |   |    3. writeFile(fileId / path, content)                       |   |
 |   |    4. runCode(language, code)                                 |   |
 |   |    5. selfTest(testCases)                                     |   |
 |   +---------------------------------+-----------------------------+   |
 |                                     ^                                 |
 |                                     | HTTP/SSE with Function Calling  |
 |                                     v                                 |
 |                         +-----------+-----------+                     |
 |                         | Google Gemini Pro API |                     |
 |                         | (Key Rotation Engine) |                     |
 |                         +-----------------------+                     |
 +-----------------------------------------------------------------------+
```

---

## 6. Three-Hour Implementation Plan

### Phase 1: Tool Definition & Gemini Function Calling (Minutes 0 – 50)
- Add Gemini Tool schemas to [geminiKeyRotation.ts](file:///c:/Users/Somaditya/Desktop/skiffy_12/Skiffy/frontend/src/services/geminiKeyRotation.ts) / `agentService.ts`:
  - `listFiles`: Returns all files from [storageService.ts](file:///c:/Users/Somaditya/Desktop/skiffy_12/Skiffy/frontend/src/services/storageService.ts) and shared room files.
  - `readFile(name)`: Returns file content.
  - `writeFile(name, content)`: Writes to local files and emits room share update if in collaboration mode.
  - `runCode(code, language)`: Connects directly to [judge0Service.ts](file:///c:/Users/Somaditya/Desktop/skiffy_12/Skiffy/frontend/src/services/judge0Service.ts).

### Phase 2: Autonomous ReAct Loop (Minutes 50 – 110)
- Build an Agent execution coordinator:
  - While agent returns `functionCall`:
    1. Intercept function call in frontend.
    2. Execute tool locally (read file, write file, or run code).
    3. Return `functionResponse` back to Gemini.
    4. Repeat until Gemini returns the final text response.
  - Show live "Agent Action Badges" (e.g. `🔧 Reading src/App.tsx...`, `✏️ Updating index.html...`, `▶ Executing tests...`).

### Phase 3: UI Integration & Live Room Sync (Minutes 110 – 160)
- Add an "Agent Mode" switch in [GeminiPanel.tsx](file:///c:/Users/Somaditya/Desktop/skiffy_12/Skiffy/frontend/src/components/GeminiPanel.tsx) or a floating Action Bar.
- Hook file edits into Monaco / Yjs so when the agent modifies code:
  - The collaborator on the other laptop immediately sees the new code!
  - Add an undo / diff review confirmation if desired.

### Phase 4: Verification & Demo Polish (Minutes 160 – 180)
- Test prompt: *"Read the current file, create a unit test for it in a new file, execute it, and fix any bugs found."*
- Validate that the other laptop sees the files being created and edited in real time.

---

## 7. Safety & Integrity Notice

- **No unauthorized git push**: All original files and existing git state remain untouched.
- **Collaborative Safe**: The existing WebSocket synchronization between laptops will continue working uninterrupted.
