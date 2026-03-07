import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { OutputNodeData } from '../types';

const DEST_ICONS: Record<string, string> = {
  telegram: '→',
  file: '▤',
  webhook: '⊕',
};

export function OutputNode({ data, selected }: NodeProps) {
  const d = data as unknown as OutputNodeData;
  const needsSetup = d.destination === 'webhook' && !String(d.config || '').trim();
  return (
    <div className={`bp-node bp-node--output ${selected ? 'bp-node--selected' : ''}`}>
      {needsSetup && (
        <span className="bp-node__warning" title="Set the webhook URL — click to configure">!</span>
      )}
      <Handle type="target" position={Position.Top} />
      <div className="bp-node__header">
        <span className="bp-node__badge">OUTPUT</span>
        <span className="bp-node__model">{DEST_ICONS[d.destination]} {d.destination}</span>
      </div>
      <div className="bp-node__label">{d.label}</div>
      {needsSetup && (
        <div className="bp-node__preview bp-node__preview--empty">Set webhook URL — click to configure</div>
      )}
    </div>
  );
}
