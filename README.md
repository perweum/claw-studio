# Claw Studio

> Visual AI agent builder for [nanoclaw](https://github.com/nanoclaw-ai/nanoclaw) — no code required.

Claw Studio lets you design, configure, and deploy personal AI bots using a drag-and-drop canvas. Connect nodes that represent triggers, agents, tools, memory, and outputs. When you're happy with the design, hit **Deploy** and Claw Studio writes the configuration directly to nanoclaw.

---

## Features

- **Visual pipeline editor** — drag-and-drop canvas powered by [React Flow](https://reactflow.dev), with minimap and keyboard shortcuts
- **AI chat assistant** — describe what you want in plain English; the assistant builds or edits nodes for you using Claude
- **10 node types** — Trigger, Agent, Tool (Bash + MCP), Memory, Transform, Condition, Router, Output, File, Comment
- **Free weather built-in** — yr.no weather and air quality presets, no API key needed
- **MCP service picker** — built-in presets for Gmail, Google Calendar, iCal, News, and more
- **Schedule presets** — pick from common schedules ("Every day at 8am") without writing cron expressions
- **OAuth-aware** — nodes for Gmail and Google Calendar never ask for an API key; Claw Studio detects your existing credentials automatically
- **Configuration warnings** — amber `!` badges highlight nodes that still need setup before deploying
- **Deploy actions** — Deploy shows exactly what was applied automatically vs. what needs manual steps
- **One-click backup** — back up all your bots via the `⋯` menu in the toolbar
- **Setup wizard** — first-run wizard detects your nanoclaw installation and walks through API key setup

---

## Requirements

- [nanoclaw](https://github.com/nanoclaw-ai/nanoclaw) installed and running
- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/settings/keys) (for the AI assistant and your bots)

---

## Installation

```bash
# Clone into your nanoclaw Projects folder (or anywhere you like)
git clone https://github.com/perweum/claw-studio.git
cd claw-studio

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open the URL shown in your terminal (usually `http://localhost:5173`) in your browser.

On first launch, the setup wizard will:
1. Auto-detect your nanoclaw installation (or let you enter the path manually)
2. Ask for your Anthropic API key if not already configured
3. Offer to create your first bot immediately

---

## Usage

### Creating a bot

Click **+ New bot** in the toolbar. Give it a name and optionally connect an output channel (Telegram, WhatsApp, Slack, etc.) so it knows where to send messages.

### Building a pipeline

Use the toolbar buttons or `Cmd/Ctrl+K` to open the command palette and add nodes. Connect nodes by dragging from a source handle to a target handle. Click any node to open its settings panel on the right.

**Node types:**

| Node | What it does |
|------|-------------|
| **Trigger** | Starts the pipeline — schedule (cron), webhook, or message |
| **Agent** | A Claude agent with a system prompt and optional tools |
| **Tool** | Gives an agent capabilities — Bash scripts or MCP services |
| **Memory** | Reads from or writes to the group's persistent memory |
| **Transform** | Formats, truncates, or extracts data |
| **Condition** | Branches the pipeline based on a true/false check |
| **Router** | Sends output to different paths based on content |
| **Output** | Sends a message or calls a webhook |
| **File** | Reads or writes a file in the group's workspace |
| **Comment** | Adds a note to the canvas (not deployed) |

### Using the AI assistant

Type in the chat panel on the left. Examples:

> "Add a morning briefing that runs at 7am, reads my Gmail and calendar, and sends a summary to Telegram"

> "Add a weather tool that checks Oslo and posts the forecast"

> "Make the agent more concise"

### Deploying

Click **Deploy** in the toolbar. Claw Studio will:
- Write the agent's `CLAUDE.md` instructions to the nanoclaw group
- Register any schedule triggers in nanoclaw's database
- Show a summary of what was done automatically and what still needs manual setup (e.g. API keys, channel registration)

### Backing up your bots

Click the **⋯** menu in the top-right of the toolbar → **Back up all bots**. This downloads a `.zip` containing your bots, their memory, conversation history, and credentials — everything needed to restore on another machine.

---

## Project Structure

```
claw-studio/
├── chat-plugin.ts        # Vite dev-server plugin — API routes + Claude integration
├── vite.config.ts        # Vite config, loads the plugin
├── src/
│   ├── App.tsx           # Root component, layout, keyboard shortcuts
│   ├── store.ts          # Zustand state — nodes, edges, group, deploy
│   ├── types.ts          # Node data types and metadata
│   ├── schema.ts         # Zod schema for blueprint validation
│   ├── components/
│   │   ├── ChatPanel.tsx       # AI assistant sidebar (left)
│   │   ├── NodePanel.tsx       # Node settings panel (right, opens on selection)
│   │   ├── Toolbar.tsx         # Top bar — bots, deploy, palette, backup
│   │   ├── GroupPicker.tsx     # Bot selector / new bot modal
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
| `GET /api/groups/:folder/blueprint` | Load a group's visual blueprint |
| `PUT /api/groups/:folder/blueprint` | Save a group's visual blueprint |
| `POST /api/groups/:folder/deploy` | Generate CLAUDE.md + register schedules |
| `GET /api/groups/channels` | List registered channels (Telegram, Slack, etc.) |
| `POST /api/chat` | Stream a Claude response for the AI assistant |
| `GET /api/backup` | Download a zip backup of all bots and data |

---

## Configuration

Claw Studio stores its own config in a local `.env` file:

```env
NANOCLAW_PATH=/path/to/your/nanoclaw
```

This is auto-detected if Claw Studio is placed inside or next to your nanoclaw directory. The setup wizard handles it on first run.

nanoclaw's own `.env` (for `ANTHROPIC_API_KEY` and channel tokens) is read from the nanoclaw directory.

---

## Security Model

The Claw Studio chat assistant can run shell commands on your machine to help with setup and installation. This is intentional — it removes the need to switch to a terminal for things like installing channels or configuring tokens. These guardrails are built in:

### Always blocked
| Pattern | Reason |
|---------|--------|
| `sudo` | No privilege escalation |
| `curl ... \| bash` | No piped script execution |
| `dd if=` | No disk write operations |
| `mkfs` | No filesystem formatting |
| Redirects to system paths (`> /etc/...`) | No writes outside user directories |

### Requires your approval
These commands show **Approve / Cancel** buttons in the chat before anything runs:
- `rm` / `rmdir` — file and directory deletion
- `git reset --hard` / `git clean -f` — destructive git operations
- `launchctl kickstart` / `systemctl restart` — service restarts

### Secret protection
When reading `.env` files, all values containing `_TOKEN`, `_SECRET`, `_PASSWORD`, `API_KEY`, or `OAUTH` are replaced with `[hidden]` before being sent to Claude. Your keys and tokens are never included in the AI context.

### Sandbox
All commands run with the nanoclaw directory as the working directory. File reads that resolve outside the nanoclaw directory are rejected.

### Network exposure
The dev server binds to `localhost` only (Vite's default). Claw Studio is not accessible from other machines unless you explicitly change `vite.config.ts`.

### Prompt injection
File contents read by the assistant (CLAUDE.md, logs, etc.) are passed as tool results, not injected into the system prompt.

---

## FAQ

### Do my bots keep running when Claw Studio is closed?

Yes. Claw Studio is just the editor — your bots run inside **nanoclaw**, which is a separate background service. Closing the Claw Studio browser tab or terminal has no effect on your running bots.

### How do I move my bots to a new computer?

Use the **⋯ → Back up all bots** option in the toolbar. This downloads a zip containing everything nanoclaw needs: your bots, their memory, conversation history, API keys, and channel credentials.

On the new machine:
1. Install nanoclaw and run `npm install && ./container/build.sh`
2. Extract the backup zip into your nanoclaw folder
3. Clone Claw Studio and run `npm install && npm run dev`

Everything picks up exactly where it left off.

### How much does it cost to run?

The AI assistant in Claw Studio uses Claude via the Anthropic API, which is pay-as-you-go. Designing bots (chatting with the assistant) typically costs a few cents per session. Running bots depends on how often they trigger — a daily briefing bot costs roughly $0.01–0.05 per day.

You can monitor usage at [console.anthropic.com](https://console.anthropic.com).

### Can I use Claw Studio without nanoclaw?

No — Claw Studio is a visual editor for nanoclaw configurations. It needs nanoclaw running to save blueprints, register schedules, and deploy bots. [Install nanoclaw here](https://github.com/nanoclaw-ai/nanoclaw).

### How do I add a Telegram / WhatsApp / Slack channel?

Open the **+ New bot** modal and click one of the channel buttons (Telegram, WhatsApp, Slack, Discord). The AI assistant will walk you through the setup — no terminal needed.

### What happens to my bots when I update Claw Studio?

Your bots and their data live in nanoclaw, not in Claw Studio. Updating Claw Studio (pulling the latest git version) only changes the editor. Your bots continue running unaffected.

### The AI assistant added nodes but nothing happened after deploying

Deploying writes a `CLAUDE.md` file to the group and registers any schedules, but your bot only responds to messages if nanoclaw is running and the group has a registered channel. Check:
1. nanoclaw is running (`launchctl list | grep nanoclaw` on macOS)
2. The group has a channel connected (visible in the **My bots** list)
3. The deploy summary didn't show any red "needs attention" items

### Can multiple people use the same nanoclaw?

Claw Studio is designed for personal use on a single machine. nanoclaw itself is single-user by design.

---

## Contributing

Contributions are welcome! A few things to know:

- The project uses **React + Vite + TypeScript**
- State is managed with **Zustand** (`src/store.ts`)
- The canvas is **React Flow** (`@xyflow/react`)
- The backend plugin (`chat-plugin.ts`) runs inside the Vite dev server — no Express or separate server
- nanoclaw's `better-sqlite3` is loaded via `createRequire` from nanoclaw's own `node_modules`

```bash
npm install && npm run dev   # develop
npm run build                # type-check + bundle
```

Please open an issue before starting large changes so we can discuss the approach.

---

## License

MIT
