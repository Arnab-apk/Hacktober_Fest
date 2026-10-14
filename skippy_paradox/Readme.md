# CodeCollab — Team Ascension

**Real-time collaborative code editor built for teams | Open Innovation**

CodeCollab is a browser-based collaborative coding platform developed by **Team Ascension** under the **Open Innovation** track. It allows multiple developers to write, edit, and review code together in real time. It pairs a feature-rich Monaco editor frontend with a purpose-built WebSocket collaboration server, delivering sub-second synchronization with conflict-free concurrent editing powered by Yjs CRDTs.

---

## Table of Contents

- [Platform Overview](#platform-overview)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Key Features](#key-features)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Open Innovation & Team](#open-innovation--team)


---

## Platform Overview

CodeCollab addresses the need for lightweight, zero-install collaborative coding environments. Unlike heavyweight IDE extensions or cloud workspaces that require account setup and infrastructure provisioning, CodeCollab runs entirely in the browser. A host creates a room, shares a six-character room code, and collaborators join instantly.

The platform is designed around three principles:

1. **Conflict-free real-time editing.** All document synchronization uses Yjs, a CRDT-based framework that guarantees eventual consistency without a central authority or operational transforms. Every keystroke propagates to all peers within milliseconds.

2. **Minimal infrastructure footprint.** The collaboration server is a single stateless Node.js process with no database dependency. Room state, document trees, and cursor awareness all live in memory for the duration of a session. This makes the system trivially deployable on any VPS, container platform, or serverless edge runtime.

3. **Production-grade editor experience.** The editor surface is Monaco (the engine behind VS Code), providing syntax highlighting for 50+ languages, IntelliSense, bracket pair colorization, minimap navigation, and full keyboard shortcut support out of the box.

---

## Architecture

CodeCollab follows a three-tier service architecture with clear separation of concerns:

```
                          +--------------------+
                          |     Frontend       |
                          |  React + Vite      |
                          |  Monaco Editor     |
                          |  Yjs Client        |
                          +--------+-----------+
                                   |
                    +--------------+--------------+
                    |                             |
           +-------v--------+          +---------v---------+
           |  REST Backend   |          |  Socket Server     |
           |  FastAPI/Python |          |  Node.js/ws        |
           |                 |          |                    |
           |  - GitHub OAuth |          |  - Room lifecycle  |
           |  - API proxy    |          |  - Yjs doc sync    |
           |  - Health checks|          |  - Cursor awareness|
           +--------+--------+          |  - Chat broadcast  |
                    |                   |  - File sharing    |
                    v                   +--------------------+
              GitHub API
```

### Dual WebSocket Channel Design

The socket server exposes two distinct WebSocket paths per room:

| Path | Protocol | Purpose |
|------|----------|---------|
| `/room/:roomId` | JSON | Control channel for room management, join/approve workflows, file sharing metadata, and chat messages |
| `/doc/:roomId/:fileId` | Binary (Yjs) | Document synchronization channel carrying Yjs sync and awareness protocol messages |

This separation ensures that heavy binary document traffic (sync vectors, state updates) never competes with lightweight JSON control messages on the same channel. Each shared file gets its own `Y.Doc` instance on the server, allowing independent synchronization lifecycles.

### Conflict Resolution

All concurrent edits are resolved using Yjs CRDTs (Conflict-free Replicated Data Types). Unlike Operational Transform (OT) systems that require a central server to serialize operations, CRDTs allow every peer to apply operations in any order and converge to the same state deterministically. This eliminates the need for server-side conflict resolution logic entirely.

---

## Technology Stack

### Frontend

| Technology | Role |
|------------|------|
| React 19 | Component framework |
| TypeScript 5.8 | Type safety |
| Vite 6 | Build toolchain and dev server |
| Monaco Editor | Code editing surface (VS Code engine) |
| Tailwind CSS 3 | Utility-first styling |
| Yjs + y-monaco | CRDT document binding to Monaco |
| y-websocket | WebSocket transport for Yjs |
| Lucide React | Icon system |

### Collaboration Server

| Technology | Role |
|------------|------|
| Node.js | Runtime |
| ws | WebSocket server |
| Yjs (server) | Server-side CRDT document persistence |
| y-protocols | Sync and awareness wire protocols |
| lib0 | Binary encoding/decoding utilities |

### REST Backend

| Technology | Role |
|------------|------|
| Python 3 | Runtime |
| FastAPI | HTTP framework |
| Uvicorn | ASGI server |
| httpx | Async HTTP client for GitHub API |

---

## Key Features

### Collaborative Editing
- Conflict-free real-time document synchronization via Yjs CRDTs
- Live remote cursor and selection rendering with color-coded peer indicators
- Cursor name tags that appear on hover for peer identification

### Room Management
- Host-controlled rooms with six-character invite codes
- Join request and approval workflow with real-time notifications
- Peer presence tracking with colored avatars and display names
- Room-wide file sharing with automatic content synchronization

### Code Editor
- Monaco Editor with full VS Code feature parity
- Catppuccin Mocha (dark) and Catppuccin Latte (light) color themes
- Syntax highlighting, bracket pair colorization, and minimap
- Configurable font size and word wrap settings

### Chat System
- Real-time room-wide text chat over the WebSocket control channel
- Server-stamped, authenticated messages with peer identification
- Auto-scrolling message feed with sender avatars and timestamps

### GitHub Integration
- OAuth-based GitHub authentication
- Repository browsing and file import directly into the editor
- Support for both public and private repositories (with appropriate scopes)

### Interface
- GPU-accelerated slide-in/out chat panel with 60fps+ transitions
- Mobile-responsive layout with off-canvas drawer sidebar
- Adaptive header and status bar that adjust to viewport constraints
- Dark and light theme support with system preference detection
- Local file persistence via browser storage

---

## Project Structure

```
Skiffy/
|
+-- frontend/                    React + Vite application
|   +-- src/
|   |   +-- components/
|   |   |   +-- EditorView.tsx           Main editor layout and toolbar
|   |   |   +-- ModernMonacoEditor.tsx   Standalone Monaco wrapper
|   |   |   +-- CollabMonacoEditor.tsx   Yjs-bound collaborative Monaco wrapper
|   |   |   +-- ChatPanel.tsx            Real-time chat side panel
|   |   |   +-- CollabBar.tsx            Collaboration status and peer indicators
|   |   |   +-- CollabRoomModal.tsx      Room creation and join dialog
|   |   |   +-- FileExplorer.tsx         File tree with drag-and-drop support
|   |   |   +-- GitHubImportModal.tsx    GitHub OAuth and repository browser
|   |   |   +-- MobileWarning.tsx        Small-screen orientation advisory
|   |   +-- services/
|   |   |   +-- collabService.ts         WebSocket collaboration provider
|   |   |   +-- githubService.ts         GitHub API client and OAuth flow
|   |   |   +-- storageService.ts        Browser-local file persistence
|   |   +-- hooks/
|   |   |   +-- useCollabRoom.ts         Room state management hook
|   |   |   +-- useMountTransition.ts    CSS transition lifecycle hook
|   |   |   +-- useTheme.ts             Theme detection and toggle hook
|   |   +-- App.tsx                      Application root
|   |   +-- index.css                    Global styles and design tokens
|
+-- backend/                     FastAPI REST server
|   +-- main.py                  Application entry point
|   +-- routers/
|   |   +-- auth.py              GitHub OAuth token exchange
|   |   +-- github.py            GitHub API proxy endpoints
|   +-- requirements.txt         Python dependencies
|   +-- .env.example             Environment variable template
|
+-- backend-socket/              Node.js collaboration server
|   +-- server.js                WebSocket server with room and doc management
|   +-- package.json             Node.js dependencies
```

---

## Getting Started

### Prerequisites

- Node.js 18 or later
- Python 3.10 or later
- A GitHub OAuth App (for repository import functionality)

### 1. Clone the Repository

```bash
git clone https://github.com/Arnab-apk/Skiffy.git
cd Skiffy
```

### 2. Start the REST Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # Edit .env with your GitHub OAuth credentials
python main.py
```

The API server starts on `http://localhost:8000` by default.

### 3. Start the Collaboration Server

```bash
cd backend-socket
npm install
npm start
```

The WebSocket server starts on `http://localhost:4000` by default.

### 4. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

The development server starts on `http://localhost:3000` (or the next available port).

---

## Environment Variables

### REST Backend (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | Required |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret | Required |
| `GITHUB_OAUTH_SCOPES` | OAuth scopes requested during authorization | `repo read:org read:user` |
| `FRONTEND_URL` | Frontend origin for CORS and OAuth redirects | `http://localhost:3000` |
| `FRONTEND_ORIGINS` | Comma-separated list of allowed CORS origins | Falls back to `FRONTEND_URL` |
| `BACKEND_PUBLIC_URL` | Public URL of this backend (required in production for OAuth callback) | Empty |

### Frontend (`frontend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | REST backend URL | `http://localhost:8000` |
| `VITE_COLLAB_URL` | WebSocket collaboration server URL | `ws://localhost:4000` |

### Collaboration Server

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | WebSocket server listen port | `4000` |

---

## Open Innovation & Team

- **Team**: Team Ascension
- **Track**: Open Innovation
- **Project**: CodeCollab / Skiffy

*Built with passion for seamless, real-time collaboration.*

