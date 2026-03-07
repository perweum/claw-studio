import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TriggerNodeData } from '../types';

const ICONS: Record<string, string> = { message: '◉', schedule: '◷', webhook: '⊕', manual: '▶' };

const EMPTY_HINTS: Partial<Record<string, string>> = {
  schedule: 'Set a schedule — click to configure',
  webhook: 'Set a webhook URL — click to configure',
};

export function TriggerNode({ data, selected }: NodeProps) {
  const d = data as unknown as TriggerNodeData;
  const needsSetup =
    (d.triggerType === 'schedule' || d.triggerType === 'webhook') &&
    !String(d.config || '').trim();
  return (
    <div className={`bp-node bp-node--trigger ${selected ? 'bp-node--selected' : ''}`}>
      {needsSetup && (
        <span className="bp-node__warning" title="This trigger needs configuration — click to set it up">!</span>
      )}
      <div className="bp-node__header">
        <span className="bp-node__badge">TRIGGER</span>
        <span className="bp-node__model">{ICONS[d.triggerType]} {d.triggerType}</span>
      </div>
      <div className="bp-node__label">{d.label}</div>
      {d.config
        ? <div className="bp-node__preview">{d.config.slice(0, 60)}{d.config.length > 60 ? '…' : ''}</div>
        : needsSetup && <div className="bp-node__preview bp-node__preview--empty">{EMPTY_HINTS[d.triggerType]}</div>
      }
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
