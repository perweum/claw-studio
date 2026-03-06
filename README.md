# Blueprint UI

> Visual node editor for designing [nanoclaw](https://github.com/nanoclaw-ai/nanoclaw) AI agent pipelines — no code required.

Blueprint lets you drag, connect, and configure nodes that represent the building blocks of your personal AI assistant: triggers, agents, tools, memory, conditions, and outputs. When you're happy with the design, hit **Deploy** and Blueprint writes the configuration directly to nanoclaw.

---

## Features

- **Visual pipeline editor** — drag-and-drop canvas powered by [React Flow](https://reactflow.dev), with minimap and keyboard shortcuts
- **AI chat assistant** — describe what you want in plain English and the assistant generates or edits nodes for you using Claude
- **10 node types** — Trigger, Agent, Tool (Bash + MCP), Memory, Transform, Condition, Router, Output, File, Comment
- **MCP service picker** — built-in presets for Gmail, Google Calendar, iCal, Weather, News, and more
- **Schedule presets** — pick from common schedules ("Every day at 8am") without writing cron expressions
- **OAuth-aware** — nodes for Gmail and Google Calendar never ask for an API key; Blueprint detects your existing credentials automatically
- **Configuration warnings** — amber `!` badges highlight nodes that still need setup before deploying
- **Deploy actions** — Deploy shows exactly what was applied automatically vs. what needs manual steps
- **Setup wizard** — first-run wizard detects your nanoclaw installation and walks through API key setup
- **Multi-group support** — open any nanoclaw group, edit its blueprint, and save/deploy independently

---

## Requirements

- [nanoclaw](https://github.com/nanoclaw-ai/nanoclaw) installed and configured
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com) (for the AI chat assistant)

---

## Installation

```bash
# Clone this repo into your nanoclaw Projects folder (or anywhere you like)
git clone https://github.com/perweum/blueprint-ui.git
cd blueprint-ui

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

On first launch, the setup wizard will:
1. Auto-detect your nanoclaw installation (or let you enter the path manually)
2. Ask for your Anthropic API key if not already configured

---

## Usage

### Opening a group

Click **Open group…** in the toolbar to load a nanoclaw group. Each group has its own isolated blueprint.

### Building a pipeline

Use the **+** button or `Cmd/Ctrl+K` to open the command palette and add nodes. Connect nodes by dragging from a source handle to a target handle.

**Node types:**

| Node | What it does |
|------|-------------|
| **Trigger** | Starts the pipeline — schedule (cron), webhook, or message |
| **Agent** | A Claude agent with a system prompt and optional tools |
| **Tool** | Gives an agent capabilities — Bash scripts or MCP services |
| **Memory** | Reads from or writes to the group's persistent memory |
| **Transform** | Summarizes, translates, formats, or extracts data |
| **Condition** | Branches the pipeline based on a true/false check |
| **Router** | Sends output to different paths based on content |
| **Output** | Sends a message or calls a webhook |
| **File** | Reads or writes a file in the group's workspace |
| **Comment** | Adds a note to the canvas (not deployed) |

### Using the AI assistant

Type in the chat panel on the right. Examples:

> "Add a morning briefing that runs at 7am, reads my Gmail and calendar, and sends a summary to Telegram"

> "Add a condition that only continues if the email is marked urgent"

> "Change the agent's system prompt to be more concise"

### Deploying

Click **Deploy** in the toolbar. Blueprint will:
- Write the agent's `CLAUDE.md` instructions to the group
- Register any schedules in nanoclaw's database
- Show a summary of what was done automatically and what needs manual setup (e.g. API keys)

---

## Project Structure

```
blueprint-ui/
├── chat-plugin.ts        # Vite dev-server plugin — API routes + Claude integration
├── vite.config.ts        # Vite config, loads the plugin
├── src/
│   ├── App.tsx           # Root component, layout, keyboard shortcuts
│   ├── store.ts          # Zustand state — nodes, edges, group, deploy
│   ├── types.ts          # Node data types and metadata
│   ├── schema.ts         # Zod schema for blueprint validation
│   ├── components/
│   │   ├── ChatPanel.tsx       # AI assistant sidebar
│   │   ├── NodePanel.tsx       # Node configuration panel (right-click or click)
│   │   ├── Toolbar.tsx         # Top bar — open group, deploy, palette
│   │   ├── GroupPicker.tsx     # Group selector modal
│   │   ├── SetupWizard.tsx     # First-run wizard
│   │   ├── CommandPalette.tsx  # Node type picker (Cmd+K)
│   │   └── ContextMenu.tsx     # Right-click menu on nodes
│   └── nodes/
│       ├── AgentNode.tsx
│       ├── TriggerNode.tsx
│       ├── ToolNode.tsx
│       ├── MemoryNode.tsx
│       ├── TransformNode.tsx
│       ├── ConditionNode.tsx
│       ├── RouterNode.tsx
│       ├── OutputNode.tsx
│       ├── FileNode.tsx
│       └── CommentNode.tsx
```

### How the backend works

`chat-plugin.ts` is a Vite plugin that adds API routes to the dev server — no separate backend process needed:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/setup` | Check if nanoclaw path is configured / auto-detected |
| `POST /api/setup` | Save nanoclaw path to local `.env` |
| `GET /api/config` | Check if Anthropic API key is configured |
| `POST /api/config` | Write API key to nanoclaw's `.env` |
| `GET /api/groups` | List nanoclaw groups |
| `GET /api/blueprint?group=` | Load a group's blueprint |
| `POST /api/blueprint` | Save a group's blueprint |
| `POST /api/deploy` | Deploy blueprint to nanoclaw |
| `POST /api/chat` | Stream a Claude response for the AI assistant |

---

## Configuration

Blueprint stores its own config in a local `.env` file (not nanoclaw's):

```env
NANOCLAW_PATH=/path/to/your/nanoclaw
```

This is auto-detected if Blueprint is placed inside or next to your nanoclaw directory. The setup wizard handles it on first run.

nanoclaw's own `.env` (for `ANTHROPIC_API_KEY` and channel tokens) is read from the nanoclaw directory.

---

## Security Model

The Blueprint chat assistant can run shell commands on your machine to help with setup and installation. This is a deliberate design decision — it removes the need to switch to a terminal for things like installing channels or configuring tokens. These guardrails are built in from the start:

### Always blocked
These patterns are rejected regardless of what you ask:

| Pattern | Reason |
|---------|--------|
| `sudo` | No privilege escalation |
| `curl ... \| bash` | No piped script execution |
| `dd if=` | No disk write operations |
| `mkfs` | No filesystem formatting |
| Redirects to system paths (`> /etc/...`) | No writes outside user directories |

### Requires your approval
These commands are shown in the chat with **Approve / Cancel** buttons before anything runs:

- `rm` / `rmdir` — file and directory deletion
- `git reset --hard` / `git clean -f` — destructive git operations
- `launchctl kickstart` / `systemctl restart` — service restarts (which briefly disconnect Blueprint itself)

### Secret protection
When reading `.env` files to check configuration, all values containing `_TOKEN`, `_SECRET`, `_PASSWORD`, `API_KEY`, or `OAUTH` are replaced with `[hidden]` before being sent to Claude. Your API keys and channel tokens are never included in the AI context.

### Sandbox
All commands run with the nanoclaw directory as the working directory. `read_file` rejects any path that resolves outside the nanoclaw directory (preventing path traversal).

### Network exposure
The dev server binds to `localhost` only (Vite's default). Blueprint UI is not accessible from other machines on your network unless you explicitly change `vite.config.ts`.

### Prompt injection
File contents (CLAUDE.md, logs, etc.) read by the assistant are passed as tool results, not injected into the system prompt, reducing the risk of malicious content in files redirecting the assistant.

---

## Contributing

Contributions are welcome! A few things to know:

- The project uses **React + Vite + TypeScript**
- State is managed with **Zustand** (`src/store.ts`)
- The canvas is **React Flow** (`@xyflow/react`)
- The backend plugin (`chat-plugin.ts`) runs inside the Vite dev server — no Express or separate server
- nanoclaw's `better-sqlite3` is loaded via `createRequire` from nanoclaw's own `node_modules`

**To run locally:**
```bash
npm install
npm run dev
```

**To build:**
```bash
npm run build
```

Please open an issue before starting large changes so we can discuss the approach.

---

## License

MIT
