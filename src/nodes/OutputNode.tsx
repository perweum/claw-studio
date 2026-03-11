import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { OutputNodeData } from '../types';

const DEST_ICONS: Record<string, string> = {
  telegram: '→',
  file: '▤',
  webhook: '⊕',
  agent_handoff: '⇢',
};

const DEST_LABELS: Record<string, string> = {
  telegram: 'telegram',
  file: 'file',
  webhook: 'webhook',
  agent_handoff: 'pass to bot',
};

export function OutputNode({ data, selected }: NodeProps) {
  const d = data as unknown as OutputNodeData;
  const config = String(d.config || '').trim();
  const targetFolder = String(d.targetFolder || '').trim();
  const needsSetup =
    (d.destination === 'webhook' && !config) ||
    (d.destination === 'file' && !config) ||
    (d.destination === 'agent_handoff' && !targetFolder);
  const emptyHint =
    d.destination === 'webhook'       ? 'Set webhook URL — click to configure' :
    d.destination === 'file'          ? 'Set file path — click to configure' :
    d.destination === 'agent_handoff' ? 'Choose a bot — click to configure' : '';
  const preview =
    d.destination === 'agent_handoff'
      ? targetFolder.replace(/_/g, ' ')
      : config.slice(0, 50);
  return (
    <div className={`bp-node bp-node--output ${selected ? 'bp-node--selected' : ''}`}>
      {needsSetup && (
        <span className="bp-node__warning" title={`${emptyHint}`}>!</span>
      )}
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} id="out" />
      <div className="bp-node__header">
        <span className="bp-node__badge">OUTPUT</span>
        <span className="bp-node__model">{DEST_ICONS[d.destination]} {DEST_LABELS[d.destination] ?? d.destination}</span>
      </div>
      <div className="bp-node__label">{d.label}</div>
      {needsSetup && (
        <div className="bp-node__preview bp-node__preview--empty">{emptyHint}</div>
      )}
      {!needsSetup && preview && (
        <div className="bp-node__preview">{preview}</div>
      )}
    </div>
  );
}
