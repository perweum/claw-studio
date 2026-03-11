<div align="center">
  <img src="logo.svg" width="120" alt="Claw Studio" />
  <h1>Claw Studio</h1>
  <p>Visual AI agent builder for <a href="https://github.com/qwibitai/nanoclaw">nanoclaw</a> — no code required.</p>
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
- **Guided option prompts** — the assistant presents clickable choices when it needs your input, so you never have to guess what to type
- **11 node types** — Trigger, Agent, Tool (Bash + MCP), Memory, Transform, Condition, Router, Output, File, Comment, Bot Container
- **Bot swarms (swimlanes)** — add a **Bot Container** to your canvas to define sub-bots; deploy writes a separate `CLAUDE.md` and registers each container as its own bot, all from one blueprint
- **Auto-wired handoffs** — draw an edge from an Output node to a Bot Container and the Output automatically switches to "Pass to another bot" with the correct target set; deleting the edge reverts it
- **Swarm hierarchy in bot picker** — bots that contain sub-bots show a ▸ expand toggle in the picker; sub-bots are indented beneath their parent
- **Reconnectable edges** — hover any edge to reveal its endpoints; drag an endpoint to move the connection, or drop it on the canvas to delete it
- **Connection rules** — Bot Containers only accept connections from Output nodes; other connection types are blocked at the canvas level
- **Pass to another bot** — Output node supports "Pass to another bot" as a destination, generating handoff instructions so the primary bot automatically triggers a sub-bot when it finishes
- **Bot settings** — configure file mounts per bot from the `···` menu in the bot picker, giving bots read or read/write access to folders on your machine
- **Fail-fast guardrails** — every deployed bot gets built-in guardrails in its `CLAUDE.md`: send an early acknowledgement, fail fast instead of looping, cap retries
- **Multi-trigger nodes** — one trigger node can combine a schedule *and* a message trigger (e.g. "run every morning, but also on demand")
- **Channel-aware AI** — the assistant reads your connected channels and automatically suggests the right output destination
- **Run now button** — trigger any scheduled bot immediately, without waiting for its next cron tick
- **Undo/redo** — 50-step canvas history via Cmd+Z / Cmd+Shift+Z or the toolbar buttons
- **Crash-safe drafts** — unsaved canvas changes are auto-saved to localStorage every second and restored if you close or refresh without saving; chat history survives a refresh within the same tab session
- **Starter templates** — open a ready-made blueprint (morning briefing, PR reviewer, price checker) from the New bot flow to get started in seconds
- **Free weather built-in** — yr.no weather and air quality presets, no API key needed
- **MCP service picker** — built-in presets for Gmail, Google Calendar, iCal, News, and more
- **Schedule presets** — pick from common schedules ("Every day at 8am") without writing cron expressions
- **OAuth-aware** — nodes for Gmail and Google Calendar never ask for an API key; Claw Studio detects your existing credentials automatically
- **Configuration warnings** — amber `!` badges highlight nodes that still need setup before deploying
- **Deploy actions** — Deploy shows exactly what was applied automatically vs. what needs manual steps
- **One-click backup** — back up all your bots via the `⋯` menu in the toolbar
- **Setup wizard** — first-run wizard detects your nanoclaw installation and walks through API key setup
- **GitHub integration** — agents can list PRs, post reviews, check CI, and create issues via the `gh` CLI (install with `/add-github`)

---

## Requirements

- macOS (Apple Silicon or Intel) **or** Linux (Ubuntu 22.04+, Debian, Fedora, and compatible)
- An [Anthropic API key](https://console.anthropic.com/settings/keys) — get one at console.anthropic.com
  > **Note:** A credit card is required to activate your Anthropic account. Add one at [console.anthropic.com/settings/billing](https://console.anthropic.com/settings/billing) before generating a key. Usage is pay-as-you-go.

Everything else (Node.js, nanoclaw, Docker or Apple Container) is installed automatically.

---

## Installation

### Option 1 — One-line terminal install (recommended)

**macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/perweum/claw-studio/main/install.sh | bash
```

This installs nanoclaw and all dependencies, then creates a **Claw Studio** app in `/Applications` with no Gatekeeper warnings — the app is assembled locally on your machine so macOS never quarantines it. Find it in Launchpad or Spotlight when the install finishes.

**Linux (Ubuntu/Debian/Fedora):**
```bash
curl -fsSL https://raw.githubusercontent.com/perweum/claw-studio/main/install.sh | bash
```

The same script detects Linux and uses `apt` or `dnf` to install Node.js 20 LTS and Docker Engine. nanoclaw is registered as a `systemd` user service that starts on login. When done, start Claw Studio with:

```bash
cd ~/claw-studio && npm run dev
```

Then open [http://localhost:5275](http://localhost:5275) in your browser.

### Option 2 — macOS App download

[**Download Claw Studio.dmg**](https://github.com/perweum/claw-studio/releases/latest) → open it → drag **Claw Studio** to **Applications**.

Because the app isn't notarized (that requires a $99/year Apple Developer account), macOS will block it on first open. To fix it, open Terminal and run:

```bash
xattr -cr /Applications/"Claw Studio.app"
```

Then double-click normally. You only need to do this once. The DMG also includes a helper file called **"If macOS blocks the app — click here.command"** that does the same thing automatically.

On first launch, the setup wizard will:
1. Confirm your nanoclaw installation (auto-detected in most cases)
2. Ask for your Anthropic API key (and remind you that a credit card is required to activate your account)
3. Offer to create your first bot immediately

### Updating

Re-run the install script. It will pull the latest code, update dependencies, and leave your bots and settings untouched:

```bash
curl -fsSL https://raw.githubusercontent.com/perweum/claw-studio/main/install.sh | bash
```

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

**Canvas keyboard shortcuts:**

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` | Redo |
| `Cmd/Ctrl+S` | Save |
| `Cmd/Ctrl+K` | Open command palette |
| `Delete` | Delete selected node |
| `Escape` | Close palette / picker |

**Node types:**

| Node | What it does |
|------|-------------|
| **Trigger** | Starts the pipeline — schedule (cron), message, or manual. One trigger node can have multiple trigger conditions. |
| **Agent** | A Claude agent with a system prompt and optional tools |
| **Tool** | Gives an agent capabilities — Bash scripts or MCP services |
| **Memory** | Reads from or writes to the group's persistent memory |
| **Transform** | Formats, truncates, or extracts data |
| **Condition** | Branches the pipeline based on a true/false check |
| **Router** | Sends output to different paths based on content |
| **Output** | Sends a message, saves to a file, POSTs to a webhook, or **passes to another bot** |
| **File** | Reads or writes a file in the group's workspace |
| **Comment** | Adds a note to the canvas (not deployed) |
| **Bot Container** | Groups nodes into a separate bot pipeline — deploy generates a `CLAUDE.md` for each container |

> **How logic nodes work:** Condition, Router, Transform, Memory, and File nodes add instructions to your agent's system prompt — they're not runtime middleware that automatically intercepts output. The agent reads all instructions and decides how to apply them when it runs.

### Multi-trigger bots

A single Trigger node can combine multiple trigger types. For example, a bot that checks prices every morning but also responds when you message it manually:

1. Set the primary trigger to **On a schedule** with your cron expression
2. Click **+ Add another trigger** and choose **When a message is received**

This is the recommended approach — do not create two separate Trigger nodes.

### Bot swarms (multi-bot pipelines)

Use **Bot Container** nodes to build pipelines where multiple independent bots collaborate.

**How it works:**
1. Click **+ Bot** in the toolbar to add a Bot Container to the canvas
2. Rename the container in the settings panel on the right (e.g. "Code Reviewer") — the folder name is generated automatically
3. Drag Agent, Tool, Trigger, and Output nodes **inside** the container — they belong to that bot
4. Nodes **outside** all containers belong to the primary bot (your current blueprint)
5. Click **⬆ Deploy** — Claw Studio writes a `CLAUDE.md` for each container and registers each as its own bot in nanoclaw

To **pass results from one bot to another**, draw an edge from an Output node (bottom handle) to a Bot Container. The Output automatically switches to "Pass to another bot" mode with the correct target set — no manual configuration needed. Deleting the edge reverts the Output back to its previous destination.

The **bot picker** reflects the swarm hierarchy: parent bots that contain sub-bots show a ▸ toggle. Click it to expand and see the sub-bots listed beneath their parent.

> **Important:** Only the main channel bot can hand off to other bots. Sub-bots (in containers) can pass back to the coordinator but not to arbitrary third bots. This is a nanoclaw constraint, explained in the Output node's settings panel.

### Bot settings (file access)

To give a bot access to folders on your machine:

1. Click the bot name button in the toolbar to open the bot picker
2. Click the **···** button on the bot you want to configure
3. Choose **Bot settings**
4. Under **File access**, click **+ Add folder**
5. Enter the host path (e.g. `/Users/per/my-project`) — the name inside the bot auto-fills
6. Choose **Read only** or **Read and write**
7. Click **Save settings**

Changes take effect the next time the bot runs.

### Using the AI assistant

Type in the chat panel on the left. The assistant builds your pipeline from a plain-English description and asks clarifying questions with clickable option buttons when it needs your input. Examples:

> "Add a morning briefing that runs at 7am, reads my Gmail and calendar, and sends a summary to Telegram"

> "Add a weather tool that checks Oslo and posts the forecast"

> "Make the agent more concise"

The assistant is aware of your connected channels — if you say "send to Slack" and Slack is set up, it will use Slack. If not, it will tell you and suggest an alternative.

### Deploying

Click **⬆ Deploy** in the toolbar. Claw Studio will:
- Write the agent's `CLAUDE.md` instructions to the nanoclaw group
- Register any schedule triggers in nanoclaw's database
- Show a summary of what was done automatically and what still needs manual setup (e.g. API keys, channel registration)

### Running a bot immediately

Click **▶ Run now** in the toolbar to trigger the bot's scheduled task right away, without waiting for the next cron tick. Useful for testing after deploying. A confirmation message appears for a few seconds showing how many tasks were triggered and where the results will be sent.

> Run now only works for bots with schedule triggers that have been deployed. If the button shows an error, make sure you've clicked Deploy first.

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

<details>
<summary><strong>🐙 GitHub</strong> — PR reviews, issues, CI status, skill required</summary>

GitHub integration is available via the `/add-github` skill. Once installed, agents can:
- List open pull requests
- Read PR diffs and post review comments
- Check CI status
- Create and comment on issues

Ask in the chat: *"Set up GitHub"* — the assistant will walk through generating a Personal Access Token and installing the `gh` CLI into the agent container.

</details>

---

## Project Structure

```
claw-studio/
├── chat-plugin.ts        # Vite dev-server plugin — API routes + Claude integration
├── vite.config.ts        # Vite config, loads the plugin
├── install.sh            # One-line installer for macOS and Linux
├── src/
│   ├── App.tsx           # Root component, layout, keyboard shortcuts
│   ├── store.ts          # Zustand state — nodes, edges, group, deploy
│   ├── types.ts          # Node data types and metadata
│   ├── schema.ts         # Zod schema for blueprint validation
│   ├── components/
│   │   ├── ChatPanel.tsx       # AI assistant sidebar (left)
│   │   ├── NodePanel.tsx       # Node settings panel (right, opens on selection)
│   │   ├── Toolbar.tsx         # Top bar — bots, deploy, run now, palette, backup
│   │   ├── StatusPanel.tsx     # Live system status — all bots, next/last run, Run Now
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
│       ├── SwimlaneNode.tsx
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
| `GET /api/groups/channels` | List registered channels (Telegram, Slack, etc.) |
| `GET /api/groups/:folder/blueprint` | Load a group's visual blueprint |
| `PUT /api/groups/:folder/blueprint` | Save a group's visual blueprint |
| `POST /api/groups/:folder/deploy` | Generate CLAUDE.md + register schedules |
| `POST /api/groups/:folder/run` | Trigger scheduled tasks immediately (Run now) |
| `GET /api/groups/:folder/runs` | Get recent run history and last run status |
| `GET /api/status` | Live status for all bots — next run, last run, warnings |
| `GET /api/groups/:folder/settings` | Get bot settings (additional file mounts) |
| `PUT /api/groups/:folder/settings` | Update bot settings (merges with existing container config) |
| `POST /api/groups/:folder/register` | Register a group with a channel JID |
| `POST /api/chat` | Run the AI assistant (agentic loop with tools) |
| `GET /api/templates` | List starter blueprint templates |
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

### Does it run on Linux?

Yes. The installer (`install.sh`) supports Ubuntu 22.04+, Debian, and Fedora. It installs Node.js 20, Docker Engine, and registers nanoclaw as a systemd user service. There is no macOS `.app` on Linux — start Claw Studio from the terminal with `npm run dev` and open [http://localhost:5275](http://localhost:5275).

### How do I move my bots to a new computer?

Use the **⋯ → Back up all bots** option in the toolbar. This downloads a zip containing everything nanoclaw needs: your bots, their memory, conversation history, API keys, and channel credentials.

On the new machine:
1. Install nanoclaw and run `npm install && ./container/build.sh`
2. Extract the backup zip into your nanoclaw folder
3. Clone Claw Studio and run `npm install && npm run dev`

Everything picks up exactly where it left off.

### How much does it cost to run?

The AI assistant in Claw Studio uses Claude via the Anthropic API, which is pay-as-you-go. **You need to add a credit card** at [console.anthropic.com/settings/billing](https://console.anthropic.com/settings/billing) to activate your account — this is an Anthropic requirement, not Claw Studio's.

Designing bots (chatting with the assistant) typically costs a few cents per session. Running bots depends on how often they trigger — a daily briefing bot costs roughly $0.01–0.05 per day.

You can monitor usage at [console.anthropic.com](https://console.anthropic.com).

### Can I use Claw Studio without nanoclaw?

No — Claw Studio is a visual editor for nanoclaw configurations. It needs nanoclaw running to save blueprints, register schedules, and deploy bots. [Install nanoclaw here](https://github.com/qwibitai/nanoclaw).

### How do I add a Telegram / WhatsApp / Slack channel?

Open the **+ New bot** modal and click one of the channel buttons (Telegram, WhatsApp, Slack, Discord). The AI assistant will walk you through the setup — no terminal needed.

### What happens to my bots when I update Claw Studio?

Your bots and their data live in nanoclaw, not in Claw Studio. Updating Claw Studio (pulling the latest git version) only changes the editor. Your bots continue running unaffected.

### I deployed a bot but nothing happened

Deploying writes a `CLAUDE.md` file to the group and registers any schedules. Check:
1. nanoclaw is running (`launchctl list | grep nanoclaw` on macOS, `systemctl --user status nanoclaw` on Linux)
2. The group has a channel connected (visible in the **My bots** list)
3. The deploy summary didn't show any red "needs attention" items
4. Use **▶ Run now** to trigger the bot immediately and confirm it sends output before relying on the schedule

### My bot runs on a schedule — can I trigger it manually?

Yes — click **▶ Run now** in the toolbar. This sets the task's next run time to now so the scheduler picks it up within seconds. Results arrive via the bot's connected output channel (Telegram, file, etc.).

### Why did the AI assistant suggest Telegram when I wanted Slack?

The assistant reads your connected channels from nanoclaw and should suggest the right one. If it still defaults to Telegram, it likely means Slack isn't set up yet in nanoclaw. Ask the assistant: *"Set up Slack"* — it will walk you through connecting it.

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
- The AI chat uses an agentic loop (up to 40 turns) with three tools: `run_command`, `read_file`, `write_env_key`

```bash
npm install && npm run dev   # develop
npm run build                # type-check + bundle
```

Please open an issue before starting large changes so we can discuss the approach.

---

## License

MIT
