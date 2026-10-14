# Skippy Collaborative IDE

Skippy Collaborative IDE is a browser-based collaborative coding environment that combines:

- a Monaco-powered frontend for editing and running code,
- a Yjs WebSocket collaboration server for real-time shared editing,
- a FastAPI backend for code execution and integration endpoints,
- the Python Skippy harness for agentic coding with Ollama and OpenRouter providers.

The project is designed for pair-programming and AI-assisted development in a shared workspace, with live room-based editing and a single model-driven coding loop per room.

## What this project does

This repository starts a complete local development stack from one root command:

- IDE frontend: http://localhost:3100
- Python API backend: http://localhost:8100
- Collaboration server: http://localhost:4100

The application lets two or more people collaborate in a room, share files, edit code together, and ask the Skippy agent to make changes to the shared project state. The harness can use locally installed Ollama models or an OpenRouter API key, and it validates tool support before executing file and shell actions.

## Architecture

```text
+--------------------------+
| Browser / IDE client     |
| React + Vite + Monaco    |
| Yjs collaboration        |
+------------+-------------+
             |
             v
+--------------------------+
| skippy_paradox/frontend  |
| UI, editor, room state, |
| harness panel, GitHub    |
| push/import workflows    |
+------------+-------------+
             |
             +---------------------------+
             |                           |
             v                           v
+--------------------+     +---------------------------+
| skippy_paradox/backend |  | skippy_paradox/backend-socket |
| FastAPI service     |  | Node.js + ws + Yjs         |
| - /api/auth         |  | - room lifecycle          |
| - /api/github       |  | - file sharing            |
| - /api/judge0      |  | - document sync           |
| - /api/harness      |  | - peer awareness          |
+--------------------+  +---------------------------+
             |
             v
+------------------------------+
| Skippy_harness               |
| Python coding agent          |
| Ollama / OpenRouter backends |
| file tools + shell approval  |
+------------------------------+
```

## Key features

### Real-time collaborative editing

- Yjs CRDT-backed editing across multiple browser clients
- Room-based collaboration with host + join approval flow
- Shared files only visible inside the active room
- Active file sync and file-sharing controls in the editor explorer
- Presence awareness, member list, and room state updates

### AI coding assistant

- Skippy harness integrated into the IDE UI
- Provider support for:
  - Ollama (local models)
  - OpenRouter (API-based model access)
- Live model discovery and validation
- File editing through tool loops with approval flow
- Agent run protection against conflicting edits during active sessions

### Code execution and project actions

- Run the current file through the Python API
- Uses local Python/JavaScript runtimes when available
- GitHub push workflow for selected files, active file, or full workspace
- Import files from GitHub into the collaborative workspace

### Safety and control

- Shell tools are disabled by default
- Shell commands require a deliberate approval choice in the harness UI
- The harness enforces tool validation before starting a run
- Human edits are preserved when an agent edit conflict occurs

## Tech stack

### Frontend

- React 19
- Vite
- Monaco Editor
- TypeScript
- Yjs and y-websocket
- Tailwind styling

### Backend

- Python 3.10+
- FastAPI
- Uvicorn
- httpx

### Collaboration layer

- Node.js
- ws WebSocket server
- Yjs, y-protocols, lib0

### AI harness

- Python runtime with Skippy harness
- OpenAI-compatible provider support
- Ollama and OpenRouter specific integration
- File, shell, and session management tooling

## Repository layout

```text
.
├── README.md
├── .env.example
├── package.json
├── render.yaml
├── requirements.txt
├── setup.ps1
├── scripts/
│   ├── dev.mjs
│   └── serve.mjs
├── tests/
│   ├── browser-smoke.mjs
│   ├── collab.test.mjs
│   ├── github.test.mjs
│   └── test_bridge.py
├── skippy_paradox/
│   ├── backend/
│   ├── backend-socket/
│   ├── frontend/
│   ├── COMPLETE_DOCUMENTATION.md
│   ├── DEPLOYMENT.md
│   ├── Readme.md
│   └── AGENTIC_HARNESS_SPEC.md
├── Skippy_harness/
│   └── ... Python harness sources and tests
├── .venv310/
├── node_modules/
└── artifacts/
```

## Prerequisites

- Node.js
- Python 3.10+
- uv
- Ollama (optional, for local model usage)

## Quick start

### Recommended local setup

Windows:

```powershell
.\setup.ps1
npm.cmd start
```

This creates the Python virtual environment, installs project dependencies, builds the frontend, and launches the full stack.

### Run the stack manually

From the repo root:

```powershell
npm.cmd start
```

The root launcher starts all required services together.

## Default ports

- IDE: http://localhost:3100
- Python API: http://localhost:8100
- Collaboration server: http://localhost:4100

Press Ctrl+C in the launcher terminal to stop all services.

## Using the app

### Shared collaboration workflow

1. Open the IDE at http://localhost:3100.
2. Click Collab and create a room with a display name.
3. Share the room code with the second participant.
4. The other person joins the same room and waits for approval from the host.
5. Shared files appear in the explorer and are synchronized in real time.

### AI-assisted coding workflow

1. Open the Skippy Harness panel in the IDE.
2. Select Ollama or OpenRouter as the provider.
3. Pick an installed or available model.
4. Ask the agent to modify files, inspect code, or create new project assets.
5. Review tool output and file diffs in the room as the run progresses.

The harness uses the room's shared workspace, so participants can watch changes as the agent works.

### Remote access

For access from another machine on the same network:

1. Copy `.env.example` to `.env`
2. Set a strong `SKIPPY_ACCESS_TOKEN`
3. Restart the app
4. Share the LAN IP of the host machine on port 3100

Example:

```text
http://<your-computer-LAN-IP>:3100
```

Use HTTPS when exposing the app beyond a trusted local network.

## Environment variables

The project uses root-level environment settings for the harness and access control. See `.env.example` for the default values.

Important keys include:

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `SKIPPY_ACCESS_TOKEN`
- `SKIPPY_ALLOW_SHELL`
- `MAX_AGENT_STEPS`
- `LLM_TIMEOUT`

The Python backend and socket service also use environment-based configuration for CORS, GitHub integration, and deployment settings.

## GitHub integration

The app includes GitHub push and import workflows. You can:

- push selected shared files, the active file, or the whole workspace,
- target a branch and repository,
- review the staged file list before upload,
- create a branch from the default branch when needed.

This feature requires a valid GitHub PAT with the necessary repository permissions.

## Validation and tests

The project includes unit and smoke tests for the collaboration and GitHub features. Common validation commands:

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:github
npm.cmd run test:collab
.\.venv310\Scripts\python.exe -m unittest discover -s tests -p test_bridge.py -v
$env:PYTHONPATH = "$PWD\Skippy_harness"
.\.venv310\Scripts\python.exe -m unittest discover -s Skippy_harness/tests -v
node tests/browser-smoke.mjs
```

The repository has been validated with harness tests, bridge tests, GitHub request tests, a two-client Yjs integration check, and a browser-based smoke workflow.

## Notes and limitations

- Chat room and live collaboration state are held in memory by the socket server
- Restarting the collaboration service clears active rooms
- Browser-local storage caches editor files; saved projects are persisted under `.skippy-ide/` on the IDE server.
- The terminal runs the existing Python CLI in the saved project directory. The AI panel retains its existing transport and saves accepted edits to that directory.
- Shell execution is intentionally gated and requires a user-approved action

## Summary

This project is a practical local-first collaborative coding environment with an AI coding agent built in. It is useful for pair programming, shared file editing, model-driven code changes, and quick GitHub sync workflows in a single developer-friendly stack.

## Saved projects, terminal Skippy, and checkpoints

Install frontend and socket dependencies with `npm install` in each service directory, then run `npm start` from the root. The socket service requires `node-pty`; Windows uses ConPTY.

1. Click **Save project** to save browser files, or **Import folder** to copy a local folder’s UTF-8 text files into a project. Pick saved projects from the project selector. The folder import excludes binary, large, generated, dependency, and Git files; terminal-created binary assets are retained on disk.
2. Editor changes save automatically. Terminal input waits for pending saves. Disk changes from commands and Skippy appear in the file explorer and Monaco. Concurrent changes produce a conflict with **Use disk version** and **Keep editor version** choices.
3. Open **Terminal**, type `skippy` or `skippy --resume`, and use the existing `/model`, `/provider`, tools, and command approvals. The selected provider, model, and existing OpenRouter key are passed to new shells. Use Ctrl+C to interrupt and Ctrl+Shift+C/V to copy or paste.
4. Use **+** for more terminal tabs, **Release input** and **Take control** for shared viewing, and the top resize handle (or arrow keys) to resize the panel. **Hide terminal panel** preserves the shell. **Close terminal session** ends it. Unviewed idle shells expire after 15 minutes; service shutdown ends terminal processes.
5. A checkpoint is created before each Skippy run. **Review changes** compares current files to a checkpoint. Restoring requires stopping Skippy and closing terminal sessions, and creates a recovery checkpoint first. Checkpoints include project text and binary files up to 2,000 files / 50 MB, excluding Git, dependency, generated, and harness session directories.

The room host opens the project for everyone. Room files synchronize with the same disk workspace; terminal Skippy and the AI panel share the room agent lock. Input ownership is separate and can be explicitly released or claimed. Saved projects and checkpoints survive service restarts; live rooms and terminal processes do not. A server access token is required for remote terminal/workspace access.

Run `npm run test:workspaces`, `npm run typecheck`, and `npm run build` for validation. The workspace integration test uses a real Windows PTY and the existing Python CLI’s help command without making a model API call.


## Gemma 4 Code Mentor

Open the AI panel and choose **Gemma Mentor**. This focused learning and productivity tool combines your question, optional active-file code, and a PNG/JPEG/WebP screenshot using `gemma-4-26b-a4b-it` through the Gemini API. Choose Explain code, Review bugs, Debug screenshot, or Build from design; use an example question or write your own, then ask follow-up questions.

1. Get a Gemini API key from Google AI Studio: https://aistudio.google.com/apikey
2. Copy `.env.example` to `.env` if needed; set `GEMINI_API_KEY` in the root `.env`. Keep this key on the server. The root launcher loads it into the backend environment. When starting the backend separately, configure its environment or backend `.env` instead.
3. Optionally set `GEMMA_MODEL=gemma-4-31b-it`; the default is `gemma-4-26b-a4b-it`.
4. Run `npm run build`, then `npm start` (or `npm run dev`). For remote access, configure `SKIPPY_ACCESS_TOKEN` and enter that token in the mentor's Server access settings.

The mentor sends only explicitly included active-file content (first 24,000 characters), the attached image (up to 4 MB), your prompt, and up to ten recent chat messages to Google. Images stay attached for follow-ups until removed. Chat and images are held in this tab's memory and reset on reload. Responses are advice: the mentor does not execute code or edit files. Existing Skippy Agent tools remain accessible in the adjacent tab. API quotas, key permissions, and model availability still apply; failures appear in the panel with retry guidance. No automatic switch to another model is made.

Official model and multimodal API documentation: https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api

Validation (mocked upstream API; no paid calls):

```powershell
.\.venv310\Scripts\python.exe -m unittest discover -s tests -p test_gemma.py -v
npm run typecheck
npm run build
```


### Local, Gemini API, and OpenRouter providers

Both Skippy Agent (file-editing tool loop) and Gemma Mentor now offer Gemini API, Ollama, and OpenRouter. Agent cloud calls use the backend too. Server keys are read from `GEMINI_API_KEY` and `OPENROUTER_API_KEY` in the ignored root `.env`; they are never returned to the browser. Existing browser-stored cloud keys are cleared when the agent mounts. Set `GEMMA_OPENROUTER_MODEL` to change the mentor's OpenRouter model. The agent lists available tool-capable models and prefers Gemma 4.

Start Ollama (`ollama serve`) and select your installed Gemma 4 tag. Mentor discovers installed Gemma 4 models; `GEMMA_LOCAL_MODEL` can set a preferred tag. If your backend is on your laptop, `OLLAMA_BASE_URL=http://localhost:11434/v1` uses the laptop model without cloud model traffic. A remotely hosted backend needs a reachable authenticated private endpoint/tunnel to your laptop; its localhost is not your laptop. Do not expose an unauthenticated Ollama server publicly.

Traffic controls: 60-second model catalog cache, four mentor requests at a time, pooled mentor HTTP connections, bounded recent chat and active-code context, bounded output, and no automatic provider retries or switching in the mentor. Local models are kept loaded for ten minutes. Skippy uses its existing bounded tool loop and context compaction; configure `MAX_AGENT_STEPS` and `CONTEXT_WINDOW` on the server to tune agent request volume. Merely storing a key cannot reduce token traffic or remove provider rate limits.

This laptop is configured for `gemma4:e4b` using existing weights in `D:\Ollama` and the loopback endpoint `http://127.0.0.1:11435/v1`. After reboot, run `.\scripts\start-local-gemma.ps1` before `npm start`. The dedicated port avoids other Ollama instances with a different model directory. New browser sessions default to local Ollama; saved provider preferences are respected.
