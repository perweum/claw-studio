import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TransformNodeData } from '../types';

const ICONS: Record<string, string> = { template: '≡', truncate: '⋯', json_wrap: '{ }', extract: '⌕' };

export function TransformNode({ data, selected }: NodeProps) {
  const d = data as unknown as TransformNodeData;
  return (
    <div className={`bp-node bp-node--transform ${selected ? 'bp-node--selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="bp-node__header">
        <span className="bp-node__badge">TRANSFORM</span>
        <span className="bp-node__model">{ICONS[d.transformType]} {d.transformType}</span>
      </div>
      <div className="bp-node__label">{d.label}</div>
      {d.config && <div className="bp-node__preview">{d.config.slice(0, 60)}{d.config.length > 60 ? '…' : ''}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
