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

function executeCommand(cmd: string, nanoclawPath: string): { output: string; ok: boolean } {
  try {
    const output = execSync(cmd, {
      cwd: nanoclawPath,
      timeout: 60_000,
      maxBuffer: 512 * 1024,
      encoding: 'utf-8',
      env: { ...process.env, HOME: process.env.HOME ?? '' },
    });
    return { output: String(output).trim() || '(no output)', ok: true };
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
    const out = e.stdout ? String(e.stdout).trim() : '';
    const errOut = e.stderr ? String(e.stderr).trim() : (e.message ?? String(err));
    return { output: [out, errOut].filter(Boolean).join('\n') || String(err), ok: false };
  }
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
- label, triggerType (message | schedule | webhook | manual), config
- schedule config: cron expression like "0 8 * * 1-5" (weekdays at 8am)

**agent** — The AI brain that thinks and decides
- label, model (claude-opus-4-6 | claude-sonnet-4-6 | claude-haiku-4-5-20251001), systemPrompt
- Use Opus for complex reasoning, Sonnet for general work, Haiku for fast/cheap tasks
- Write detailed, specific system prompts — they define the agent's personality and behavior

**tool** — Connects the agent to the outside world
- label, toolType (bash | search | mcp), config
- bash: a shell command the agent can run
- search: web search capability (no config needed)
- mcp: a plugin that connects to an external service (Gmail, Calendar, Weather, etc.)
  - MCP config format: {"server": "server-name", "action": "action.name"}
  - Common servers: gmail-mcp, google-calendar-mcp, openweathermap-mcp, newsapi-mcp

**condition** — Branch based on a simple rule (no AI needed)
- label, conditionType (contains | regex | equals | always_true), value
- Has two output handles: "true" and "false"

**router** — Let the AI decide which branch to take
- label, routingPrompt, branches (array of branch names)
- Branch handles: "branch-0", "branch-1", etc.

**transform** — Reshape or format data
- label, transformType (template | truncate | json_wrap | extract), config

**memory** — Remember things between conversations
- label, operation (read | write | both), scope (group | global), key (optional)

**file** — Read or write files in the agent's workspace
- label, path, permissions (read | readwrite)

**output** — Send the result somewhere
- label, destination (telegram | file | webhook), config

**comment** — A sticky note on the canvas to explain the design
- text, color (hex)

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

## Free Data Sources (no API key needed)

**Weather & Air Quality — yr.no / MET Norway**
Use a **bash tool** (not MCP) for weather. yr.no is free, open data (CC BY 4.0), requires no API key — just a User-Agent header.

Weather forecast bash command:
~~~
CITY="Oslo, Norway"
COORDS=$(curl -s -A "nanoclaw/1.0" "https://nominatim.openstreetmap.org/search?q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$CITY'))")&format=json&limit=1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['lat'], d[0]['lon'])")
LAT=$(echo $COORDS | awk '{print $1}'); LON=$(echo $COORDS | awk '{print $2}')
curl -s -A "nanoclaw/1.0" "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=$LAT&lon=$LON"
~~~

Air quality bash command (same pattern but endpoint: https://api.met.no/weatherapi/airqualityforecast/0.1/?lat=$LAT&lon=$LON)

When a user asks for a weather or air quality pipeline, ALWAYS use the yr.no bash approach — tell them to change the CITY variable. Do NOT suggest OpenWeatherMap or any API-key-based weather service unless the user specifically asks for it.

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
  "operations": [array of canvas operations, empty if no changes needed]
}

Operation types:
- {"op": "clear"}
- {"op": "addNode", "tempId": "t1", "kind": "trigger", "label": "...", "triggerType": "message", "config": "", "x": 200, "y": 80}
- {"op": "addNode", "tempId": "t2", "kind": "agent", "label": "...", "model": "claude-sonnet-4-6", "systemPrompt": "...", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t3", "kind": "tool", "label": "...", "toolType": "bash", "config": "...", "x": 200, "y": 520}
- {"op": "addNode", "tempId": "t4", "kind": "condition", "label": "...", "conditionType": "contains", "value": "...", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t5", "kind": "router", "label": "...", "routingPrompt": "...", "branches": ["Option A", "Option B"], "x": 200, "y": 520}
- {"op": "addNode", "tempId": "t6", "kind": "transform", "label": "...", "transformType": "template", "config": "...", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t7", "kind": "memory", "label": "...", "operation": "read", "scope": "group", "key": "ctx", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t8", "kind": "file", "label": "...", "path": "/workspace", "permissions": "readwrite", "x": 200, "y": 300}
- {"op": "addNode", "tempId": "t9", "kind": "output", "label": "...", "destination": "telegram", "config": "", "x": 200, "y": 740}
- {"op": "addNode", "tempId": "t10", "kind": "comment", "label": "Comment", "text": "...", "color": "#4b5563", "x": 400, "y": 80}
- {"op": "connect", "from": "t1", "to": "t2"}
- {"op": "connect", "from": "t4", "to": "t5", "handle": "true"}
- {"op": "connect", "from": "t5", "to": "t6", "handle": "branch-0"}
- {"op": "updateNode", "id": "node-5", "data": {"label": "New Name"}}
- {"op": "deleteNode", "id": "node-5"}

For pure questions with no canvas changes, set "operations" to [].

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

// ── Agentic chat loop with tools ──────────────────────────────────────────────

type CommandLogEntry = { cmd: string; output: string; ok: boolean; description: string };

interface ChatApiResponse {
  message: string;
  operations?: unknown[];
  commandLog?: CommandLogEntry[];
  pendingCommand?: { cmd: string; description: string };
}

async function runChatWithTools(
  messages: Array<{ role: string; content: string }>,
  graphState: string,
  confirmedCommands: string[],
): Promise<ChatApiResponse> {
  const nanoclawPath = detectNanoclawPath();
  const client = makeClient();
  const systemWithGraph = graphState ? `${SYSTEM}\n\n## Current Canvas\n\n${graphState}` : SYSTEM;
  const commandLog: CommandLogEntry[] = [];

  let apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  for (let turn = 0; turn < 12; turn++) {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      system: systemWithGraph,
      tools: SETUP_TOOLS,
      tool_choice: { type: 'auto' },
      messages: apiMessages,
    });

    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find((b) => b.type === 'text');
      const rawText = textBlock?.type === 'text' ? textBlock.text : '{}';
      const first = rawText.indexOf('{');
      const last = rawText.lastIndexOf('}');
      if (first === -1 || last === -1) throw new Error('No JSON in response');
      const parsed = JSON.parse(rawText.slice(first, last + 1)) as ChatApiResponse;
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
          const exec = executeCommand(command, nanoclawPath);
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
        .map((e) => ({
          folder: e.name,
          hasBlueprint: fs.existsSync(path.join(GROUPS_DIR, e.name, 'blueprint.json')),
          hasClaude: fs.existsSync(path.join(GROUPS_DIR, e.name, 'CLAUDE.md')),
        }));
      res.writeHead(200);
      res.end(JSON.stringify({ groups }));
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
      const Database = _require(path.join(nanoclawPath, 'node_modules', 'better-sqlite3'));
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
              const Database = _require(path.join(nanoclawPath, 'node_modules', 'better-sqlite3'));
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
      const body = JSON.parse(await readBody(req)) as { channelJid: string };
      if (!body.channelJid) { res.writeHead(400); res.end(JSON.stringify({ error: 'channelJid required' })); return; }
      const nanoclawPath = detectNanoclawPath();
      if (!nanoclawPath) { res.writeHead(503); res.end(JSON.stringify({ error: 'Nanoclaw not found' })); return; }
      const DB_PATH = path.join(nanoclawPath, 'store', 'messages.db');
      const Database = _require(path.join(nanoclawPath, 'node_modules', 'better-sqlite3'));
      const db = new Database(DB_PATH);
      const displayName = folder.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      db.prepare(`
        INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, requires_trigger, is_main, container_config)
        VALUES (?, ?, ?, '@', datetime('now'), 0, 0, ?)
      `).run(`scheduled:${folder}`, displayName, folder, JSON.stringify({ outputJid: body.channelJid }));
      db.close();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
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
      const nodes: Array<{ type: string; data: Record<string, unknown> }> = body.nodes ?? [];

      const agents   = nodes.filter(n => n.type === 'agent');
      const tools    = nodes.filter(n => n.type === 'tool');
      const triggers = nodes.filter(n => n.type === 'trigger');
      const outputs  = nodes.filter(n => n.type === 'output');

      if (agents.length === 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Blueprint must have at least one Agent node to deploy.' }));
        return;
      }

      const content = generateClaudeMd(folder, agents, tools, triggers);

      if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });
      fs.writeFileSync(claudePath, content, 'utf-8');

      // ── Track what was done vs what needs manual steps ──
      const done: string[] = [`CLAUDE.md written to groups/${folder}/CLAUDE.md`];
      const manual: string[] = [];

      if (triggers.length === 0) {
        manual.push('No trigger node — add a Trigger node so the bot knows when to run');
      }
      if (outputs.length === 0) {
        manual.push('No output node — add an Output node so the bot can send messages somewhere');
      }

      // ── Register schedule tasks ──
      const scheduleTriggers = triggers.filter(n => n.data.triggerType === 'schedule');
      for (const tr of scheduleTriggers) {
        const cronExpr = String(tr.data.config || '').trim();
        if (!cronExpr) {
          manual.push(`Schedule trigger "${tr.data.label ?? 'Schedule'}" — set a cron expression (e.g. "0 8 * * *" for 8am daily)`);
          continue;
        }
        const registered = tryRegisterSchedule(folder, cronExpr, String(tr.data.label ?? 'Scheduled task'));
        if (registered) {
          done.push(`Schedule registered: "${cronExpr}" — runs automatically`);
        } else {
          manual.push(`__UNREGISTERED_SCHEDULE__:${cronExpr}`);
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

      // ── Flag empty schedule triggers ──
      for (const tr of triggers) {
        if (tr.data.triggerType === 'schedule' && !String(tr.data.config || '').trim()) {
          // already handled above
        } else if (tr.data.triggerType === 'webhook' && !String(tr.data.config || '').trim()) {
          manual.push(`Webhook trigger "${tr.data.label ?? 'Webhook'}" — set the incoming webhook URL or path`);
        }
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

function generateClaudeMd(
  folder: string,
  agents: Array<{ data: Record<string, unknown> }>,
  tools:  Array<{ data: Record<string, unknown> }>,
  triggers: Array<{ data: Record<string, unknown> }>,
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
        capLines.push(`- Run shell commands${cmd ? `: \`${cmd.split('\n')[0]}\`` : ''}`);
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

  // ── Trigger description ──
  let triggerLine = '';
  if (triggers.length > 0) {
    const tr = triggers[0].data;
    switch (tr.triggerType) {
      case 'schedule':
        triggerLine = `This agent runs automatically on a schedule (${String(tr.config || 'cron').trim()}).`;
        break;
      case 'webhook':
        triggerLine = `This agent is triggered by an incoming webhook call.`;
        break;
      case 'manual':
        triggerLine = `This agent is triggered manually.`;
        break;
      default:
        triggerLine = `This agent responds to incoming messages.`;
    }
  }

  const capsSection = capLines.length > 0
    ? `## What You Can Do\n\n${capLines.join('\n')}`
    : '';

  const triggerSection = triggerLine
    ? `## When You Run\n\n${triggerLine}`
    : '';

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

        res.setHeader('Content-Type', 'application/json');

        try {
          const body = JSON.parse(await readBody(req));
          const { messages, graphState, confirmedCommands = [] } = body as {
            messages: Array<{ role: 'user' | 'assistant'; content: string }>;
            graphState: string;
            confirmedCommands?: string[];
          };

          const result = await runChatWithTools(messages, graphState, confirmedCommands);
          res.writeHead(200);
          res.end(JSON.stringify(result));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[chat-plugin]', msg);
          res.writeHead(500);
          res.end(JSON.stringify({ error: msg }));
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
