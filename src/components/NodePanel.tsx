import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type {
  AgentModel, BlueprintNodeData, ConditionType, FilePermission,
  MemoryOperation, MemoryScope, OutputDestination, ToolType, TransformType, TriggerType,
} from '../types';
import { AGENT_PRESETS, TOOL_PRESETS } from '../types';

const MODELS: AgentModel[] = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'];
const MODEL_LABELS: Record<AgentModel, string> = {
  'claude-sonnet-4-6': 'Sonnet 4.6 — Best for most tasks',
  'claude-haiku-4-5-20251001': 'Haiku 4.5 — Fastest & cheapest',
  'claude-opus-4-6': 'Opus 4.6 — Most powerful (slow)',
};
const TOOL_TYPES: ToolType[] = ['bash', 'search', 'mcp'];
const TOOL_TYPE_LABELS: Record<ToolType, string> = {
  bash: 'Run a command',
  search: 'Web search',
  mcp: 'Connect to a service (MCP)',
};
const DESTINATIONS: OutputDestination[] = ['telegram', 'file', 'webhook'];
const DESTINATION_LABELS: Record<OutputDestination, string> = {
  telegram: 'Telegram message',
  file: 'Save to file',
  webhook: 'Send to URL',
};
const TRIGGER_TYPES: TriggerType[] = ['message', 'schedule', 'webhook', 'manual'];
const TRIGGER_LABELS: Record<TriggerType, string> = {
  message: 'When a message is received',
  schedule: 'On a schedule (cron)',
  webhook: 'When a URL is called',
  manual: 'Manually triggered',
};
const CONDITION_TYPES: ConditionType[] = ['contains', 'regex', 'equals', 'always_true'];
const CONDITION_LABELS: Record<ConditionType, string> = {
  contains: 'Message contains text',
  regex: 'Matches a pattern (regex)',
  equals: 'Exact match',
  always_true: 'Always (pass everything through)',
};
const TRANSFORM_TYPES: TransformType[] = ['template', 'truncate', 'json_wrap', 'extract'];
const TRANSFORM_LABELS: Record<TransformType, string> = {
  template:  'Fill in a template',
  truncate:  'Trim to a length',
  json_wrap: 'Wrap as JSON',
  extract:   'Extract specific text',
};
const MEMORY_OPS: MemoryOperation[] = ['read', 'write', 'both'];
const MEMORY_OP_LABELS: Record<MemoryOperation, string> = {
  read: 'Read from memory',
  write: 'Write to memory',
  both: 'Read then write',
};
const MEMORY_SCOPES: MemoryScope[] = ['group', 'global'];
const FILE_PERMS: FilePermission[] = ['read', 'readwrite'];
const COMMENT_COLORS = ['#4b5563', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444'];

const SCHEDULE_PRESETS = [
  { label: 'Every day at 8am',          cron: '0 8 * * *' },
  { label: 'Every weekday at 8am',      cron: '0 8 * * 1-5' },
  { label: 'Every weekday at 9am',      cron: '0 9 * * 1-5' },
  { label: 'Every Monday at 9am',       cron: '0 9 * * 1' },
  { label: 'Every hour',                cron: '0 * * * *' },
  { label: 'Every 30 minutes',          cron: '*/30 * * * *' },
  { label: 'Every day at midnight',     cron: '0 0 * * *' },
  { label: 'Every Sunday at 10am',      cron: '0 10 * * 0' },
  { label: 'First day of each month',   cron: '0 8 1 * *' },
];

// Known MCP services the user can pick from a dropdown
const MCP_SERVICE_PRESETS: Array<{ label: string; server: string; defaultConfig: Record<string, string> }> = [
  { label: 'Gmail',                server: 'gmail-mcp',           defaultConfig: { server: 'gmail-mcp', action: 'list_emails', query: 'is:unread newer_than:1d' } },
  { label: 'Google Calendar',      server: 'google-calendar-mcp', defaultConfig: { server: 'google-calendar-mcp', action: 'list_events', timeframe: 'today' } },
  { label: 'Calendar (iCal link)', server: 'ical-calendar',       defaultConfig: { server: 'ical-calendar', url: '', calendarName: 'My Calendar' } },
  { label: 'Weather (OpenWeatherMap)', server: 'openweathermap-mcp', defaultConfig: { server: 'openweathermap-mcp', action: 'current_weather', location: 'YOUR_CITY', apiKey: 'YOUR_API_KEY' } },
  { label: 'News headlines',       server: 'newsapi-mcp',         defaultConfig: { server: 'newsapi-mcp', action: 'top_headlines', category: 'general', apiKey: 'YOUR_API_KEY' } },
];

// ── MCP config parser ───────────────────────────────────────────────────────
// Known MCP services with human-friendly setup info
const MCP_SERVICE_INFO: Record<string, {
  name: string;
  description: string;
  setup: string[];
  keyFields: string[];
  oauthBased?: boolean;
}> = {
  'gmail-mcp': {
    name: 'Gmail',
    description: 'Reads, labels, and organizes your Gmail inbox.',
    setup: [
      'Gmail uses OAuth — no API key needed.',
      'Run /add-gmail in nanoclaw to authorize access (one-time setup).',
      'Once authorized, the bot connects automatically.',
    ],
    keyFields: ['action', 'query'],
    oauthBased: true,
  },
  'google-calendar-mcp': {
    name: 'Google Calendar',
    description: 'Reads events from your Google Calendar.',
    setup: [
      'Google Calendar uses OAuth — no API key needed.',
      'Run /add-gmail in nanoclaw (Gmail and Calendar share the same authorization).',
      'Once authorized, your primary calendar is used automatically.',
    ],
    keyFields: ['action', 'timeframe'],
    oauthBased: true,
  },
  'ical-calendar': {
    name: 'Calendar (iCal link)',
    description: 'Reads events from any calendar that provides an iCal/ICS link — Apple Calendar, Fastmail, Proton, Nextcloud, and many others.',
    setup: [
      'Find the iCal/ICS sharing link in your calendar app.',
      'In most apps: right-click a calendar → Share → Copy iCal link.',
      'Paste the full URL (starts with https://) into the URL field below.',
      'Add one node per calendar if you have multiple.',
    ],
    keyFields: ['url', 'calendarName'],
    oauthBased: false,
  },
  'openweathermap-mcp': {
    name: 'OpenWeatherMap',
    description: 'Gets current weather and forecasts.',
    setup: [
      'Sign up free at openweathermap.org/api.',
      'Copy your API key from the dashboard.',
      'Replace YOUR_API_KEY in the config below with your key.',
      'Replace YOUR_CITY with your city name (e.g. "Oslo" or "New York").',
    ],
    keyFields: ['location', 'apiKey'],
  },
  'newsapi-mcp': {
    name: 'NewsAPI',
    description: 'Fetches top headlines and news articles.',
    setup: [
      'Sign up free at newsapi.org.',
      'Copy your API key from the dashboard.',
      'Replace YOUR_API_KEY in the config below with your key.',
    ],
    keyFields: ['category', 'apiKey'],
  },
};

function parseMcpConfig(config: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(config);
    if (typeof parsed === 'object' && parsed !== null) {
      return Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, String(v)])
      );
    }
  } catch {
    // not valid JSON
  }
  return null;
}

function buildMcpConfig(fields: Record<string, string>): string {
  return JSON.stringify(fields, null, 2);
}

// ── MCP config editor ───────────────────────────────────────────────────────
function McpConfigEditor({
  config,
  onChange,
}: {
  config: string;
  onChange: (value: string) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const parsed = parseMcpConfig(config);
  const serverName = parsed?.server ?? '';
  const serviceInfo = MCP_SERVICE_INFO[serverName];

  function updateField(key: string, value: string) {
    const current = parseMcpConfig(config) ?? {};
    onChange(buildMcpConfig({ ...current, [key]: value }));
  }

  return (
    <div className="mcp-editor">
      {/* Service setup guide */}
      {serviceInfo && (
        <div className="mcp-setup-guide">
          <div className="mcp-setup-guide__title">
            <span className="mcp-setup-guide__icon">🔌</span>
            {serviceInfo.name} — Setup Steps
          </div>
          <ol className="mcp-setup-guide__steps">
            {serviceInfo.setup.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <p className="mcp-setup-guide__desc">{serviceInfo.description}</p>
        </div>
      )}

      {/* Friendly field editors for known configs */}
      {parsed && !showRaw && (
        <div className="mcp-fields">
          {Object.entries(parsed).map(([key, value]) => {
            // OAuth-based services don't need API keys — never flag their fields as needing values
            const isPlaceholder = value.startsWith('YOUR_') && !serviceInfo?.oauthBased;
            return (
              <div key={key} className="mcp-field">
                <label className="mcp-field__label">{key}</label>
                <input
                  className={`mcp-field__input ${isPlaceholder ? 'mcp-field__input--needs-value' : ''}`}
                  value={value}
                  onChange={(e) => updateField(key, e.target.value)}
                  placeholder={`Enter ${key}`}
                />
                {isPlaceholder && (
                  <span className="mcp-field__hint">⚠ Replace this with your actual value</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Raw JSON fallback */}
      {(!parsed || showRaw) && (
        <textarea
          className="mcp-raw"
          value={config}
          rows={6}
          placeholder={'{\n  "server": "my-mcp-server",\n  "action": "do_something"\n}'}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      <button
        className="mcp-toggle-raw"
        onClick={() => setShowRaw((s) => !s)}
      >
        {showRaw ? '← Back to simple view' : 'Edit raw JSON'}
      </button>
    </div>
  );
}

// ── Help text per field ─────────────────────────────────────────────────────
function HelpText({ children }: { children: string }) {
  return <p className="field-help">{children}</p>;
}

// ── Main NodePanel ──────────────────────────────────────────────────────────
export function NodePanel() {
  const { nodes, selectedNodeId, selectNode, updateNodeData, deleteNode } = useStore();
  const [customCronMode, setCustomCronMode] = useState(false);

  // When selected node changes, derive whether it already has a custom cron
  useEffect(() => {
    const d = nodes.find(n => n.id === selectedNodeId)?.data as BlueprintNodeData | undefined;
    setCustomCronMode(
      d?.kind === 'trigger' &&
      !!(d as { config?: string }).config &&
      !SCHEDULE_PRESETS.some(p => p.cron === (d as { config?: string }).config)
    );
  }, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const node = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
  const isOpen = !!node;
  const data = node?.data as BlueprintNodeData | undefined;
  const update = (patch: Partial<BlueprintNodeData>) => {
    if (selectedNodeId) updateNodeData(selectedNodeId, patch);
  };

  return (
    <div className={`node-panel ${isOpen ? 'node-panel--open' : ''}`}>
    {isOpen && data && (<>
      <div className="node-panel__header">
        <span className={`node-panel__kind-badge kind--${data.kind}`}>{data.kind.toUpperCase()}</span>
        <button className="node-panel__close" onClick={() => selectNode(null)}>✕</button>
      </div>

      {/* Label — not shown for comment nodes */}
      {data.kind !== 'comment' && (
        <div className="node-panel__field">
          <label>Name</label>
          <input
            value={(data as { label: string }).label}
            onChange={(e) => update({ label: e.target.value } as Partial<BlueprintNodeData>)}
            placeholder="Give this node a descriptive name"
          />
          <HelpText>The name shown on the canvas. Use something that describes what this step does.</HelpText>
        </div>
      )}

      {/* ── Trigger ── */}
      {data.kind === 'trigger' && (
        <>
          <div className="node-panel__field">
            <label>When does this run?</label>
            <select
              value={data.triggerType}
              onChange={(e) => update({ triggerType: e.target.value as TriggerType } as Partial<BlueprintNodeData>)}
            >
              {TRIGGER_TYPES.map((t) => (
                <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
              ))}
            </select>
          </div>
          {data.triggerType === 'schedule' && (
            <>
              <div className="node-panel__field">
                <label>When should this run?</label>
                <select
                  value={customCronMode ? '__custom__' : (SCHEDULE_PRESETS.find(p => p.cron === data.config)?.cron ?? '')}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setCustomCronMode(true);
                      // Don't touch config — user will edit it in the custom input below
                    } else {
                      setCustomCronMode(false);
                      update({ config: e.target.value } as Partial<BlueprintNodeData>);
                    }
                  }}
                >
                  <option value="">— pick a schedule —</option>
                  {SCHEDULE_PRESETS.map((p) => (
                    <option key={p.cron} value={p.cron}>{p.label}</option>
                  ))}
                  <option value="__custom__">Custom (advanced)…</option>
                </select>
                <HelpText>Choose how often the bot should run automatically.</HelpText>
              </div>
              {customCronMode && (
                <div className="node-panel__field">
                  <label>Custom schedule (cron expression)</label>
                  <input
                    value={data.config}
                    placeholder="0 8 * * 1-5"
                    autoFocus
                    onChange={(e) => update({ config: e.target.value } as Partial<BlueprintNodeData>)}
                  />
                  <HelpText>Format: minute hour day month weekday. Example: "0 8 * * 1-5" = weekdays at 8am.</HelpText>
                </div>
              )}
            </>
          )}
          {data.triggerType === 'webhook' && (
            <div className="node-panel__field">
              <label>Webhook path</label>
              <input
                value={data.config}
                placeholder="/webhook/my-trigger"
                onChange={(e) => update({ config: e.target.value } as Partial<BlueprintNodeData>)}
              />
              <HelpText>The URL path that will start this pipeline when called.</HelpText>
            </div>
          )}
          {data.triggerType === 'message' && (
            <div className="node-panel__field">
              <label>Trigger pattern (optional)</label>
              <input
                value={data.config}
                placeholder="e.g. morning briefing"
                onChange={(e) => update({ config: e.target.value } as Partial<BlueprintNodeData>)}
              />
              <HelpText>Only trigger on messages containing this text. Leave blank to run on all messages.</HelpText>
            </div>
          )}
        </>
      )}

      {/* ── Agent ── */}
      {data.kind === 'agent' && (
        <>
          {AGENT_PRESETS.length > 0 && (
            <div className="node-panel__field">
              <label>Load a preset</label>
              <select
                value=""
                onChange={(e) => {
                  const preset = AGENT_PRESETS.find((p) => p.label === e.target.value);
                  if (preset) update({ label: preset.label, model: preset.model, systemPrompt: preset.systemPrompt } as Partial<BlueprintNodeData>);
                }}
              >
                <option value="">— choose a preset —</option>
                {AGENT_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
              <HelpText>Presets fill in a ready-made role. You can customize it after applying.</HelpText>
            </div>
          )}
          <div className="node-panel__field">
            <label>AI model</label>
            <select
              value={data.model}
              onChange={(e) => update({ model: e.target.value as AgentModel } as Partial<BlueprintNodeData>)}
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>{MODEL_LABELS[m]}</option>
              ))}
            </select>
            <HelpText>Sonnet is the best starting point. Use Haiku for simple/fast tasks, Opus for complex reasoning.</HelpText>
          </div>
          <div className="node-panel__field">
            <label>Instructions (system prompt)</label>
            <textarea
              value={data.systemPrompt}
              rows={8}
              placeholder="Describe what this AI should do, its personality, what it should focus on, and how it should format its responses..."
              onChange={(e) => update({ systemPrompt: e.target.value } as Partial<BlueprintNodeData>)}
            />
            <HelpText>This is the AI's job description. Be specific — tell it exactly what to do, what tone to use, and what to include in its response.</HelpText>
          </div>
        </>
      )}

      {/* ── Tool ── */}
      {data.kind === 'tool' && (
        <>
          {TOOL_PRESETS.length > 0 && (
            <div className="node-panel__field">
              <label>Load a preset</label>
              <select
                value=""
                onChange={(e) => {
                  const preset = TOOL_PRESETS.find((p) => p.label === e.target.value);
                  if (preset) update({ label: preset.label, toolType: preset.toolType, config: preset.config } as Partial<BlueprintNodeData>);
                }}
              >
                <option value="">— choose a preset —</option>
                {TOOL_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="node-panel__field">
            <label>What kind of tool?</label>
            <select
              value={data.toolType}
              onChange={(e) => update({ toolType: e.target.value as ToolType } as Partial<BlueprintNodeData>)}
            >
              {TOOL_TYPES.map((t) => (
                <option key={t} value={t}>{TOOL_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <HelpText>
              {data.toolType === 'bash'
                ? 'The agent will run this shell command and read the output.'
                : data.toolType === 'search'
                  ? 'Gives the agent the ability to search the web. No configuration needed.'
                  : 'MCP (Model Context Protocol) is a plugin system that connects the agent to external services like Gmail, Calendar, weather APIs, and more.'}
            </HelpText>
          </div>

          {data.toolType === 'bash' && (
            <div className="node-panel__field">
              <label>Command to run</label>
              <textarea
                value={data.config}
                rows={4}
                placeholder="e.g.  date\ncurl https://api.example.com/data\npython3 /workspace/script.py"
                onChange={(e) => update({ config: e.target.value } as Partial<BlueprintNodeData>)}
              />
              <HelpText>The agent will run this command in its sandbox and use the output as information. You can run scripts, fetch URLs, or check system info.</HelpText>
              {!data.config && (
                <div className="node-panel__field--info" style={{ marginTop: 6 }}>
                  <span className="field-info-icon">💡</span>
                  <span>Need weather or air quality data? Load a preset above — yr.no provides free global forecasts with no API key.</span>
                </div>
              )}
            </div>
          )}

          {data.toolType === 'search' && (
            <div className="node-panel__field node-panel__field--info">
              <span className="field-info-icon">ℹ</span>
              No configuration needed. The agent will automatically search the web when it needs information.
            </div>
          )}

          {data.toolType === 'mcp' && (
            <>
              <div className="node-panel__field">
                <label>Which service?</label>
                <select
                  value={(() => { try { return JSON.parse(data.config).server ?? ''; } catch { return ''; } })()}
                  onChange={(e) => {
                    const preset = MCP_SERVICE_PRESETS.find(p => p.server === e.target.value);
                    if (preset) update({ config: JSON.stringify(preset.defaultConfig, null, 2) } as Partial<BlueprintNodeData>);
                  }}
                >
                  <option value="">— pick a service —</option>
                  {MCP_SERVICE_PRESETS.map((p) => (
                    <option key={p.server} value={p.server}>{p.label}</option>
                  ))}
                  <option value="__custom__">Other (custom)…</option>
                </select>
                <HelpText>Choose the external service this tool connects to. The config fields will appear below.</HelpText>
              </div>
              <div className="node-panel__field">
                <label>Service configuration</label>
                <McpConfigEditor
                  config={data.config}
                  onChange={(v) => update({ config: v } as Partial<BlueprintNodeData>)}
                />
              </div>
            </>
          )}
        </>
      )}

      {/* ── Router ── */}
      {data.kind === 'router' && (
        <>
          <div className="node-panel__field">
            <label>Routing instructions</label>
            <textarea
              value={data.routingPrompt}
              rows={4}
              placeholder="e.g. Route to 'Urgent' if the message mentions a deadline today, otherwise route to 'Normal'."
              onChange={(e) => update({ routingPrompt: e.target.value } as Partial<BlueprintNodeData>)}
            />
            <HelpText>The AI reads this and decides which branch to follow. Be specific about when to choose each option.</HelpText>
          </div>
          <div className="node-panel__field">
            <label>Branches (one per line)</label>
            <textarea
              value={data.branches.join('\n')}
              rows={4}
              placeholder={"Urgent\nNormal\nSpam"}
              onChange={(e) =>
                update({ branches: e.target.value.split('\n').filter(Boolean) } as Partial<BlueprintNodeData>)
              }
            />
            <HelpText>Each line becomes a separate output path on the canvas. Connect each branch to the next step in that path.</HelpText>
          </div>
        </>
      )}

      {/* ── Output ── */}
      {data.kind === 'output' && (
        <>
          <div className="node-panel__field">
            <label>Where to send the result</label>
            <select
              value={data.destination}
              onChange={(e) => update({ destination: e.target.value as OutputDestination } as Partial<BlueprintNodeData>)}
            >
              {DESTINATIONS.map((d) => (
                <option key={d} value={d}>{DESTINATION_LABELS[d]}</option>
              ))}
            </select>
          </div>
          {data.destination === 'file' && (
            <div className="node-panel__field">
              <label>File path</label>
              <input
                value={data.config}
                placeholder="/workspace/output.md"
                onChange={(e) => update({ config: e.target.value } as Partial<BlueprintNodeData>)}
              />
              <HelpText>The file will be saved in the agent's workspace. Use .md for text, .json for structured data.</HelpText>
            </div>
          )}
          {data.destination === 'webhook' && (
            <div className="node-panel__field">
              <label>Webhook URL</label>
              <input
                value={data.config}
                placeholder="https://hooks.zapier.com/hooks/catch/..."
                onChange={(e) => update({ config: e.target.value } as Partial<BlueprintNodeData>)}
              />
              <HelpText>The agent's response will be sent as a POST request to this URL. Works with Zapier, Make, or any webhook receiver.</HelpText>
            </div>
          )}
          {data.destination === 'telegram' && (
            <div className="node-panel__field node-panel__field--info">
              <span className="field-info-icon">ℹ</span>
              The result will be sent as a Telegram message to the same chat that triggered this pipeline. No extra configuration needed.
            </div>
          )}
        </>
      )}

      {/* ── Condition ── */}
      {data.kind === 'condition' && (
        <>
          <div className="node-panel__field">
            <label>Check type</label>
            <select
              value={data.conditionType}
              onChange={(e) => update({ conditionType: e.target.value as ConditionType } as Partial<BlueprintNodeData>)}
            >
              {CONDITION_TYPES.map((t) => (
                <option key={t} value={t}>{CONDITION_LABELS[t]}</option>
              ))}
            </select>
            <HelpText>This node splits the flow without using AI — it's faster and cheaper than a router for simple yes/no decisions.</HelpText>
          </div>
          {data.conditionType !== 'always_true' && (
            <div className="node-panel__field">
              <label>
                {data.conditionType === 'contains' && 'Text to look for'}
                {data.conditionType === 'regex' && 'Pattern (regex)'}
                {data.conditionType === 'equals' && 'Exact text to match'}
              </label>
              <input
                value={data.value}
                placeholder={
                  data.conditionType === 'regex' ? '/^error/i' :
                  data.conditionType === 'contains' ? 'urgent' : 'exact match text'
                }
                onChange={(e) => update({ value: e.target.value } as Partial<BlueprintNodeData>)}
              />
            </div>
          )}
          <div className="node-panel__field node-panel__field--info">
            <span className="field-info-icon">ℹ</span>
            Connect the <strong>true</strong> output to what happens when the condition matches, and <strong>false</strong> to the fallback path.
          </div>
        </>
      )}

      {/* ── Transform ── */}
      {data.kind === 'transform' && (
        <>
          <div className="node-panel__field">
            <label>Transform type</label>
            <select
              value={data.transformType}
              onChange={(e) => update({ transformType: e.target.value as TransformType } as Partial<BlueprintNodeData>)}
            >
              {TRANSFORM_TYPES.map((t) => (
                <option key={t} value={t}>{TRANSFORM_LABELS[t]}</option>
              ))}
            </select>
            <HelpText>
              {data.transformType === 'template'
                ? 'Insert data into a text template using {{variable}} placeholders.'
                : data.transformType === 'truncate'
                  ? 'Cut the text to a maximum length (useful before sending to an agent with limited context).'
                  : data.transformType === 'json_wrap'
                    ? 'Wrap the output in a JSON object for passing structured data.'
                    : 'Pull a specific piece of information from the input text.'}
            </HelpText>
          </div>
          <div className="node-panel__field">
            <label>
              {data.transformType === 'template' ? 'Template' :
               data.transformType === 'truncate' ? 'Max characters' : 'Config'}
            </label>
            <textarea
              value={data.config}
              rows={4}
              placeholder={
                data.transformType === 'template' ? 'Good morning! Here is your briefing:\n\n{{input}}' :
                data.transformType === 'truncate' ? '2000' : ''
              }
              onChange={(e) => update({ config: e.target.value } as Partial<BlueprintNodeData>)}
            />
          </div>
        </>
      )}

      {/* ── Memory ── */}
      {data.kind === 'memory' && (
        <>
          <div className="node-panel__field">
            <label>What to do with memory</label>
            <select
              value={data.operation}
              onChange={(e) => update({ operation: e.target.value as MemoryOperation } as Partial<BlueprintNodeData>)}
            >
              {MEMORY_OPS.map((o) => (
                <option key={o} value={o}>{MEMORY_OP_LABELS[o]}</option>
              ))}
            </select>
            <HelpText>Memory lets the bot remember information between conversations. Use it to track user preferences, past results, or any data that should persist.</HelpText>
          </div>
          <div className="node-panel__field">
            <label>Scope</label>
            <select
              value={data.scope}
              onChange={(e) => update({ scope: e.target.value as MemoryScope } as Partial<BlueprintNodeData>)}
            >
              {MEMORY_SCOPES.map((s) => (
                <option key={s} value={s}>{s === 'group' ? 'This group only' : 'Shared across all groups'}</option>
              ))}
            </select>
          </div>
          <div className="node-panel__field">
            <label>Memory key (optional)</label>
            <input
              value={data.key}
              placeholder="e.g. user_preferences"
              onChange={(e) => update({ key: e.target.value } as Partial<BlueprintNodeData>)}
            />
            <HelpText>A label for what's stored. Leave blank to use the whole memory, or set a key to read/write a specific value.</HelpText>
          </div>
        </>
      )}

      {/* ── File ── */}
      {data.kind === 'file' && (
        <>
          <div className="node-panel__field">
            <label>File or folder path</label>
            <input
              value={data.path}
              placeholder="/workspace/my-data"
              onChange={(e) => update({ path: e.target.value } as Partial<BlueprintNodeData>)}
            />
            <HelpText>The path inside the agent's isolated workspace. All agents start in /workspace. Files saved here persist between runs.</HelpText>
          </div>
          <div className="node-panel__field">
            <label>Access level</label>
            <select
              value={data.permissions}
              onChange={(e) => update({ permissions: e.target.value as FilePermission } as Partial<BlueprintNodeData>)}
            >
              {FILE_PERMS.map((p) => (
                <option key={p} value={p}>{p === 'read' ? 'Read only' : 'Read and write'}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* ── Comment ── */}
      {data.kind === 'comment' && (
        <>
          <div className="node-panel__field">
            <label>Note text</label>
            <textarea
              value={data.text}
              rows={5}
              placeholder="Describe what this part of the pipeline does..."
              onChange={(e) => update({ text: e.target.value } as Partial<BlueprintNodeData>)}
            />
            <HelpText>Sticky notes are for you — they don't affect how the pipeline runs. Use them to document your design.</HelpText>
          </div>
          <div className="node-panel__field">
            <label>Color</label>
            <div className="node-panel__color-row">
              {COMMENT_COLORS.map((c) => (
                <button
                  key={c}
                  className={`node-panel__color-swatch ${data.color === c ? 'node-panel__color-swatch--active' : ''}`}
                  style={{ background: c }}
                  onClick={() => update({ color: c } as Partial<BlueprintNodeData>)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <div className="node-panel__footer">
        <button className="btn-danger" onClick={() => deleteNode(selectedNodeId!)}>Delete Node</button>
      </div>
    </>)}
    </div>
  );
}
