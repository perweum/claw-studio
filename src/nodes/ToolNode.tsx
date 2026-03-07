import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ToolNodeData } from '../types';

const TOOL_ICONS: Record<string, string> = {
  bash: '▸',
  search: '⌕',
  mcp: '⇌',
};

// These MCP servers use OAuth — no API key placeholder needed
const OAUTH_MCP_SERVERS = new Set(['gmail-mcp', 'google-calendar-mcp']);

// These MCP servers need a URL field instead of an API key
const URL_MCP_SERVERS = new Set(['ical-calendar']);

export function ToolNode({ data, selected }: NodeProps) {
  const d = data as unknown as ToolNodeData;
  let mcpServer = '';
  if (d.toolType === 'mcp' && d.config) {
    try { mcpServer = JSON.parse(String(d.config)).server ?? ''; } catch { /* ignore */ }
  }
  let icalUrlMissing = false;
  if (URL_MCP_SERVERS.has(mcpServer) && d.config) {
    try { icalUrlMissing = !JSON.parse(String(d.config)).url; } catch { icalUrlMissing = true; }
  }
  const needsSetup =
    (d.toolType === 'mcp' && (!d.config || (String(d.config).includes('YOUR_') && !OAUTH_MCP_SERVERS.has(mcpServer)) || icalUrlMissing)) ||
    (d.toolType === 'bash' && !d.config);
  return (
    <div className={`bp-node bp-node--tool ${selected ? 'bp-node--selected' : ''}`}>
      {needsSetup && (
        <span className="bp-node__warning" title="This tool needs configuration — click to set it up">!</span>
      )}
      <Handle type="target" position={Position.Top} />
      <div className="bp-node__header">
        <span className="bp-node__badge">TOOL</span>
        <span className="bp-node__model">{TOOL_ICONS[d.toolType]} {d.toolType.toUpperCase()}</span>
      </div>
      <div className="bp-node__label">{d.label}</div>
      {d.config && (
        <div className="bp-node__preview">{d.config.slice(0, 60)}{d.config.length > 60 ? '…' : ''}</div>
      )}
      {needsSetup && d.toolType === 'mcp' && (
        <div className="bp-node__preview bp-node__preview--empty">Needs API key — click to set up</div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
