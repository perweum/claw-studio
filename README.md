<div align="center">
  <img src="logo.svg" width="120" alt="Claw Studio" />
  <h1>Claw Studio</h1>
  <p>Visual AI agent builder for <a href="https://github.com/nanoclaw-ai/nanoclaw">nanoclaw</a> — no code required.</p>
</div>

---

Claw Studio lets you design, configure, and deploy personal AI bots using a drag-and-drop canvas. Connect nodes that represent triggers, agents, tools, memory, and outputs. When you're happy with the design, hit **Deploy** and Claw Studio writes the configuration directly to nanoclaw.

---

## What you can build

| | |
|---|---|
| 🌅 **Morning briefings** | Weather, calendar, news, and exchange rates — delivered on a schedule to your phone |
| 💬 **Channel bots** | Bots that respond on Telegram, WhatsApp, Slack, Discord, or email |
| ⏰ **Scheduled automations** | Daily digests, weekly reports, reminders — any cron schedule |
| 🔀 **Multi-agent pipelines** | Chain agents together with routing, conditions, and transforms |
| 🧠 **Bots with memory** | Agents that remember context across conversations |
| 🛠 **Tool-equipped agents** | Web search, shell commands, file access, MCP integrations |
| 📣 **Push notifications** | Trigger phone alerts based on any condition or schedule |
| 🤖 **Agent swarms** | Multiple agents collaborating in a single pipeline |

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

- macOS (Apple Silicon or Intel)
- An [Anthropic API key](https://console.anthropic.com/settings/keys) — get one free at console.anthropic.com

Everything else (Node.js, nanoclaw, Docker or Apple Container) is installed automatically.

---

## Installation

### Option 1 — One-line terminal install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/perweum/claw-studio/main/install.sh | bash
```

This installs nanoclaw and all dependencies, then creates a **Claw Studio** app in `/Applications` with no Gatekeeper warnings — the app is assembled locally on your machine so macOS never quarantines it. Find it in Launchpad or Spotlight when the install finishes.

### Option 2 — macOS App download

[**Download Claw Studio.dmg**](https://github.com/perweum/claw-studio/releases/latest) → open it → drag **Claw Studio** to **Applications**.

Because the app isn't notarized (that requires a $99/year Apple Developer account), macOS will block it on first open. To fix it, open Terminal and run:

```bash
xattr -cr /Applications/"Claw Studio.app"
```

Then double-click normally. You only need to do this once. The DMG also includes a helper file called **"If macOS blocks the app — click here.command"** that does the same thing automatically.

On first launch, the setup wizard will:
1. Confirm your nanoclaw installation (auto-detected in most cases)
2. Ask for your Anthropic API key
3. Offer to create your first bot immediately

### Manual install (for developers)

```bash
git clone https://github.com/perweum/claw-studio.git
cd claw-studio
npm install
npm run dev
```

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

## Built-in Presets

The AI assistant knows how to build these integrations out of the box — just describe what you want in the chat. No extra installs or API keys needed for the ones marked **free**.

<details>
<summary><strong>🌤 Weather &amp; Environment</strong> — yr.no forecasts, air quality, auto-location</summary>

**Weather forecast** (free, no API key — yr.no / MET Norway)

Ask: *"Add a weather tool for Oslo"* or *"Build a morning briefing with today's weather"*

The assistant uses yr.no, the Norwegian Meteorological Institute's free open-data API. Just say the city name — no API key, no sign-up.

**Air quality** works the same way — ask for PM2.5, pollen, or air quality index alongside the weather.

**Auto-location weather** — the assistant can combine IP geolocation with yr.no so the forecast automatically uses the machine's current location without the user setting a city.

</details>

<details>
<summary><strong>📍 IP Geolocation</strong> — detect current city and coordinates automatically</summary>

**Free, no API key** — uses ip-api.com

Ask: *"Detect my location automatically"* or *"Use my current location for the weather"*

Returns city, region, country, latitude, and longitude from the machine's public IP. Most useful as a companion to the weather preset — the bot finds your location and fetches the forecast without any configuration.

</details>

<details>
<summary><strong>📰 RSS &amp; News Feeds</strong> — any blog, podcast, subreddit, YouTube channel</summary>

**Free, no API key**

Ask: *"Add an RSS feed for Hacker News"* or *"Follow this blog: [URL]"*

Works with any RSS or Atom feed. Common sources the assistant knows about:

| Source | How to ask |
|--------|-----------|
| Hacker News | *"Add Hacker News top stories"* |
| Reddit | *"Follow r/MachineLearning"* |
| YouTube channel | *"Add YouTube feed for [channel name]"* |
| Any blog | *"Follow [blog URL]"* — most blogs have /feed or /rss |
| Podcast | Paste the podcast's RSS URL |

</details>

<details>
<summary><strong>📅 Calendar &amp; Scheduling</strong> — Apple Calendar, iCal feeds, public holidays</summary>

**Apple Calendar** (free, macOS only — reads all accounts synced to Calendar.app)

Ask: *"Read my calendar for today"* or *"Add today's meetings to my morning briefing"*

Reads events from all calendars in Calendar.app — iCloud, Google, Outlook, Exchange — without needing any URLs or OAuth. May prompt for Calendars access in System Settings on first use.

---

**iCal feeds** (free — Outlook, Fastmail, Airbnb, any .ics URL)

Ask: *"Add my work calendar"* and paste the iCal/ICS URL

Works with any service that provides an ICS link, including Outlook Web, Fastmail, Apple Calendar sharing, Airbnb reservations, and sports schedules.

---

**Public holidays** (free — date.nager.at)

Ask: *"Skip the morning briefing on public holidays"* or *"Add Norwegian public holidays"*

Supports 100+ countries (NO, SE, DK, US, GB, DE, FR, …). Useful combined with schedule triggers so bots automatically skip running on national holidays.

</details>

<details>
<summary><strong>🍎 macOS Native — Reminders</strong></summary>

**Apple Reminders** (free, macOS only)

Ask: *"Read my reminders"* or *"Create a reminder when the bot finishes"*

Reads incomplete reminders from Reminders.app and can create new ones. Works with iCloud-synced reminders so they appear on iPhone too. May prompt for Reminders access in System Settings on first use.

</details>

<details>
<summary><strong>💱 Finance — Exchange Rates</strong></summary>

**Free, no API key** — open.er-api.com, updates hourly

Ask: *"Add today's exchange rates to my briefing"* or *"Show USD, EUR, and NOK rates"*

Supports all major currencies. The user can set any base currency (USD, EUR, NOK, etc.).

</details>

<details>
<summary><strong>🔔 Push Notifications — ntfy.sh</strong></summary>

**Free for basic use** — ntfy.sh, no account needed

Ask: *"Send me a push notification when the bot runs"*

The bot sends alerts to the user's phone via the free ntfy app (iOS + Android). The user picks a topic name and subscribes in the app — no account or API key required for basic use. Self-hostable for privacy.

</details>

<details>
<summary><strong>📧 Gmail &amp; Google Calendar</strong> — OAuth, skill required</summary>

Gmail and Google Calendar are available via the `/add-gmail` skill in nanoclaw. Once installed, the assistant can read emails, send replies, draft messages, and read calendar events.

Ask in the chat: *"Set up Gmail"* — the assistant will walk through the setup.

OAuth is handled automatically — no API key is ever stored in the node config.

</details>

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
