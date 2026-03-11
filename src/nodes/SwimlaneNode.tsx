import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
// Note: SwimlaneNode only has a target handle — Output nodes are always the edge source
import type { SwimlaneNodeData } from '../types';

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

export function SwimlaneNode({ data, selected }: NodeProps) {
  const d = data as unknown as SwimlaneNodeData;
  const hue = hashHue(d.groupFolder || 'default');

  return (
    <>
      <NodeResizer
        minWidth={300}
        minHeight={180}
        isVisible={selected}
        lineStyle={{ borderColor: `hsl(${hue}, 60%, 55%)` }}
        handleStyle={{ backgroundColor: `hsl(${hue}, 60%, 55%)`, width: 8, height: 8 }}
      />
      <div
        className={`swimlane-node ${selected ? 'swimlane-node--selected' : ''}`}
        style={{
          background: `hsla(${hue}, 50%, 45%, 0.07)`,
          borderColor: selected ? `hsl(${hue}, 60%, 55%)` : `hsla(${hue}, 50%, 50%, 0.35)`,
          width: '100%',
          height: '100%',
        }}
      >
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className="swimlane-node__handle"
          style={{ top: 24 }}
        />
        <div className="swimlane-node__header">
          <span className="swimlane-node__badge">BOT</span>
          <span className="swimlane-node__label">{d.label || 'Bot Container'}</span>
        </div>
      </div>
    </>
  );
}
