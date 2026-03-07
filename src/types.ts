export type NodeKind =
  | 'agent' | 'tool' | 'router' | 'output'
  | 'trigger' | 'condition' | 'transform' | 'memory' | 'file' | 'comment';

export type AgentModel =
  | 'claude-opus-4-6'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5-20251001';

export type ToolType = 'bash' | 'search' | 'mcp';
export type OutputDestination = 'telegram' | 'file' | 'webhook';
export type TriggerType = 'message' | 'schedule' | 'webhook' | 'manual';
export type ConditionType = 'contains' | 'regex' | 'equals' | 'always_true';
export type TransformType = 'template' | 'truncate' | 'json_wrap' | 'extract';
export type MemoryOperation = 'read' | 'write' | 'both';
export type MemoryScope = 'group' | 'global';
export type FilePermission = 'read' | 'readwrite';

export interface AgentNodeData extends Record<string, unknown> {
  kind: 'agent'; label: string; model: AgentModel; systemPrompt: string;
}
export interface ToolNodeData extends Record<string, unknown> {
  kind: 'tool'; label: string; toolType: ToolType; config: string;
}
export interface RouterNodeData extends Record<string, unknown> {
  kind: 'router'; label: string; routingPrompt: string; branches: string[];
}
export interface OutputNodeData extends Record<string, unknown> {
  kind: 'output'; label: string; destination: OutputDestination; config: string;
}
export interface TriggerNodeData extends Record<string, unknown> {
  kind: 'trigger'; label: string; triggerType: TriggerType; config: string;
}
export interface ConditionNodeData extends Record<string, unknown> {
  kind: 'condition'; label: string; conditionType: ConditionType; value: string;
}
export interface TransformNodeData extends Record<string, unknown> {
  kind: 'transform'; label: string; transformType: TransformType; config: string;
}
export interface MemoryNodeData extends Record<string, unknown> {
  kind: 'memory'; label: string; operation: MemoryOperation; scope: MemoryScope; key: string;
}
export interface FileNodeData extends Record<string, unknown> {
  kind: 'file'; label: string; path: string; permissions: FilePermission;
}
export interface CommentNodeData extends Record<string, unknown> {
  kind: 'comment'; text: string; color: string;
}

export type BlueprintNodeData =
  | AgentNodeData | ToolNodeData | RouterNodeData | OutputNodeData
  | TriggerNodeData | ConditionNodeData | TransformNodeData
  | MemoryNodeData | FileNodeData | CommentNodeData;

export interface AgentPreset {
  label: string; model: AgentModel; systemPrompt: string;
}

export const AGENT_PRESETS: AgentPreset[] = [
  { label: 'Planner', model: 'claude-opus-4-6', systemPrompt: 'You analyze requests and produce a clear, structured plan. Break complex tasks into discrete steps, identify dependencies, and estimate effort. Output a numbered plan with clear action items.' },
  { label: 'Coordinator', model: 'claude-opus-4-6', systemPrompt: 'You coordinate a team of agents. Assign tasks, track progress, resolve conflicts, and synthesize outputs into a coherent result. Keep the team focused on the goal.' },
  { label: 'Coder', model: 'claude-sonnet-4-6', systemPrompt: 'You write clean, working code. Always provide complete, runnable implementations. Follow best practices, add comments for complex logic, and handle edge cases.' },
  { label: 'Reviewer', model: 'claude-sonnet-4-6', systemPrompt: 'You review work critically and constructively. Identify bugs, security issues, performance problems, and style violations. Suggest specific improvements with examples.' },
  { label: 'Researcher', model: 'claude-sonnet-4-6', systemPrompt: 'You research topics thoroughly using available tools. Gather information from multiple sources, verify facts, and synthesize findings into clear, accurate summaries.' },
  { label: 'Architect', model: 'claude-sonnet-4-6', systemPrompt: 'You design system architecture. Define components, interfaces, data flows, and technology choices. Prioritize simplicity, scalability, and maintainability.' },
  { label: 'Implementer', model: 'claude-sonnet-4-6', systemPrompt: 'You implement tasks from a specification. Follow the plan precisely, write production-quality code, and report progress clearly.' },
  { label: 'Summarizer', model: 'claude-haiku-4-5-20251001', systemPrompt: 'You condense content into clear, concise summaries. Capture key points, omit redundancy, and preserve critical details.' },
];

const YR_WEATHER_CMD = `\
# Weather forecast via yr.no / MET Norway (free, no API key needed)
# Change the city below to your location
CITY="Oslo, Norway"

# Look up coordinates from city name (OpenStreetMap)
COORDS=$(curl -s -A "nanoclaw/1.0" \\
  "https://nominatim.openstreetmap.org/search?q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote('$CITY'))")&format=json&limit=1" \\
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['lat'], d[0]['lon'])" 2>/dev/null)

LAT=$(echo $COORDS | awk '{print $1}')
LON=$(echo $COORDS | awk '{print $2}')

# Fetch forecast (next 24 hours)
curl -s -A "nanoclaw/1.0" \\
  "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=$LAT&lon=$LON" \\
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
units = data['properties']['meta']['units']
series = data['properties']['timeseries'][:8]  # next 8 hours
print(f'Weather forecast for $CITY:')
for t in series:
    time = t['time'][11:16]  # HH:MM
    d = t['data']['instant']['details']
    rain = t['data'].get('next_1_hours', {}).get('details', {}).get('precipitation_amount', 0)
    symbol = t['data'].get('next_1_hours', {}).get('summary', {}).get('symbol_code', '')
    print(f'{time}  {d[\"air_temperature\"]}°C  wind {d[\"wind_speed\"]} m/s  rain {rain}mm  {symbol}')
"`;

const YR_AIRQUALITY_CMD = `\
# Air quality forecast via yr.no / MET Norway (free, no API key needed)
# Change the city below to your location
CITY="Oslo, Norway"

# Look up coordinates
COORDS=$(curl -s -A "nanoclaw/1.0" \\
  "https://nominatim.openstreetmap.org/search?q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote('$CITY'))")&format=json&limit=1" \\
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['lat'], d[0]['lon'])" 2>/dev/null)

LAT=$(echo $COORDS | awk '{print $1}')
LON=$(echo $COORDS | awk '{print $2}')

# Fetch air quality
curl -s -A "nanoclaw/1.0" \\
  "https://api.met.no/weatherapi/airqualityforecast/0.1/?lat=$LAT&lon=$LON" \\
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
loc = data['meta']['location']['name']
times = data['data']['time'][:4]
print(f'Air quality for $CITY ({loc}):')
for t in times:
    v = t['variables']
    aqi = v.get('AQI', {}).get('value', '?')
    no2 = v.get('no2_concentration', {}).get('value', '?')
    pm25 = v.get('pm25_concentration', {}).get('value', '?')
    pm10 = v.get('pm10_concentration', {}).get('value', '?')
    label = 'Good' if aqi < 2 else 'Moderate' if aqi < 3 else 'Poor' if aqi < 4 else 'Very Poor'
    print(f'{t[\"from\"][11:16]}  AQI {aqi:.1f} ({label})  NO2 {no2:.1f} µg/m³  PM2.5 {pm25:.1f}  PM10 {pm10:.1f}')
"`;

export const TOOL_PRESETS = [
  { label: 'Weather Forecast (yr.no)', toolType: 'bash' as ToolType, config: YR_WEATHER_CMD },
  { label: 'Air Quality (yr.no)',      toolType: 'bash' as ToolType, config: YR_AIRQUALITY_CMD },
  { label: 'Web Search',   toolType: 'search' as ToolType, config: '' },
  { label: 'GitHub MCP',   toolType: 'mcp' as ToolType, config: 'github' },
  { label: 'Run Tests',    toolType: 'bash' as ToolType, config: 'npm test' },
  { label: 'Git Status',   toolType: 'bash' as ToolType, config: 'git status && git diff --stat' },
  { label: 'Run Script',   toolType: 'bash' as ToolType, config: 'bash scripts/run.sh' },
];

export interface BlueprintProject {
  name: string; version: '1';
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: BlueprintNodeData }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>;
}

export const NODE_KIND_META: Record<NodeKind, { label: string; description: string; color: string }> = {
  trigger:   { label: 'Trigger',   description: 'Pipeline entry point (message, schedule, webhook)', color: '#f97316' },
  agent:     { label: 'Agent',     description: 'Claude LLM with a system prompt', color: '#3b82f6' },
  tool:      { label: 'Tool',      description: 'Bash, web search, or MCP integration', color: '#8b5cf6' },
  condition: { label: 'Condition', description: 'Branch on a rule without using an LLM', color: '#ec4899' },
  router:    { label: 'Router',    description: 'LLM-based routing to multiple branches', color: '#f59e0b' },
  transform: { label: 'Transform', description: 'Format, template, or reshape text', color: '#14b8a6' },
  memory:    { label: 'Memory',    description: 'Read/write persistent group memory', color: '#06b6d4' },
  file:      { label: 'File',      description: 'Provide filesystem access to agents', color: '#84cc16' },
  output:    { label: 'Output',    description: 'Send results to Telegram, file, or webhook', color: '#10b981' },
  comment:   { label: 'Comment',   description: 'Documentation label on the canvas', color: '#4b5563' },
};
