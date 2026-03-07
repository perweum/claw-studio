import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useState } from 'react';
import './App.css';
import { ChatPanel } from './components/ChatPanel';
import { CommandPalette } from './components/CommandPalette';
import { ContextMenu } from './components/ContextMenu';
import { GroupPicker } from './components/GroupPicker';
import { NodePanel } from './components/NodePanel';
import { SetupWizard } from './components/SetupWizard';
import { Toolbar } from './components/Toolbar';
import { nodeTypes } from './nodes';
import { useStore } from './store';
import { NODE_KIND_META } from './types';

interface CtxMenu {
  x: number;
  y: number;
  nodeId: string;
}

function Canvas({ onContextMenu }: { onContextMenu: (ctx: CtxMenu) => void }) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, selectNode } = useStore();

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_, node) => selectNode(node.id)}
      onPaneClick={() => selectNode(null)}
      onNodeContextMenu={(e, node) => {
        e.preventDefault();
        onContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
      }}
      fitView
      deleteKeyCode="Delete"
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#2a2a3e" />
      <Controls />
      <MiniMap
        nodeColor={(n) => {
          const kind = (n.data as { kind: string }).kind;
          return NODE_KIND_META[kind as keyof typeof NODE_KIND_META]?.color ?? '#6b7280';
        }}
        style={{ background: '#12121f' }}
      />
    </ReactFlow>
  );
}

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupPickerMode, setGroupPickerMode] = useState<'list' | 'new'>('list');
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [chatPrefill, setChatPrefill] = useState<string | null>(null);

  useEffect(() => {
    // Show wizard if nanoclaw path or API key is not configured
    Promise.all([
      fetch('/api/setup').then((r) => r.json()).catch(() => ({ configured: true })),
      fetch('/api/config').then((r) => r.json()).catch(() => ({ configured: true })),
    ]).then(([setup, config]: [{ configured: boolean }, { configured: boolean }]) => {
      if (!setup.configured || !config.configured) setShowWizard(true);
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setGroupPickerOpen(false);
        setCtxMenu(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenGroupPicker={() => { setGroupPickerMode('list'); setGroupPickerOpen(true); }}
          onNewBot={() => { setGroupPickerMode('new'); setGroupPickerOpen(true); }}
        />
        <div className="app__body">
          <ChatPanel prefill={chatPrefill} onPrefillUsed={() => setChatPrefill(null)} />
          <div className="app__canvas">
            <Canvas
              onContextMenu={(ctx) => {
                setCtxMenu(ctx);
                setPaletteOpen(false);
              }}
            />
          </div>
          <NodePanel />
        </div>
      </div>

      {showWizard && (
        <SetupWizard onDone={(openNewBot) => {
          setShowWizard(false);
          if (openNewBot) { setGroupPickerMode('new'); setGroupPickerOpen(true); }
        }} />
      )}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {groupPickerOpen && (
        <GroupPicker
          onClose={() => setGroupPickerOpen(false)}
          initialMode={groupPickerMode}
          onNewChannel={(msg) => { setGroupPickerOpen(false); setChatPrefill(msg); }}
        />
      )}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          nodeId={ctxMenu.nodeId}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </ReactFlowProvider>
  );
}
