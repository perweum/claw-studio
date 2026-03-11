/**
 * Vite dev-server plugin that adds:
 *   POST /api/chat         — AI canvas assistant
 *   GET  /api/config       — check if API key is configured
 *   POST /api/config       — save API key to .env
 *   GET  /api/groups       — list nanoclaw group folders
 *   GET  /api/groups/:f/blueprint   — read blueprint.json
 *   PUT  /api/groups/:f/blueprint   — write blueprint.json
 *   GET  /api/groups/:f/claude-md   — read CLAUDE.md
 *   PUT  /api/groups/:f/claude-md   — write CLAUDE.md
 *   POST /api/groups/:f/deploy      — generate CLAUDE.md + register schedules
 *
 * Runs in Node.js — never bundled into the browser build.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { execSync, spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import type { Plugin } from 'vite';

// Load better-sqlite3 from nanoclaw's node_modules (not bundled in Claw Studio)
const _require = createRequire(import.meta.url);

// Cached Database constructor — loaded once on first use
let _Database: (new (path: string, opts?: object) => unknown) | null = null;
function getDatabase(nanoclawPath: string) {
  if (!_Database) {
    _Database = _require(path.join(nanoclawPath, 'node_modules', 'better-sqlite3')) as new (path: string, opts?: object) => unknown;
  }
  return _Database!;
}

// ── Nanoclaw path detection ────────────────────────────────────────────────────
// Claw Studio can live anywhere — we find nanoclaw by:
//   1. NANOCLAW_PATH env var
//   2. NANOCLAW_PATH in Claw Studio's own .env
//   3. Auto-detection: walk up from CWD looking for nanoclaw markers

const LOCAL_ENV_PATH = path.resolve(process.cwd(), '.env');

function readLocalEnvValue(key: string): string | undefined {
  try {
    const content = fs.readFileSync(LOCAL_ENV_PATH, 'utf-8');
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined;
  } catch { return undefined; }
}

function writeLocalEnvValue(key: string, value: string): void {
  let content = '';
  try { content = fs.readFileSync(LOCAL_ENV_PATH, 'utf-8'); } catch { /* new file */ }
  const escaped = value.replace(/\n/g, '\\n');
  const lineRegex = new RegExp(`^${key}=.*$`, 'm');
  if (lineRegex.test(content)) {
    content = content.replace(lineRegex, `${key}=${escaped}`);
  } else {
    content = content.trimEnd() + (content ? '\n' : '') + `${key}=${escaped}\n`;
  }
  fs.writeFileSync(LOCAL_ENV_PATH, content, 'utf-8');
}

function isNanoclawDir(dir: string): boolean {
  // A nanoclaw install has a groups/ folder and either store/ or src/index.ts
  return fs.existsSync(path.join(dir, 'groups')) &&
    (fs.existsSync(path.join(dir, 'store')) || fs.existsSync(path.join(dir, 'src', 'index.ts')));
}

let _nanoclawPathCache: string | null | undefined = undefined;

function detectNanoclawPath(): string | null {
  if (_nanoclawPathCache !== undefined) return _nanoclawPathCache;
  if (process.env.NANOCLAW_PATH) { _nanoclawPathCache = process.env.NANOCLAW_PATH; return _nanoclawPathCache; }
  const saved = readLocalEnvValue('NANOCLAW_PATH');
  if (saved && fs.existsSync(saved) && isNanoclawDir(saved)) { _nanoclawPathCache = saved; return _nanoclawPathCache; }
  // Walk up from CWD (handles the case where Claw Studio is inside nanoclaw/Projects/)
  let dir = path.dirname(process.cwd());
  for (let i = 0; i < 5; i++) {
    if (isNanoclawDir(dir)) { _nanoclawPathCache = dir; return _nanoclawPathCache; }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Well-known default location — covers standalone install alongside ~/nanoclaw
  const defaultPath = path.join(process.env.HOME ?? '', 'nanoclaw');
  if (isNanoclawDir(defaultPath)) { _nanoclawPathCache = defaultPath; return _nanoclawPathCache; }
  _nanoclawPathCache = null;
  return null;
}

function invalidateNanoclawPathCache(): void {
  _nanoclawPathCache = undefined;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function readEnvValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const nanoclawPath = detectNanoclawPath();
  if (!nanoclawPath) return undefined;
  try {
    const content = fs.readFileSync(path.join(nanoclawPath, '.env'), 'utf-8');
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined;
  } catch {
    return undefined;
  }
}

function makeClient(): Anthropic {
  const apiKey = readEnvValue('ANTHROPIC_API_KEY');
  const oauthToken = readEnvValue('CLAUDE_CODE_OAUTH_TOKEN');
  if (apiKey) return new Anthropic({ apiKey });
  if (oauthToken) return new Anthropic({ authToken: oauthToken });
  throw new Error(
    'No Anthropic credentials found. Add ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN to nanoclaw/.env',
  );
}

// ── Security guardrails ────────────────────────────────────────────────────────

// These patterns are ALWAYS blocked — cannot be overridden by user confirmation.
const ALWAYS_BLOCKED: Array<[RegExp, string]> = [
  [/\bsudo\b/, 'privilege escalation not allowed'],
  [/curl\s+.*\|\s*(bash|sh|zsh)/i, 'piped script execution not allowed'],
  [/\bdd\s+if=/, 'disk write operations not allowed'],
  [/\bmkfs\b/, 'filesystem formatting not allowed'],
  [/>\s*\/(?!(Users|home|tmp|var\/folders))/, 'redirect to system path not allowed'],
];

// These patterns require explicit user confirmation before running.
const NEEDS_CONFIRM_PATTERNS: RegExp[] = [
  /\brm\b/,
  /\brmdir\b/,
  /git\s+reset\s+--hard/,
  /git\s+clean\s+-f/,
  /launchctl\s+kickstart/,
  /systemctl\s+.*restart/,
];

// Fragments that mark a value as secret — stripped from .env before sending to Claude.
const SECRET_KEY_FRAGMENTS = ['_TOKEN', '_SECRET', '_PASSWORD', 'API_KEY', 'OAUTH'];

function getBlockReason(cmd: string): string | null {
  for (const [pattern, reason] of ALWAYS_BLOCKED) {
    if (pattern.test(cmd)) return reason;
  }
  return null;
}

function needsConfirmation(cmd: string): boolean {
  return NEEDS_CONFIRM_PATTERNS.some((p) => p.test(cmd));
}

function executeCommand(cmd: string, nanoclawPath: string): Promise<{ output: string; ok: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', cmd], {
      cwd: nanoclawPath,
      env: { ...process.env, HOME: process.env.HOME ?? '' },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill(); resolve({ output: 'Command timed out after 60s', ok: false }); }, 60_000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      const out = stdout.slice(0, 512 * 1024).trim();
      const err = stderr.slice(0, 512 * 1024).trim();
      resolve(code === 0
        ? { output: out || '(no output)', ok: true }
        : { output: [out, err].filter(Boolean).join('\n') || `Exit code ${code}`, ok: false });
    });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ output: err.message, ok: false }); });
  });
}

function readFileSecure(relativePath: string, nanoclawPath: string): string {
  const resolved = path.resolve(nanoclawPath, relativePath);
  const safeRoot = path.resolve(nanoclawPath) + path.sep;
  if (resolved !== path.resolve(nanoclawPath) && !resolved.startsWith(safeRoot)) {
    return 'ERROR: Path outside nanoclaw directory is not allowed';
  }
  try {
    let content = fs.readFileSync(resolved, 'utf-8');
    if (path.basename(resolved) === '.env') {
      content = content.split('\n').map((line) => {
        const eq = line.indexOf('=');
        if (eq === -1) return line;
        const key = line.slice(0, eq);
        if (SECRET_KEY_FRAGMENTS.some((f) => key.includes(f))) return `${key}=[hidden]`;
        return line;
      }).join('\n');
    }
    if (content.length > 8000) {
      return content.slice(0, 8000) + '\n\n[... file truncated at 8000 characters ...]';
    }
    return content;
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function writeEnvKey(key: string, value: string, nanoclawPath: string): string {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return 'ERROR: Invalid env key format';
  try {
    const envPath = path.join(nanoclawPath, '.env');
    let content = '';
    try { content = fs.readFileSync(envPath, 'utf-8'); } catch { /* new */ }
    const escaped = value.replace(/\n/g, '\\n');
    const re = new RegExp(`^${key}=.*$`, 'm');
    content = re.test(content)
      ? content.replace(re, `${key}=${escaped}`)
      : content.trimEnd() + (content ? '\n' : '') + `${key}=${escaped}\n`;
    fs.writeFileSync(envPath, content, 'utf-8');
    return `Set ${key} in .env`;
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM = `You are an AI assistant embedded in Claw Studio — a visual node-based editor for designing AI agent pipelines. Your audience is primarily non-technical users who want to automate tasks with AI but don't write code.

## Node Types

**trigger** — When does the pipeline run?
- label, triggerType (message | schedule | webhook | manual), config, additionalTriggers (optional array)
- schedule config: cron expression like "0 8 * * 1-5" (weekdays at 8am)
- message config: keyword filter (leave blank to respond to all messages)
- additionalTriggers: array of {triggerType, config} for bots that run on MULTIPLE conditions
  - Use when the user wants a bot that BOTH runs on a schedule AND responds to messages
  - Example: daily price check that also runs on demand → schedule primary + message additional
  - Do NOT create two separate trigger nodes for this — use one trigger node with additionalTriggers

**agent** — The AI brain that thinks and decides
- label, model (claude-opus-4-6 | claude-sonnet-4-6 | claude-haiku-4-5-20251001), systemPrompt
- Model cost guidance (this matters — scheduled bots run every day):
  - **Haiku**: ~20x cheaper than Opus. Use for ANY scheduled bot that does simple work: price checks, email digests, weather, news, reminders. DEFAULT choice for scheduled tasks.
  - **Sonnet**: Use for bots that write code, analyse complex content, or need nuanced judgment. Good default for message-triggered bots.
  - **Opus**: Most expensive. Only for genuinely complex one-off reasoning. Never for scheduled bots.
- Write detailed, specific system prompts — they define the agent's personality and behavior
- One pipeline can have multiple agents; extras become sub-agents the primary can delegate to

**tool** — Connects the agent to the outside world (a tool node gives capabilities to ALL agents in the pipeline)
- label, toolType (bash | search | mcp), config
- bash: a shell command the agent can run; config is the shell script/command
  - The agent can call this tool as many times as needed during a run
  - Example: curl https://api.example.com/data | python3 -c "import sys,json; print(json.load(sys.stdin)['price'])"
- search: web search capability, no config needed — the agent searches the web autonomously
- mcp: a plugin that connects to an external service (Gmail, Calendar, Weather, etc.)
  - MCP config format: {"server": "server-name", "action": "action.name"}
  - Common servers: gmail-mcp, google-calendar-mcp, openweathermap-mcp, newsapi-mcp
- A pipeline can have multiple tool nodes — add one per capability

**condition** — Branch the pipeline based on a simple text rule (no AI, instant decision)
- label, conditionType (contains | regex | equals | always_true), value
- Has two output handles: "true" (condition matched) and "false" (condition did not match)
- conditionType meanings:
  - contains: input text includes the value string (case-insensitive)
  - regex: input text matches the regex pattern (e.g. /^urgent/i)
  - equals: input text exactly matches the value
  - always_true: always takes the "true" branch (useful as a pass-through connector)
- value MUST be set for contains/regex/equals — leave empty only for always_true
- Use condition for cheap yes/no decisions; use router when the AI needs to interpret context

**router** — Let the AI decide which branch to take based on meaning
- label, routingPrompt, branches (array of branch names — minimum 2)
- Branch handles: "branch-0", "branch-1", etc. (connect each to the appropriate next node)
- routingPrompt: tell the AI exactly when to choose each branch — be specific
  - Good: "Route to 'Urgent' if the message mentions a deadline today or uses words like 'ASAP' or 'critical'. Otherwise route to 'Normal'."
  - Bad: "Route appropriately."
- branches: each string becomes a labeled output handle, e.g. ["Urgent", "Normal", "Spam"]

**transform** — Reshape or reformat text without using AI
- label, transformType (template | truncate | json_wrap | extract), config
- transform types:
  - template: fill a fixed template with input data; use {{input}} as the placeholder; config is the template text
  - truncate: cut input to a max character count; config is the number (e.g. "2000")
  - json_wrap: wrap the input string in a JSON object {"result": "..."}; no config needed
  - extract: pull out a specific piece of text from the input using a regex; config is the regex pattern
- Transforms run instantly, cost nothing, and don't use Claude — prefer them over agents for simple formatting

**memory** — Read or write persistent data that survives between bot runs
- label, operation (read | write | both), scope (group | global), key (optional)
- operation:
  - read: load stored data into the pipeline so the next agent can see it
  - write: save the pipeline's current result to memory for future runs
  - both: read first (pass to agent), then write the agent's output back (useful for running summaries)
- scope:
  - group: memory is private to this bot — different bots can't see it
  - global: memory is shared across ALL bots — useful for shared context like user preferences
- key: a name for what's stored (e.g. "price_history", "last_run_result"); leave blank to use the whole memory file
- Memory persists indefinitely until overwritten; always pair a "write" memory with a "read" memory on the next run

**file** — Give the agent access to files in its isolated workspace
- label, path, permissions (read | readwrite)
- path: must start with /workspace — the agent's sandboxed filesystem (e.g. /workspace/data, /workspace/reports)
- permissions: "read" = agent can only read the file; "readwrite" = agent can read and modify/create files
- Files at /workspace persist between runs of the same bot; deleted when the bot is removed
- Use file nodes when the agent needs to read a config file, write a report, or maintain a local database

**output** — Send the pipeline result somewhere
- label, destination (telegram | file | webhook | agent_handoff), config
- telegram: sends the result as a Telegram message to the registered chat; no config needed
- file: saves the result to a file; config is the file path (e.g. /workspace/report.md)
- webhook: POSTs the result to a URL; config is the full URL (e.g. https://hooks.zapier.com/...)
- agent_handoff: passes the result to another bot; set targetFolder (the bot's folder name) and optionally handoffMessage (use {{input}} as placeholder for the output). Use this to chain bots together — e.g. coordinator → coder → reviewer pipelines.
- Always include an output node — without one the bot runs silently with no visible result
- Telegram output requires the bot to be registered with a Telegram channel in nanoclaw

**comment** — A sticky note on the canvas (never deployed, never affects the pipeline)
- text, color (hex string, e.g. "#4b5563" for grey, "#3b82f6" for blue, "#10b981" for green)
- Use comments to label sections of a complex pipeline or leave notes for yourself

## Wires

Most nodes: one input (top), one output (bottom).
- condition: outputs "true" and "false"
- router: outputs "branch-0", "branch-1", etc.
- trigger: output only

## Layout Guidelines

- Start first node at x=200, y=80
- Space nodes ~220px vertically for sequential flow
- For branches: offset each branch ~300px horizontally

## Your Role

Build pipelines that work. Write detailed, specific system prompts. When a pipeline uses external services (email, calendar, weather, news), always tell the user exactly what they need to set up.

## CRITICAL: Non-Coder Friendly Messages

Your "message" field must ALWAYS include:

1. A plain-English description of what the pipeline does and how data flows through it
2. A "📋 Setup Checklist" — numbered steps for EVERY external service or credential needed
   - Be specific: name the exact service, where to get the credential, what to name the variable
   - Reference the node by name so the user knows where to click
   - Explain MCP as "a plugin that lets the bot connect to [service]"
3. A note telling users to "click any node to see its settings in the right-hand panel"

## Setup Checklist Format

Use this format in your message (plain text, no markdown):

"Here's what I built: [plain description of the flow].

📋 Setup Checklist — click each node on the canvas, then look at the right panel to fill in the details:

1. [Node Name] — [what it does, what service it connects to]
   • What you need: [specific credential or action, e.g. "A free API key from openweathermap.org/api"]
   • Where to put it: [exact field in the right panel, e.g. "Replace YOUR_API_KEY in the Config field"]

2. [Next node] ...

Once all steps are done, save this blueprint and your bot is ready."

## MCP Tool Config Guidelines

## Built-in Data Presets (bash tools, no API key needed)

All of these use bash tool nodes. Never use MCP for these — just curl or osascript.

---

**Weather & Air Quality — yr.no / MET Norway**
Use a **bash tool** for weather. yr.no is free, CC BY 4.0, no API key needed.

Weather forecast (city name):
~~~
CITY="Oslo, Norway"
COORDS=$(curl -s -A "nanoclaw/1.0" "https://nominatim.openstreetmap.org/search?q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$CITY'))")&format=json&limit=1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['lat'], d[0]['lon'])")
LAT=$(echo $COORDS | awk '{print $1}'); LON=$(echo $COORDS | awk '{print $2}')
curl -s -A "nanoclaw/1.0" "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=$LAT&lon=$LON"
~~~

Air quality: same pattern, endpoint https://api.met.no/weatherapi/airqualityforecast/0.1/?lat=$LAT&lon=$LON

When a user asks for weather or air quality, ALWAYS use yr.no. Do NOT suggest OpenWeatherMap unless asked.

---

**IP Geolocation — auto-detect location (no API key)**
Use this to get the user's current city and coordinates automatically — useful to make weather dynamic without the user having to set a city name.
~~~
curl -s "http://ip-api.com/json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'City: {d[\"city\"]}, {d[\"regionName\"]}, {d[\"country\"]}')
print(f'Lat: {d[\"lat\"]}')
print(f'Lon: {d[\"lon\"]}')
print(f'IP: {d[\"query\"]}')
"
~~~

Combine with yr.no for a fully automatic weather forecast with no configuration:
~~~
LOCATION=$(curl -s "http://ip-api.com/json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['lat'], d['lon'])")
LAT=$(echo $LOCATION | awk '{print $1}'); LON=$(echo $LOCATION | awk '{print $2}')
curl -s -A "nanoclaw/1.0" "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=$LAT&lon=$LON"
~~~

---

**RSS / Atom Feeds — any blog, podcast, news site, subreddit, YouTube channel**
~~~
FEED_URL="https://hnrss.org/frontpage"
curl -s "$FEED_URL" | python3 -c "
import sys, xml.etree.ElementTree as ET
root = ET.fromstring(sys.stdin.read())
items = root.findall('.//item')[:10]
for item in items:
    title = item.findtext('title','').strip()
    link = item.findtext('link','').strip()
    print(f'- {title}\n  {link}')
"
~~~
The user can change FEED_URL to any RSS/Atom feed. Common examples:
- Hacker News: https://hnrss.org/frontpage
- Reddit: https://www.reddit.com/r/SUBREDDIT/.rss
- YouTube channel: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
- Any blog with /feed or /rss in the URL

---

**Public Holidays — skip briefings on holidays**
~~~
COUNTRY="NO"
YEAR=$(date +%Y)
curl -s "https://date.nager.at/api/v3/PublicHolidays/$YEAR/$COUNTRY" | python3 -c "
import sys, json, datetime
holidays = json.load(sys.stdin)
today = datetime.date.today().isoformat()
for h in holidays:
    print(f'{h[\"date\"]}: {h[\"localName\"]}')
    if h['date'] == today:
        print('TODAY IS A PUBLIC HOLIDAY')
"
~~~
Country codes: NO, SE, DK, US, GB, DE, FR, etc. Useful combined with schedule triggers to skip running on holidays.

---

**Exchange Rates — currency conversion (no API key)**
~~~
BASE="USD"
curl -s "https://open.er-api.com/v6/latest/$BASE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
rates = data['rates']
for currency in ['EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'JPY', 'CHF', 'USD']:
    if currency in rates:
        print(f'{currency}: {rates[currency]:.4f}')
"
~~~
Free tier, no API key, updates hourly. User can change BASE to any currency code.

---

**Push Notifications — ntfy.sh (no API key for basic use)**
Use a bash output tool to send push notifications to the user's phone. The user subscribes to their topic in the ntfy app (iOS/Android, free).
~~~
TOPIC="my-nanoclaw-alerts"
MESSAGE="Your alert message here"
curl -s -d "$MESSAGE" https://ntfy.sh/$TOPIC
~~~
Tell the user to pick a unique topic name and install the ntfy app, then subscribe to ntfy.sh/TOPIC. No account needed for basic use.

---

**Apple Calendar — read macOS Calendar.app events (no API key, macOS only)**
Use osascript to read the user's local Apple Calendar. Works with all calendar accounts synced to Calendar.app (iCloud, Google, Exchange, etc.) without needing any URLs or OAuth.
~~~
osascript << 'APPLESCRIPT'
tell application "Calendar"
  set today to current date
  set midnight to today - (time of today)
  set tomorrow to midnight + (24 * 60 * 60)
  set result to {}
  repeat with c in calendars
    set evts to (every event of c whose start date >= midnight and start date < tomorrow)
    repeat with e in evts
      set end of result to ((summary of e) & " at " & ((start date of e) as string))
    end repeat
  end repeat
  return result
end tell
APPLESCRIPT
~~~
Tell the user they may need to grant Calendar access in System Settings → Privacy & Security → Calendars. To get events for a different day, adjust midnight and tomorrow.

---

**Apple Reminders — read and create reminders (no API key, macOS only)**
~~~
# List incomplete reminders
osascript -e 'tell application "Reminders" to get name of every reminder whose completed is false'
~~~
~~~
# Create a reminder (change the name and due date as needed)
osascript -e 'tell application "Reminders" to make new reminder with properties {name:"Task from bot", due date:current date + 3600}'
~~~
May require Reminders access in System Settings → Privacy & Security → Reminders.

## MCP Tool Config Guidelines

For MCP tools, config should look like:
- Gmail: {"server": "gmail-mcp", "action": "list_emails", "query": "is:unread newer_than:1d"}
- Google Calendar: {"server": "google-calendar-mcp", "action": "list_events", "timeframe": "today"}
- iCal calendar (Outlook, Apple, Fastmail, etc.): {"server": "ical-calendar", "url": "https://...", "calendarName": "Work"}
- News: {"server": "newsapi-mcp", "action": "top_headlines", "category": "general", "apiKey": "YOUR_API_KEY"}

IMPORTANT: Gmail and Google Calendar use OAuth — they NEVER need an API key in the config. Do NOT add apiKey, YOUR_API_KEY or any credential placeholder to gmail-mcp or google-calendar-mcp configs. OAuth is handled automatically by the system.

For iCal calendars: use server "ical-calendar" with a "url" field containing the ICS link. The agent fetches it using curl — no MCP server or API key needed. Use one tool node per calendar.

Only use placeholder values like YOUR_API_KEY for services that genuinely require an API key (News, etc.).

## Response Format

You MUST respond with valid JSON only — no markdown, no code fences, no extra text:

{
  "message": "string — conversational response shown in the chat UI",
  "operations": [array of canvas operations, empty if no changes needed],
  "options": ["Option A", "Option B"]  (optional — see below)
}

### When to use "options"

Include "options" whenever you need the user to make a clear choice before you can proceed. Use it instead of asking an open-ended question. Examples:
- Which channel should results go to? → ["Telegram", "File", "Webhook"]
- How often should it run? → ["Every morning at 8am", "Every hour", "Every Monday"]
- What kind of search? → ["Web search", "Wikipedia only", "News only"]
- Are you ready to deploy? → ["Yes, deploy it", "Let me review first"]

Rules:
- 2–5 short options only. Each option is a phrase that will be sent as the user's next message when they click it.
- Phrase each option as if the user is saying it: "Every morning at 8am", not "8am daily schedule".
- Only use options for genuine user choices. Don't use them for yes/no confirmations where the user can just type — use pendingCommand confirmation for that instead.
- Omit the field entirely if no choices are needed.

Operation types:
- {"op": "clear"}
- {"op": "addNode", "tempId": "t1", "kind": "trigger", "label": "...", "triggerType": "message", "config": "", "x": 200, "y": 80}
- {"op": "addNode", "tempId": "t1", "kind": "trigger", "label": "...", "triggerType": "schedule", "config": "0 9 * * *", "additionalTriggers": [{"triggerType": "message", "config": ""}], "x": 200, "y": 80}
- {"op": "addNode", "tempId": "t2", "kind": "agent", "label": "...", "model": "claude-sonnet-4-6", "systemPrompt": "...", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t3", "kind": "tool", "label": "...", "toolType": "bash", "config": "curl https://api.example.com/data", "x": 200, "y": 520}
- {"op": "addNode", "tempId": "t3b", "kind": "tool", "label": "...", "toolType": "search", "config": "", "x": 200, "y": 520}
- {"op": "addNode", "tempId": "t3c", "kind": "tool", "label": "...", "toolType": "mcp", "config": "{\"server\": \"gmail-mcp\", \"action\": \"list_emails\", \"query\": \"is:unread\"}", "x": 200, "y": 520}
- {"op": "addNode", "tempId": "t4", "kind": "condition", "label": "...", "conditionType": "contains", "value": "urgent", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t4b", "kind": "condition", "label": "...", "conditionType": "always_true", "value": "", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t5", "kind": "router", "label": "...", "routingPrompt": "Route to Urgent if the message contains a deadline or critical keyword, otherwise route to Normal.", "branches": ["Urgent", "Normal"], "x": 200, "y": 520}
- {"op": "addNode", "tempId": "t6", "kind": "transform", "label": "...", "transformType": "template", "config": "Summary for {{date}}:\n\n{{input}}", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t6b", "kind": "transform", "label": "...", "transformType": "truncate", "config": "2000", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t7", "kind": "memory", "label": "...", "operation": "read", "scope": "group", "key": "price_history", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t7b", "kind": "memory", "label": "...", "operation": "write", "scope": "group", "key": "price_history", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t8", "kind": "file", "label": "...", "path": "/workspace/data", "permissions": "readwrite", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t9", "kind": "output", "label": "...", "destination": "telegram", "config": "", "x": 200, "y": 740}
- {"op": "addNode", "tempId": "t9b", "kind": "output", "label": "...", "destination": "file", "config": "/workspace/report.md", "x": 200, "y": 740}
- {"op": "addNode", "tempId": "t9c", "kind": "output", "label": "...", "destination": "webhook", "config": "https://hooks.zapier.com/hooks/catch/...", "x": 200, "y": 740}
- {"op": "addNode", "tempId": "t9d", "kind": "output", "label": "Pass to Reviewer", "destination": "agent_handoff", "targetFolder": "coding_reviewer", "handoffMessage": "Review this: {{input}}", "x": 200, "y": 740}
- {"op": "addNode", "tempId": "t10", "kind": "comment", "text": "...", "color": "#4b5563", "x": 400, "y": 80}
- {"op": "connect", "from": "t1", "to": "t2"}
- {"op": "connect", "from": "t4", "to": "t5", "handle": "true"}
- {"op": "connect", "from": "t4", "to": "t5", "handle": "false"}
- {"op": "connect", "from": "t5", "to": "t6", "handle": "branch-0"}
- {"op": "connect", "from": "t5", "to": "t6", "handle": "branch-1"}
- {"op": "updateNode", "id": "node-5", "data": {"label": "New Name"}}
- {"op": "deleteNode", "id": "node-5"}

For pure questions with no canvas changes, set "operations" to [].

## Reliability — Always Include in Agent System Prompts

When writing the systemPrompt for any agent node, always include these instructions naturally as part of the bot's behaviour description:

1. **Scheduled bots**: Tell the agent to send a brief "Starting..." acknowledgement (via send_message) as its first action every run. This confirms it's running. Without this, a silent failure looks identical to a bot that was never triggered.

2. **Bots using external services** (Gmail, web requests, APIs, bash scripts): Tell the agent that if a tool fails, it should send a short error message and stop — not retry endlessly. Retrying a broken tool 20 times costs as much as 20 runs.

3. **Bots that process items in bulk** (emails, files, search results): Give the agent a sensible upper limit (e.g. "process at most 30 emails per run"). Without a limit, a large inbox can keep the agent busy for 30+ minutes and cost many dollars.

These are not optional extras — they are what separates a bot that costs $0.01/day from one that costs $5/day.

## Setup & Installation Mode

You are also a setup assistant. When users want to install channels (Telegram, Slack, WhatsApp), check connection status, configure integrations, or troubleshoot — use your tools to help directly without leaving Blueprint.

Available tools:
- **run_command** — run shell commands in the nanoclaw directory (npm installs, skill scripts, status checks)
- **read_file** — read config files (.nanoclaw/state.yaml, .env with secrets auto-hidden, CLAUDE.md)
- **write_env_key** — safely add or update a key in nanoclaw's .env (use when the user gives you a token)

### Setup workflow
1. Check state first — read .nanoclaw/state.yaml to see what's installed, check .env for existing tokens
2. Tell the user what you found before doing anything
3. Only run what's needed — skip things already installed or configured
4. For destructive commands (rm, git reset, restart), explain what will happen before running
5. Verify after running — check that output shows success

### Setup response format
Same JSON format as always — set "operations" to [] if no canvas changes needed. Your message should summarise what was done and what the user needs to do next (e.g. provide a token). Command output is shown automatically — no need to copy-paste raw terminal output into your message.`;

// ── Claude tool definitions ───────────────────────────────────────────────────

const SETUP_TOOLS: Anthropic.Tool[] = [
  {
    name: 'run_command',
    description: 'Run a shell command in the nanoclaw directory. Use for npm installs, skill scripts, status checks, reading logs, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        description: { type: 'string', description: 'Plain-English explanation of what this command does and why' },
      },
      required: ['command', 'description'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file relative to the nanoclaw directory. Secrets in .env are auto-hidden.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to nanoclaw, e.g. ".nanoclaw/state.yaml" or "groups/main/CLAUDE.md"' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_env_key',
    description: "Add or update a single key in nanoclaw's .env file. Use when the user provides a token or API key.",
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'ENV key name, e.g. TELEGRAM_BOT_TOKEN' },
        value: { type: 'string', description: 'The value to set' },
        description: { type: 'string', description: 'What this key is for' },
      },
      required: ['key', 'value', 'description'],
    },
  },
];

// ── JSON extraction (brace-balanced, handles strings with { } inside) ─────────

function extractJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ── Model selection ───────────────────────────────────────────────────────────

const SETUP_KEYWORDS = /\b(install|setup|set up|configure|add|connect|telegram|slack|whatsapp|discord|gmail|oauth|token|register|troubleshoot|debug|not working|restart|service|skill|error|failed|broken)\b/i;

function resolveModel(model: string, messages: Array<{ role: string; content: string }>): string {
  if (model !== 'auto') return model;
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
  return SETUP_KEYWORDS.test(lastUser) ? 'claude-opus-4-6' : 'claude-sonnet-4-6';
}

// ── Connected channels context ────────────────────────────────────────────────

function readConnectedChannelsContext(nanoclawPath: string): string {
  try {
    const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
    if (!fs.existsSync(DB_PATH)) return '';
    const Database = getDatabase(nanoclawPath);
    const db = new Database(DB_PATH, { readonly: true }) as { prepare: (s: string) => { all: () => unknown[] }; close: () => void };
    const rows = db.prepare(`
      SELECT jid, name, folder FROM registered_groups ORDER BY name
    `).all() as Array<{ jid: string; name: string; folder: string }>;
    db.close();
    if (rows.length === 0) return '';
    const lines = rows.map(r => {
      const type = r.jid.startsWith('tg:') ? 'Telegram' :
                   r.jid.startsWith('wa:') ? 'WhatsApp' :
                   r.jid.startsWith('slack:') ? 'Slack' :
                   r.jid.startsWith('discord:') ? 'Discord' :
                   r.jid.startsWith('scheduled:') ? 'Scheduled-only' : 'Unknown';
      return `- ${type}: "${r.name}" (folder: ${r.folder})`;
    });
    return `\n\n## Connected Channels\n\nThe following channels are set up in nanoclaw:\n${lines.join('\n')}\n\nWhen the user's request involves sending output to a specific service (Telegram, Slack, WhatsApp, etc.), match it to the connected channels above. Prefer connected channels over unconnected ones. If a channel type the user asks for is NOT in this list, mention that they'll need to set it up first and suggest telegram or file as an alternative.`;
  } catch {
    return '';
  }
}

// ── Agentic chat loop with tools ──────────────────────────────────────────────

type CommandLogEntry = { cmd: string; output: string; ok: boolean; description: string };

interface ChatApiResponse {
  message: string;
  operations?: unknown[];
  commandLog?: CommandLogEntry[];
  pendingCommand?: { cmd: string; description: string };
  options?: string[];
}

async function runChatWithTools(
  messages: Array<{ role: string; content: string }>,
  graphState: string,
  confirmedCommands: string[],
  model = 'auto',
  onProgress?: (event: { type: 'running'; cmd: string; description: string }) => void,
): Promise<ChatApiResponse> {
  const nanoclawPath = detectNanoclawPath();
  const client = makeClient();
  const channelContext = nanoclawPath ? readConnectedChannelsContext(nanoclawPath) : '';
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dateContext = `\n\n## Today's Date\n\nToday is ${today}. When the user mentions dates without a year (e.g. "March 28"), always use ${today.slice(0, 4)} unless context clearly indicates otherwise.`;
  const systemWithGraph = (graphState ? `${SYSTEM}\n\n## Current Canvas\n\n${graphState}` : SYSTEM) + channelContext + dateContext;
  const commandLog: CommandLogEntry[] = [];
  const resolvedModel = resolveModel(model, messages);

  let apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  for (let turn = 0; turn < 40; turn++) {
    const response = await client.messages.create({
      model: resolvedModel,
      max_tokens: 4096,
      system: systemWithGraph,
      tools: SETUP_TOOLS,
      tool_choice: { type: 'auto' },
      messages: apiMessages,
    });

    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find((b) => b.type === 'text');
      const rawText = textBlock?.type === 'text' ? textBlock.text : '';
      const jsonStr = extractJsonObject(rawText);
      let parsed: ChatApiResponse;
      if (jsonStr) {
        const candidate = JSON.parse(jsonStr) as ChatApiResponse;
        // If the extracted JSON has no message (e.g. it grabbed an operation object), fall back to raw text
        parsed = candidate.message ? candidate : { message: rawText || '(No response)', operations: [] };
      } else {
        parsed = { message: rawText || '(No response)', operations: [] };
      }
      return { ...parsed, commandLog: commandLog.length ? commandLog : undefined };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      let result: string;

      if (block.name === 'run_command') {
        const inp = block.input as { command: string; description: string };
        const { command, description } = inp;
        const blocked = getBlockReason(command);
        if (blocked) {
          result = `BLOCKED: ${blocked}`;
        } else if (needsConfirmation(command) && !confirmedCommands.includes(command)) {
          return {
            message: `I need to run a command that requires your approval:\n\n\`${command}\`\n\n${description}`,
            operations: [],
            commandLog: commandLog.length ? commandLog : undefined,
            pendingCommand: { cmd: command, description },
          };
        } else if (!nanoclawPath) {
          result = 'ERROR: Nanoclaw path not configured';
        } else {
          onProgress?.({ type: 'running', cmd: command, description });
          const exec = await executeCommand(command, nanoclawPath);
          commandLog.push({ cmd: command, output: exec.output, ok: exec.ok, description });
          result = exec.ok ? exec.output : `ERROR: ${exec.output}`;
        }
      } else if (block.name === 'read_file') {
        const inp = block.input as { path: string };
        result = nanoclawPath ? readFileSecure(inp.path, nanoclawPath) : 'ERROR: Nanoclaw path not configured';
      } else if (block.name === 'write_env_key') {
        const inp = block.input as { key: string; value: string; description: string };
        if (!nanoclawPath) {
          result = 'ERROR: Nanoclaw path not configured';
        } else {
          result = writeEnvKey(inp.key, inp.value, nanoclawPath);
          commandLog.push({ cmd: `Set ${inp.key} in .env`, output: result, ok: !result.startsWith('ERROR'), description: inp.description });
        }
      } else {
        result = 'Unknown tool';
      }

      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }

    apiMessages = [
      ...apiMessages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    ];
  }

  return { message: 'The assistant took too many steps. Try a simpler request.', operations: [] };
}

// ── Body parsing ──────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ── Groups filesystem API ─────────────────────────────────────────────────────

function isValidFolder(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name) && name.length > 0 && name.length <= 100;
}

async function handleGroups(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  const nanoclawPath = detectNanoclawPath();
  if (!nanoclawPath) {
    res.writeHead(503);
    res.end(JSON.stringify({ error: 'Nanoclaw installation not found. Configure NANOCLAW_PATH in setup.' }));
    return;
  }
  const GROUPS_DIR = path.join(nanoclawPath, 'groups');

  // connect strips the /api/groups prefix, so req.url is relative to that
  const url = (req.url || '/').split('?')[0];
  const parts = url.split('/').filter(Boolean); // [] | [folder, resource]

  // ── GET /api/groups — list all groups ─────────────────────────────────────
  if (req.method === 'GET' && parts.length === 0) {
    try {
      if (!fs.existsSync(GROUPS_DIR)) {
        res.writeHead(200);
        res.end(JSON.stringify({ groups: [] }));
        return;
      }
      const entries = fs.readdirSync(GROUPS_DIR, { withFileTypes: true });
      const groups = entries
        .filter((e) => e.isDirectory() && isValidFolder(e.name))
        .map((e) => {
          const blueprintPath = path.join(GROUPS_DIR, e.name, 'blueprint.json');
          const hasBlueprint = fs.existsSync(blueprintPath);
          let swarmChildren: string[] = [];
          if (hasBlueprint) {
            try {
              const bp = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));
              swarmChildren = ((bp.nodes ?? []) as Array<{ type: string; data: { groupFolder?: string } }>)
                .filter(n => n.type === 'swimlane')
                .map(n => n.data.groupFolder ?? '')
                .filter(Boolean);
            } catch { /* ignore */ }
          }
          const namePath = path.join(GROUPS_DIR, e.name, 'name.txt');
          const displayName = fs.existsSync(namePath)
            ? fs.readFileSync(namePath, 'utf-8').trim()
            : e.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          return {
            folder: e.name,
            hasBlueprint,
            hasClaude: fs.existsSync(path.join(GROUPS_DIR, e.name, 'CLAUDE.md')),
            swarmChildren,
            displayName,
          };
        });
      res.writeHead(200);
      res.end(JSON.stringify({ groups }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── GET /api/groups/bots — list scheduled bots available as handoff targets ──
  if (req.method === 'GET' && parts[0] === 'bots') {
    try {
      const nanoclawPath = detectNanoclawPath();
      if (!nanoclawPath) { res.writeHead(503); res.end(JSON.stringify({ error: 'Nanoclaw not found' })); return; }
      const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
      if (!fs.existsSync(DB_PATH)) { res.writeHead(200); res.end(JSON.stringify({ bots: [] })); return; }
      const Database = getDatabase(nanoclawPath);
      const db = new Database(DB_PATH, { readonly: true });
      const rows = db.prepare("SELECT folder, name FROM registered_groups WHERE jid LIKE 'scheduled:%' ORDER BY name").all() as Array<{ folder: string; name: string }>;
      db.close();
      res.writeHead(200);
      res.end(JSON.stringify({ bots: rows }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── GET /api/groups/channels — list channels available as output targets ──
  if (req.method === 'GET' && parts[0] === 'channels') {
    try {
      const nanoclawPath = detectNanoclawPath();
      if (!nanoclawPath) { res.writeHead(503); res.end(JSON.stringify({ error: 'Nanoclaw not found' })); return; }
      const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
      if (!fs.existsSync(DB_PATH)) { res.writeHead(200); res.end(JSON.stringify({ channels: [] })); return; }
      const Database = getDatabase(nanoclawPath);
      const db = new Database(DB_PATH, { readonly: true });
      const rows = db.prepare('SELECT jid, name, folder FROM registered_groups WHERE jid NOT LIKE \'scheduled:%\' ORDER BY name').all() as Array<{ jid: string; name: string; folder: string }>;
      db.close();
      res.writeHead(200);
      res.end(JSON.stringify({ channels: rows }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── POST /api/groups — create a new group folder ───────────────────────────
  if (req.method === 'POST' && parts.length === 0) {
    try {
      const body = JSON.parse(await readBody(req)) as { name: string };
      const folder = (body.name ?? '')
        .trim().toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_-]/g, '')
        .replace(/_{2,}/g, '_')
        .slice(0, 50);
      if (!folder || !isValidFolder(folder)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid bot name' }));
        return;
      }
      const groupDir = path.join(GROUPS_DIR, folder);
      if (fs.existsSync(groupDir)) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: `A bot named "${folder}" already exists` }));
        return;
      }
      fs.mkdirSync(groupDir, { recursive: true });

      // If an output channel JID was provided, register the group immediately
      if (body.channelJid) {
        try {
          const nanoclawPath = detectNanoclawPath();
          if (nanoclawPath) {
            const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
            if (fs.existsSync(DB_PATH)) {
              const Database = getDatabase(nanoclawPath);
              const db = new Database(DB_PATH);
              db.prepare(`
                INSERT OR IGNORE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, requires_trigger, is_main, container_config)
                VALUES (?, ?, ?, '@', datetime('now'), 0, 0, ?)
              `).run(`scheduled:${folder}`, folder.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()), folder, JSON.stringify({ outputJid: body.channelJid }));
              db.close();
            }
          }
        } catch { /* registration is best-effort */ }
      }

      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, folder }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── POST /api/groups/:folder/register — register an existing group ─────────
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'register') {
    try {
      const folder = parts[0];
      if (!folder || !isValidFolder(folder)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid folder name' })); return; }
      const body = JSON.parse(await readBody(req)) as { channelJid: string; type?: string };
      if (!body.channelJid) { res.writeHead(400); res.end(JSON.stringify({ error: 'channelJid required' })); return; }
      const nanoclawPath = detectNanoclawPath();
      if (!nanoclawPath) { res.writeHead(503); res.end(JSON.stringify({ error: 'Nanoclaw not found' })); return; }
      const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
      const Database = getDatabase(nanoclawPath);
      const db = new Database(DB_PATH);
      const displayName = folder.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

      if (body.type === 'message') {
        // Message trigger: register the real channel JID directly so nanoclaw routes messages to this folder
        db.prepare(`
          INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, requires_trigger, is_main, container_config)
          VALUES (?, ?, ?, '@', datetime('now'), 0, 0, NULL)
        `).run(body.channelJid, displayName, folder);
      } else {
        // Schedule trigger: keep scheduled: jid, store outputJid in container_config
        db.prepare(`
          INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, requires_trigger, is_main, container_config)
          VALUES (?, ?, ?, '@', datetime('now'), 0, 0, ?)
        `).run(`scheduled:${folder}`, displayName, folder, JSON.stringify({ outputJid: body.channelJid }));
      }
      db.close();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── POST /api/groups/:folder/run — trigger scheduled task immediately ────────
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'run') {
    try {
      const folder = parts[0];
      if (!folder || !isValidFolder(folder)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid folder name' })); return; }
      const nanoclawPath = detectNanoclawPath();
      if (!nanoclawPath) { res.writeHead(503); res.end(JSON.stringify({ error: 'Nanoclaw not found' })); return; }
      const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
      if (!fs.existsSync(DB_PATH)) { res.writeHead(404); res.end(JSON.stringify({ error: 'No tasks found' })); return; }
      const Database = getDatabase(nanoclawPath);
      const db = new Database(DB_PATH) as { prepare: (s: string) => { run: (...a: unknown[]) => { changes: number } }; close: () => void };
      // Set next_run to 1 second in the past so the scheduler picks it up immediately
      const result = db.prepare(`
        UPDATE scheduled_tasks
        SET next_run = datetime('now', '-1 second')
        WHERE group_folder = ? AND status = 'active'
      `).run(folder);
      db.close();
      if (result.changes === 0) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'No active scheduled tasks found for this bot. Deploy the blueprint first.' }));
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, triggered: result.changes }));
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── GET /api/groups/:folder/runs — recent run history ────────────────────────
  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'runs') {
    try {
      const folder = parts[0];
      if (!folder || !isValidFolder(folder)) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid folder name' })); return; }
      const nanoclawPath = detectNanoclawPath();
      if (!nanoclawPath) { res.writeHead(503); res.end(JSON.stringify({ error: 'Nanoclaw not found' })); return; }
      const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
      if (!fs.existsSync(DB_PATH)) { res.writeHead(200); res.end(JSON.stringify({ runs: [], task: null })); return; }
      const Database = getDatabase(nanoclawPath);
      const db = new Database(DB_PATH, { readonly: true }) as {
        prepare: (s: string) => { all: (...a: unknown[]) => unknown[]; get: (...a: unknown[]) => unknown };
        close: () => void;
      };
      // Get the scheduled task for this folder
      const task = db.prepare(`
        SELECT id, schedule_value, next_run, last_run, last_result, status
        FROM scheduled_tasks WHERE group_folder = ? AND status = 'active' LIMIT 1
      `).get(folder) as { id: string; schedule_value: string; next_run: string | null; last_run: string | null; last_result: string | null; status: string } | undefined;
      // Get the 20 most recent runs
      const runs = task ? db.prepare(`
        SELECT run_at, duration_ms, status, result, error
        FROM task_run_logs WHERE task_id = ?
        ORDER BY run_at DESC LIMIT 20
      `).all(task.id) : [];
      db.close();
      res.writeHead(200);
      res.end(JSON.stringify({ task: task ?? null, runs }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  const folder = parts[0];
  const resource = parts[1]; // 'blueprint' | 'claude-md'

  if (!folder || !isValidFolder(folder)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Invalid folder name' }));
    return;
  }

  const groupDir = path.join(GROUPS_DIR, folder);

  // ── /api/groups/:folder/blueprint ─────────────────────────────────────────
  if (resource === 'blueprint') {
    const blueprintPath = path.join(groupDir, 'blueprint.json');

    if (req.method === 'GET') {
      if (!fs.existsSync(blueprintPath)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'No blueprint saved for this group' }));
        return;
      }
      try {
        res.writeHead(200);
        res.end(fs.readFileSync(blueprintPath, 'utf-8'));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const body = await readBody(req);
        JSON.parse(body); // validate JSON before writing
        if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });
        fs.writeFileSync(blueprintPath, body, 'utf-8');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }
  }

  // ── /api/groups/:folder/settings ──────────────────────────────────────────
  if (resource === 'settings') {
    try {
      const nanoclawPath = detectNanoclawPath();
      if (!nanoclawPath) { res.writeHead(503); res.end(JSON.stringify({ error: 'Nanoclaw not found' })); return; }
      const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
      if (!fs.existsSync(DB_PATH)) { res.writeHead(404); res.end(JSON.stringify({ error: 'Database not found' })); return; }
      const DbCtor = _require(path.join(nanoclawPath, 'node_modules', 'better-sqlite3'));
      const db = new DbCtor(DB_PATH);

      if (req.method === 'GET') {
        const row = db.prepare('SELECT container_config FROM registered_groups WHERE folder = ?').get(folder) as { container_config: string | null } | undefined;
        db.close();
        if (!row) { res.writeHead(404); res.end(JSON.stringify({ error: 'Bot not registered' })); return; }
        const config = JSON.parse(row.container_config || '{}');
        res.writeHead(200);
        res.end(JSON.stringify({ additionalMounts: config.additionalMounts ?? [] }));
        return;
      }

      if (req.method === 'PUT') {
        const body = JSON.parse(await readBody(req));
        const row = db.prepare('SELECT container_config FROM registered_groups WHERE folder = ?').get(folder) as { container_config: string | null } | undefined;
        if (!row) { db.close(); res.writeHead(404); res.end(JSON.stringify({ error: 'Bot not registered' })); return; }
        // Read-then-merge: preserve outputJid and any other existing fields
        const existing = JSON.parse(row.container_config || '{}');
        const merged = { ...existing, additionalMounts: body.additionalMounts ?? [] };
        db.prepare('UPDATE registered_groups SET container_config = ? WHERE folder = ?').run(JSON.stringify(merged), folder);
        db.close();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── /api/groups/:folder/name ──────────────────────────────────────────────
  if (resource === 'name' && req.method === 'PUT') {
    try {
      const body = JSON.parse(await readBody(req));
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) { res.writeHead(400); res.end(JSON.stringify({ error: 'name is required' })); return; }
      if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });
      fs.writeFileSync(path.join(groupDir, 'name.txt'), name, 'utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, name }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── /api/groups/:folder/claude-md ─────────────────────────────────────────
  if (resource === 'claude-md') {
    const claudePath = path.join(groupDir, 'CLAUDE.md');

    if (req.method === 'GET') {
      try {
        const content = fs.existsSync(claudePath)
          ? fs.readFileSync(claudePath, 'utf-8')
          : '';
        res.writeHead(200);
        res.end(JSON.stringify({ content }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        if (typeof body.content !== 'string') throw new Error('content must be a string');
        if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });
        fs.writeFileSync(claudePath, body.content, 'utf-8');
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }
  }

  // ── /api/groups/:folder/deploy ────────────────────────────────────────────
  if (resource === 'deploy' && req.method === 'POST') {
    const claudePath = path.join(groupDir, 'CLAUDE.md');

    try {
      const body = JSON.parse(await readBody(req));
      const allNodes: DeployNode[] = body.nodes ?? [];
      const swimlaneNodes = allNodes.filter(n => n.type === 'swimlane');
      const partition = partitionBySwimlaneMembership(allNodes);
      // Primary group: nodes outside all swimlanes (or all nodes if no swimlanes)
      const primaryNodes = swimlaneNodes.length > 0 ? (partition.get(null) ?? []) : allNodes.filter(n => n.type !== 'swimlane');

      const nodes = primaryNodes;
      const agents   = nodes.filter(n => n.type === 'agent');
      const tools    = nodes.filter(n => n.type === 'tool');
      const triggers = nodes.filter(n => n.type === 'trigger');
      const outputs  = nodes.filter(n => n.type === 'output');

      // Require at least one agent either in primary group or in a swimlane
      const totalAgents = allNodes.filter(n => n.type === 'agent').length;
      if (totalAgents === 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Blueprint must have at least one Agent node to deploy.' }));
        return;
      }

      let content = '';
      if (agents.length > 0) {
        content = generateClaudeMd(folder, agents, tools, triggers, outputs);
          if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });
        fs.writeFileSync(claudePath, content, 'utf-8');
      }

      // ── Track what was done vs what needs manual steps ──
      const done: string[] = agents.length > 0 ? [`CLAUDE.md written to groups/${folder}/CLAUDE.md`] : [];
      const manual: string[] = [];

      if (agents.length > 0 && triggers.length === 0) {
        manual.push('No trigger node — add a Trigger node so the bot knows when to run');
      }
      if (agents.length > 0 && outputs.length === 0) {
        manual.push('No output node — add an Output node so the bot can send messages somewhere');
      }

      // ── Check agent_handoff targets are registered ──
      for (const out of outputs) {
        if (out.data.destination === 'agent_handoff') {
          const targetFolder = String(out.data.targetFolder || '').trim();
          if (!targetFolder) {
            manual.push('Agent handoff output — choose a target bot in the Output node settings');
          } else {
            try {
              const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
              if (fs.existsSync(DB_PATH)) {
                const DbCtor = _require(path.join(nanoclawPath, 'node_modules', 'better-sqlite3'));
                const db = new DbCtor(DB_PATH, { readonly: true });
                const row = db.prepare("SELECT name FROM registered_groups WHERE folder = ?").get(targetFolder) as { name: string } | undefined;
                db.close();
                if (!row) {
                  manual.push(`Handoff target "${targetFolder}" is not registered in nanoclaw yet — deploy that bot first`);
                } else {
                  done.push(`Handoff to "${row.name}" configured`);
                }
              }
            } catch { /* non-fatal */ }
          }
        }
      }

      // ── Collect all trigger entries (primary + additionalTriggers) ──
      type TriggerEntry = { triggerType: string; config: string; label: string };
      const allTriggerEntries: TriggerEntry[] = [];
      for (const tr of triggers) {
        const label = String(tr.data.label ?? 'Trigger');
        allTriggerEntries.push({ triggerType: String(tr.data.triggerType || ''), config: String(tr.data.config || ''), label });
        const additional = (tr.data.additionalTriggers as Array<{ triggerType: string; config: string }> | undefined) ?? [];
        for (const at of additional) {
          allTriggerEntries.push({ triggerType: String(at.triggerType || ''), config: String(at.config || ''), label });
        }
      }

      // ── Register schedule tasks ──
      const scheduleTriggerEntries = allTriggerEntries.filter(t => t.triggerType === 'schedule');
      // Compute the stable task IDs this blueprint will produce
      const newTaskIds = scheduleTriggerEntries
        .map(e => e.config.trim())
        .filter(Boolean)
        .map(cron => `blueprint:${folder}:${cron.replace(/\s+/g, '_')}`);
      // Delete old tasks for this folder that are no longer in the blueprint
      try {
        const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
        if (fs.existsSync(DB_PATH)) {
          const DbCtor = _require(path.join(nanoclawPath, 'node_modules', 'better-sqlite3'));
          const db = new DbCtor(DB_PATH);
          if (newTaskIds.length > 0) {
            const placeholders = newTaskIds.map(() => '?').join(',');
            const removed = db.prepare(
              `DELETE FROM scheduled_tasks WHERE group_folder = ? AND id LIKE 'blueprint:%' AND id NOT IN (${placeholders})`
            ).run(folder, ...newTaskIds);
            if (removed.changes > 0) done.push(`Removed ${removed.changes} old schedule(s) no longer in blueprint`);
          } else {
            // No schedule triggers in blueprint — remove all old blueprint tasks
            const removed = db.prepare(`DELETE FROM scheduled_tasks WHERE group_folder = ? AND id LIKE 'blueprint:%'`).run(folder);
            if (removed.changes > 0) done.push(`Removed ${removed.changes} old schedule(s) no longer in blueprint`);
          }
          db.close();
        }
      } catch { /* non-fatal */ }

      for (const entry of scheduleTriggerEntries) {
        const cronExpr = entry.config.trim();
        if (!cronExpr) {
          manual.push(`Schedule trigger "${entry.label}" — set a cron expression (e.g. "0 8 * * *" for 8am daily)`);
          continue;
        }
        const registered = tryRegisterSchedule(folder, cronExpr, entry.label);
        if (registered) {
          done.push(`Schedule registered: "${cronExpr}" — runs automatically`);
        } else {
          manual.push(`__UNREGISTERED_SCHEDULE__:${cronExpr}`);
        }
      }

      // ── Check message triggers are connected to a channel ──
      const messageTriggerEntries = allTriggerEntries.filter(t => t.triggerType === 'message');
      if (messageTriggerEntries.length > 0) {
        try {
          const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
          if (fs.existsSync(DB_PATH)) {
            const DbCtor = _require(path.join(nanoclawPath, 'node_modules', 'better-sqlite3'));
            const db = new DbCtor(DB_PATH, { readonly: true });
            const row = db.prepare("SELECT jid, name FROM registered_groups WHERE folder = ? AND jid NOT LIKE 'scheduled:%' ORDER BY added_at DESC LIMIT 1").get(folder) as { jid: string; name: string } | undefined;
            db.close();
            if (!row) {
              manual.push('__UNREGISTERED_MESSAGE_TRIGGER__');
            } else {
              done.push(`Message trigger: connected to ${row.name || row.jid}${messageTriggerEntries[0].config ? ` (keyword: "${messageTriggerEntries[0].config}")` : ' (all messages)'}`);
            }
          }
        } catch { /* non-fatal */ }
      }

      // ── Flag webhook triggers without a path ──
      for (const entry of allTriggerEntries) {
        if (entry.triggerType === 'webhook' && !entry.config.trim()) {
          manual.push(`Webhook trigger "${entry.label}" — set the incoming webhook path`);
        }
      }

      // ── Check which OAuth services are already authorized ──
      const HOME_DIR = path.join(process.env.HOME ?? '', '.gmail-mcp');
      const gmailAuthorized = fs.existsSync(path.join(HOME_DIR, 'credentials.json'));

      // OAuth-based servers that need no API key — authorized via external flow
      const OAUTH_SERVERS: Record<string, { name: string; credPath: string }> = {
        'gmail-mcp':           { name: 'Gmail',            credPath: path.join(process.env.HOME ?? '', '.gmail-mcp', 'credentials.json') },
        'google-calendar-mcp': { name: 'Google Calendar',  credPath: path.join(process.env.HOME ?? '', '.gmail-mcp', 'credentials.json') },
      };

      // ── Flag MCP tools with placeholder values ──
      for (const t of tools) {
        if (t.data.toolType === 'mcp') {
          const cfg = String(t.data.config || '');
          let serverName = '';
          try { serverName = JSON.parse(cfg).server ?? ''; } catch {}
          const label = String(t.data.label ?? serverName ?? 'MCP Tool');

          // iCal calendar: check URL is set
          if (serverName === 'ical-calendar') {
            let icalUrl = '';
            try { icalUrl = JSON.parse(cfg).url ?? ''; } catch {}
            const calName = (() => { try { return JSON.parse(cfg).calendarName || label; } catch { return label; } })();
            if (icalUrl) {
              done.push(`${calName} — iCal feed configured`);
            } else {
              manual.push(`${calName} — paste the iCal/ICS URL into the node config panel`);
            }
            continue;
          }

          // OAuth services: check if already authorized
          const oauthInfo = OAUTH_SERVERS[serverName];
          if (oauthInfo) {
            if (fs.existsSync(oauthInfo.credPath)) {
              done.push(`${oauthInfo.name} — already authorized via OAuth`);
            } else {
              manual.push(`${oauthInfo.name} — run /add-${serverName.replace('-mcp', '')} in nanoclaw to authorize`);
            }
            continue;
          }

          // API-key services: flag placeholder values
          if (cfg.includes('YOUR_')) {
            const placeholders = [...cfg.matchAll(/YOUR_[A-Z_]+/g)].map(m => m[0]);
            manual.push(`${label} — replace ${placeholders.join(', ')} in the node config panel`);
          }
        }
      }
      void gmailAuthorized; // suppress unused warning

      // ── Deploy swimlane (sub-bot) groups ──────────────────────────────────
      for (const sl of swimlaneNodes) {
        const slFolder = String(sl.data.groupFolder || 'bot').trim();
        if (!slFolder) continue;
        const slLabel = String(sl.data.label ?? slFolder);
        const slNodes = partition.get(slFolder) ?? [];
        const slAgents   = slNodes.filter(n => n.type === 'agent');
        if (slAgents.length === 0) continue;
        const slTools    = slNodes.filter(n => n.type === 'tool');
        const slTriggers = slNodes.filter(n => n.type === 'trigger');
        const slOutputs  = slNodes.filter(n => n.type === 'output');

        const slContent  = generateClaudeMd(slFolder, slAgents, slTools, slTriggers, slOutputs);
        const slDir      = path.join(nanoclawPath, 'groups', slFolder);
        const slPath     = path.join(slDir, 'CLAUDE.md');
        if (!fs.existsSync(slDir)) fs.mkdirSync(slDir, { recursive: true });
        fs.writeFileSync(slPath, slContent, 'utf-8');
        done.push(`[${slLabel}] CLAUDE.md written to groups/${slFolder}/CLAUDE.md`);

        try {
          const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
          if (fs.existsSync(DB_PATH)) {
            const DbCtor = _require(path.join(nanoclawPath, 'node_modules', 'better-sqlite3'));
            const db = new DbCtor(DB_PATH);

            // Read parent's outputJid to inherit for sub-bots that lack one
            let parentOutputJid: string | null = null;
            try {
              const parentRg = db.prepare('SELECT container_config FROM registered_groups WHERE folder = ?').get(folder) as { container_config: string | null } | undefined;
              if (parentRg?.container_config) {
                parentOutputJid = (JSON.parse(parentRg.container_config) as { outputJid?: string }).outputJid ?? null;
              }
            } catch { /* non-fatal */ }

            const existing = db.prepare('SELECT folder, container_config FROM registered_groups WHERE folder = ?').get(slFolder) as { folder: string; container_config: string | null } | undefined;
            if (!existing) {
              const slConfig = parentOutputJid ? JSON.stringify({ outputJid: parentOutputJid }) : null;
              db.prepare('INSERT OR IGNORE INTO registered_groups (jid, folder, name, added_at, container_config) VALUES (?, ?, ?, ?, ?)')
                .run(`scheduled:${slFolder}`, slFolder, slLabel, new Date().toISOString(), slConfig);
              done.push(`[${slLabel}] Registered as new bot (scheduled:${slFolder})`);
            }
            // Register schedule triggers for this swimlane bot
            const slSchedules = slTriggers.flatMap(tr => {
              const entries = [{ type: String(tr.data.triggerType || ''), config: String(tr.data.config || '') }];
              const additional = (tr.data.additionalTriggers as Array<{ triggerType: string; config: string }> | undefined) ?? [];
              return [...entries, ...additional.map(a => ({ type: String(a.triggerType || ''), config: String(a.config || '') }))];
            }).filter(e => e.type === 'schedule' && e.config.trim());
            for (const e of slSchedules) {
              const registered = tryRegisterSchedule(slFolder, e.config.trim(), slLabel);
              if (registered) {
                done.push(`[${slLabel}] Schedule registered: "${e.config.trim()}"`);
              } else {
                manual.push(`[${slLabel}] Schedule "${e.config.trim()}" — set an output channel for ${slLabel} to activate`);
              }
            }
            db.close();
          }
        } catch { /* non-fatal */ }
      }

      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, preview: content, actions: { done, manual } }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

// ── Status panel API ──────────────────────────────────────────────────────────

async function handleStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const nanoclawPath = detectNanoclawPath();
    if (!nanoclawPath) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Nanoclaw installation not found' }));
      return;
    }

    const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
    if (!fs.existsSync(DB_PATH)) {
      res.writeHead(200);
      res.end(JSON.stringify({ groups: [] }));
      return;
    }

    const Database = getDatabase(nanoclawPath);
    const db = new Database(DB_PATH, { readonly: true }) as {
      prepare: (sql: string) => { all: (...args: unknown[]) => unknown[]; get: (...args: unknown[]) => unknown };
      close: () => void;
    };

    // Fetch all registered groups
    const registeredGroups = db.prepare(
      'SELECT folder, name, jid, container_config FROM registered_groups ORDER BY folder'
    ).all() as Array<{ folder: string; name: string; jid: string; container_config: string | null }>;

    const GROUPS_DIR = path.join(nanoclawPath, 'groups');

    const groups = registeredGroups.map((rg) => {
      // Determine triggerType
      let triggerType: 'message' | 'scheduled' | 'none';
      if (rg.jid.startsWith('scheduled:')) {
        triggerType = 'scheduled';
      } else if (rg.jid.includes(':')) {
        triggerType = 'message';
      } else {
        triggerType = 'none';
      }

      // Parse outputJid from container_config
      let outputJid: string | null = null;
      try {
        if (rg.container_config) {
          const cfg = JSON.parse(rg.container_config) as { outputJid?: string };
          outputJid = cfg.outputJid ?? null;
        }
      } catch { /* ignore */ }

      // Fetch active scheduled tasks for this group
      const taskRows = db.prepare(
        `SELECT id, prompt, schedule_value, next_run, last_run FROM scheduled_tasks
         WHERE group_folder = ? AND status = 'active'`
      ).all(rg.folder) as Array<{
        id: string;
        prompt: string;
        schedule_value: string;
        next_run: string | null;
        last_run: string | null;
      }>;

      const tasks = taskRows.map((t) => {
        // Get most recent log entry for this task
        const logRow = db.prepare(
          `SELECT status, result FROM task_run_logs WHERE task_id = ? ORDER BY run_at DESC LIMIT 1`
        ).get(t.id) as { status: string; result: string | null } | undefined;

        return {
          id: t.id,
          label: t.prompt.slice(0, 60),
          schedule: t.schedule_value,
          nextRun: t.next_run ?? null,
          lastRun: t.last_run ?? null,
          lastStatus: logRow?.status ?? null,
          lastResult: logRow?.result ? logRow.result.slice(0, 120) : null,
        };
      });

      // Build warnings
      const warnings: string[] = [];
      const folderPath = path.join(GROUPS_DIR, rg.folder);
      if (!fs.existsSync(folderPath)) {
        warnings.push('Folder missing on disk');
      }
      if (tasks.length === 0 && triggerType !== 'message') {
        warnings.push('No tasks and no message trigger');
      }

      return {
        folder: rg.folder,
        name: rg.name,
        jid: rg.jid,
        triggerType,
        outputJid,
        tasks,
        warnings,
      };
    });

    // Sort alphabetically by folder
    groups.sort((a, b) => a.folder.localeCompare(b.folder));

    db.close();

    res.writeHead(200);
    res.end(JSON.stringify({ groups }));
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: String(err) }));
  }
}

// ── Schedule registration ─────────────────────────────────────────────────────

function tryRegisterSchedule(folder: string, cronExpr: string, taskLabel: string): boolean {
  try {
    const nanoclawPath = detectNanoclawPath();
    if (!nanoclawPath) return false;
    const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
    const NANOCLAW_MODULES = path.join(nanoclawPath, 'node_modules');
    if (!fs.existsSync(DB_PATH)) return false;

    const Database = _require(path.join(NANOCLAW_MODULES, 'better-sqlite3'));
    const db = new Database(DB_PATH);

    // Look up the group's JID — prefer outputJid from container_config for schedule-only bots
    const group = db.prepare('SELECT jid, container_config FROM registered_groups WHERE folder = ?').get(folder) as { jid: string; container_config?: string } | undefined;
    if (!group) {
      db.close();
      return false;
    }
    let chatJid = group.jid;
    try {
      const cfg = group.container_config ? JSON.parse(group.container_config) as { outputJid?: string } : {};
      if (cfg.outputJid) chatJid = cfg.outputJid;
    } catch { /* ignore */ }

    // Use folder+cron as a stable task ID so re-deploys are idempotent
    const taskId = `blueprint:${folder}:${cronExpr.replace(/\s+/g, '_')}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
      VALUES (?, ?, ?, ?, 'cron', ?, 'isolated', ?, 'active', ?)
      ON CONFLICT(id) DO UPDATE SET schedule_value=excluded.schedule_value, status='active'
    `).run(taskId, folder, chatJid, taskLabel, cronExpr, now, now);

    db.close();
    return true;
  } catch (err) {
    console.warn('[deploy] Failed to register schedule:', err);
    return false;
  }
}

// ── Config (.env) management ──────────────────────────────────────────────────

async function handleConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    const apiKey = readEnvValue('ANTHROPIC_API_KEY');
    const oauthToken = readEnvValue('CLAUDE_CODE_OAUTH_TOKEN');
    res.writeHead(200);
    res.end(JSON.stringify({ configured: !!(apiKey || oauthToken) }));
    return;
  }

  if (req.method === 'POST') {
    try {
      const nanoclawPath = detectNanoclawPath();
      if (!nanoclawPath) throw new Error('Nanoclaw path not configured. Complete setup first.');
      const ENV_PATH = path.join(nanoclawPath, '.env');

      const body = JSON.parse(await readBody(req)) as Record<string, string>;
      let envContent = '';
      try { envContent = fs.readFileSync(ENV_PATH, 'utf-8'); } catch { /* new file */ }

      for (const [key, value] of Object.entries(body)) {
        if (typeof value !== 'string') continue;
        if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
        const escaped = value.replace(/\n/g, '\\n');
        const lineRegex = new RegExp(`^${key}=.*$`, 'm');
        if (lineRegex.test(envContent)) {
          envContent = envContent.replace(lineRegex, `${key}=${escaped}`);
        } else {
          envContent = envContent.trimEnd() + (envContent ? '\n' : '') + `${key}=${escaped}\n`;
        }
      }

      fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  res.writeHead(405);
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

// ── Setup API (nanoclaw path configuration) ───────────────────────────────────

async function handleSetup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    const detected = detectNanoclawPath();
    const saved = readLocalEnvValue('NANOCLAW_PATH');
    res.writeHead(200);
    res.end(JSON.stringify({
      configured: !!detected,
      path: detected,
      autoDetected: !!detected && !saved,
    }));
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req)) as { nanoclawPath: string };
      const p = body.nanoclawPath?.trim();
      if (!p) throw new Error('nanoclawPath is required');
      if (!fs.existsSync(p)) throw new Error(`Path not found: ${p}`);
      if (!isNanoclawDir(p)) throw new Error(`Not a nanoclaw installation: ${p}\n(Expected to find a groups/ folder and src/ or store/)`);
      writeLocalEnvValue('NANOCLAW_PATH', p);
      invalidateNanoclawPathCache();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, path: p }));
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  res.writeHead(405);
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

// ── CLAUDE.md generator ───────────────────────────────────────────────────────

const MCP_SERVICE_NAMES: Record<string, string> = {
  'gmail-mcp':            'Gmail (read and send emails)',
  'google-calendar-mcp':  'Google Calendar (read events)',
  'openweathermap-mcp':   'Weather via OpenWeatherMap',
  'newsapi-mcp':          'News headlines via NewsAPI',
};

// ── Swimlane partition ────────────────────────────────────────────────────────

type DeployNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  style?: { width?: number | string; height?: number | string };
  data: Record<string, unknown>;
};

function partitionBySwimlaneMembership(nodes: DeployNode[]): Map<string | null, DeployNode[]> {
  const swimlanes = nodes.filter(n => n.type === 'swimlane');
  const result = new Map<string | null, DeployNode[]>();
  result.set(null, []);
  for (const sl of swimlanes) {
    result.set(String(sl.data.groupFolder || 'bot'), []);
  }
  for (const node of nodes) {
    if (node.type === 'swimlane') continue;
    // Assign to the smallest containing swimlane (handles overlapping containers correctly)
    let bestFolder: string | null = null;
    let bestArea = Infinity;
    for (const sl of swimlanes) {
      const slFolder = String(sl.data.groupFolder || 'bot');
      const slX = sl.position.x;
      const slY = sl.position.y;
      const slW = Number(sl.style?.width ?? sl.data.width ?? 640);
      const slH = Number(sl.style?.height ?? sl.data.height ?? 420);
      if (node.position.x >= slX && node.position.x <= slX + slW &&
          node.position.y >= slY && node.position.y <= slY + slH) {
        const area = slW * slH;
        if (area < bestArea) { bestArea = area; bestFolder = slFolder; }
      }
    }
    if (bestFolder !== null) {
      result.get(bestFolder)!.push(node);
    } else {
      result.get(null)!.push(node);
    }
  }
  return result;
}

function generateClaudeMd(
  folder: string,
  agents: Array<{ data: Record<string, unknown> }>,
  tools:  Array<{ data: Record<string, unknown> }>,
  triggers: Array<{ data: Record<string, unknown> }>,
  outputs: Array<{ data: Record<string, unknown> }> = [],
): string {
  const primary = agents[0].data;
  const name  = String(primary.label  ?? folder);
  const prompt = String(primary.systemPrompt ?? '').trim();

  // ── Tool capabilities ──
  const capLines: string[] = [];
  for (const t of tools) {
    const d = t.data;
    switch (d.toolType) {
      case 'bash': {
        const cmd = String(d.config ?? '').trim();
        const label = String(d.label ?? 'Bash tool');
        if (cmd) {
          // Write the full script so the agent runs exactly this, not a self-invented version
          capLines.push(`- **${label}** — run this exact script when you need price/data:\n\`\`\`bash\n${cmd}\n\`\`\``);
        } else {
          capLines.push(`- Run shell commands (${label})`);
        }
        break;
      }
      case 'search':
        capLines.push('- Search the web for current information');
        break;
      case 'mcp': {
        let server = '';
        let mcpCfg: Record<string, string> = {};
        try { mcpCfg = JSON.parse(String(d.config)); server = mcpCfg.server ?? ''; } catch {}
        if (server === 'ical-calendar') {
          const calName = mcpCfg.calendarName || 'external calendar';
          const url = mcpCfg.url || '';
          capLines.push(`- Fetch ${calName} events via iCal${url ? ` (${url})` : ''} using curl`);
        } else {
          const label = MCP_SERVICE_NAMES[server] ?? (server ? `${server} integration` : 'External service via MCP');
          capLines.push(`- ${label}`);
        }
        break;
      }
    }
  }

  // Extra agents listed as sub-capabilities
  for (const a of agents.slice(1)) {
    capLines.push(`- Delegate to ${String(a.data.label ?? 'sub-agent')}`);
  }

  // ── Trigger description (primary + additionalTriggers) ──
  const triggerDescriptions: string[] = [];
  for (const tr of triggers) {
    const allEntries = [
      { type: String(tr.data.triggerType || ''), config: String(tr.data.config || '') },
      ...((tr.data.additionalTriggers as Array<{ triggerType: string; config: string }> | undefined) ?? [])
        .map(t => ({ type: String(t.triggerType || ''), config: String(t.config || '') })),
    ];
    for (const e of allEntries) {
      switch (e.type) {
        case 'schedule': triggerDescriptions.push(`on a schedule (${e.config.trim() || 'cron'})`); break;
        case 'webhook':  triggerDescriptions.push('when a webhook is called'); break;
        case 'manual':   triggerDescriptions.push('manually'); break;
        default:         triggerDescriptions.push('when a message is received'); break;
      }
    }
  }
  const triggerLine = triggerDescriptions.length > 0
    ? `This agent runs ${triggerDescriptions.join(' and ')}.`
    : '';

  const capsSection = capLines.length > 0
    ? `## What You Can Do\n\n${capLines.join('\n')}`
    : '';

  const triggerSection = triggerLine
    ? `## When You Run\n\n${triggerLine}`
    : '';

  // ── Agent handoff section ──────────────────────────────────────────────────
  const handoffOutput = outputs.find(o => o.data.destination === 'agent_handoff');
  let handoffSection = '';
  if (handoffOutput) {
    const targetFolder = String(handoffOutput.data.targetFolder || '').trim();
    const handoffMessage = String(handoffOutput.data.handoffMessage || '').trim();
    if (targetFolder) {
      const botName = targetFolder.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      const promptTemplate = handoffMessage
        ? handoffMessage.replace('{{input}}', 'your complete output')
        : 'your complete output';
      handoffSection = [
        '## Handoff',
        '',
        `When you finish, immediately trigger the *${botName}* bot using the \`mcp__nanoclaw__schedule_task\` tool:`,
        '',
        '```',
        'schedule_type: "once"',
        `schedule_value: [current UTC time + 5 seconds, ISO 8601 format]`,
        `target_group_jid: "scheduled:${targetFolder}"`,
        `prompt: "${promptTemplate}"`,
        'context_mode: "isolated"',
        '```',
        '',
        `Replace the prompt with the actual content: ${handoffMessage ? `"${handoffMessage.replace('{{input}}', '[your full output here]')}"` : 'your full output text'}.`,
      ].join('\n');
    }
  }

  // ── Guardrails: always injected when there are external tools or a schedule ──
  const isScheduled = triggerDescriptions.some(t => t.includes('schedule'));
  const hasExternalTools = tools.some(t => t.data.toolType === 'mcp' || t.data.toolType === 'bash' || t.data.toolType === 'search');
  const guardrailLines: string[] = [];
  if (isScheduled) {
    guardrailLines.push('**First action every run**: call `mcp__nanoclaw__send_message` with a brief "Starting..." message before doing any work. This confirms the bot is actually running.');
  }
  if (hasExternalTools) {
    guardrailLines.push('**If any external tool fails**: send an error message via `mcp__nanoclaw__send_message` and stop immediately — do not retry more than once.');
  }
  guardrailLines.push('**Never loop or spin**: if you cannot complete the task within a reasonable number of steps, send a brief failure message and stop.');
  const guardrailsSection = `## Guardrails\n\n${guardrailLines.join('\n')}`;

  const BOILERPLATE = [
    '## Communication',
    '',
    'Your output is sent to the user or group.',
    '',
    'You also have `mcp__nanoclaw__send_message` which sends a message immediately while you\'re still working. Use this to acknowledge requests before starting longer work.',
    '',
    '### Internal thoughts',
    '',
    'If part of your output is internal reasoning, wrap it in `<internal>` tags:',
    '',
    '```',
    '<internal>Working through the analysis...</internal>',
    '',
    'Here are the results...',
    '```',
    '',
    '## Memory',
    '',
    'The `conversations/` folder contains searchable history of past conversations. Use this to recall context from previous sessions.',
    '',
    'When you learn something important:',
    '- Create files for structured data (e.g., `preferences.md`, `context.md`)',
    '- Keep an index in your memory for files you create',
    '',
    '## Formatting',
    '',
    'Do NOT use markdown headings (##) in messages. Only use:',
    '- *Bold* (single asterisks — NEVER **double asterisks**)',
    '- _Italic_ (underscores)',
    '- \u2022 for bullets',
    '- ```backticks``` for code',
    'No [links](url), no ## headings.',
  ].join('\n');

  const parts: string[] = [];
  parts.push('# ' + name);
  parts.push('');
  parts.push(prompt);
  if (capsSection) { parts.push(''); parts.push(capsSection); }
  if (triggerSection) { parts.push(''); parts.push(triggerSection); }
  if (handoffSection) { parts.push(''); parts.push(handoffSection); }
  parts.push('');
  parts.push(guardrailsSection);
  parts.push('');
  parts.push(BOILERPLATE);

  return parts.join('\n').trimEnd() + '\n';
}

// ── Plugin ────────────────────────────────────────────────────────────────────

// ── Backup ─────────────────────────────────────────────────────────────────────

async function handleBackup(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const nanoclawPath = detectNanoclawPath();
  if (!nanoclawPath) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Nanoclaw not found — configure NANOCLAW_PATH first' }));
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `claw-studio-backup-${date}.zip`;

  // Items to include, relative to nanoclawPath
  const items: string[] = [];
  const candidates = [
    'groups',
    'store/messages.db',
    '.env',
    'data/env/env',
    'data/session',
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(nanoclawPath, c))) items.push(c);
  }

  if (items.length === 0) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Nothing to back up — no groups or database found' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });

  // Stream zip directly to response
  const zip = spawn('zip', ['-r', '-', ...items], { cwd: nanoclawPath });
  zip.stdout.pipe(res);
  zip.stderr.on('data', (d: Buffer) => console.error('[backup]', d.toString()));
  zip.on('error', (err) => {
    console.error('[backup] spawn error:', err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('zip command failed');
    }
  });
  zip.on('close', (code) => {
    if (code !== 0) {
      console.error(`[backup] zip exited with code ${code}`);
      // Headers already sent — can't change status, but log it.
    }
  });
}

export function chatPlugin(): Plugin {
  return {
    name: 'blueprint-chat-api',
    configureServer(server) {
      // Chat AI endpoint
      server.middlewares.use('/api/chat', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end('Method not allowed');
          return;
        }

        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Accel-Buffering', 'no');

        try {
          const body = JSON.parse(await readBody(req));
          const { messages, graphState, confirmedCommands = [], model = 'auto' } = body as {
            messages: Array<{ role: 'user' | 'assistant'; content: string }>;
            graphState: string;
            confirmedCommands?: string[];
            model?: string;
          };

          res.writeHead(200);

          const result = await runChatWithTools(
            messages, graphState, confirmedCommands, model,
            (event) => { res.write(JSON.stringify(event) + '\n'); },
          );
          res.end(JSON.stringify({ type: 'result', ...result }) + '\n');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[chat-plugin]', msg);
          if (!res.headersSent) res.writeHead(500);
          res.end(JSON.stringify({ type: 'error', error: msg }) + '\n');
        }
      });

      // Setup API (nanoclaw path detection + configuration)
      server.middlewares.use('/api/setup', (req: IncomingMessage, res: ServerResponse) => {
        handleSetup(req, res).catch((err) => {
          console.error('[setup-api]', err);
          if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
        });
      });

      // Config API (API key management)
      server.middlewares.use('/api/config', (req: IncomingMessage, res: ServerResponse) => {
        handleConfig(req, res).catch((err) => {
          console.error('[config-api]', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });

      // Status panel API
      server.middlewares.use('/api/status', (req: IncomingMessage, res: ServerResponse) => {
        handleStatus(req, res).catch((err) => {
          console.error('[status-api]', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });

      // Groups filesystem API
      server.middlewares.use('/api/groups', (req: IncomingMessage, res: ServerResponse) => {
        handleGroups(req, res).catch((err) => {
          console.error('[groups-api]', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });

      // Templates API
      server.middlewares.use('/api/templates', (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
        res.setHeader('Content-Type', 'application/json');
        try {
          const templatesDir = path.resolve(process.cwd(), 'templates');
          if (!fs.existsSync(templatesDir)) {
            res.writeHead(200); res.end(JSON.stringify({ templates: [] })); return;
          }
          const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json'));
          const templates = files.map(f => {
            try {
              const content = JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf-8'));
              return {
                id: f.replace('.json', ''),
                name: content.name ?? f,
                description: content.description ?? '',
                nodeCount: (content.nodes ?? []).length,
                blueprint: content,
              };
            } catch { return null; }
          }).filter(Boolean);
          res.writeHead(200);
          res.end(JSON.stringify({ templates }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      // Backup API
      server.middlewares.use('/api/backup', (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
        handleBackup(req, res).catch((err) => {
          console.error('[backup-api]', err);
          if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
        });
      });
    },
  };
}
