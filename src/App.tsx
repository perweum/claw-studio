import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';
import { ChatPanel } from './components/ChatPanel';
import { CommandPalette } from './components/CommandPalette';
import { ContextMenu } from './components/ContextMenu';
import { GroupPicker } from './components/GroupPicker';
import { NodePanel } from './components/NodePanel';
import { OnboardingTour } from './components/OnboardingTour';
import { SetupWizard } from './components/SetupWizard';
import { StatusPanel } from './components/StatusPanel';
import { Toolbar } from './components/Toolbar';
import { WelcomeModal } from './components/WelcomeModal';

const ONBOARDED_KEY = 'cs:onboarded';
import { nodeTypes } from './nodes';
import { useStore } from './store';
import { NODE_KIND_META } from './types';

interface CtxMenu {
  x: number;
  y: number;
  nodeId: string;
}

function Canvas({ onContextMenu }: { onContextMenu: (ctx: CtxMenu) => void }) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, onReconnect, selectNode } = useStore();
  const edgeReconnectSuccessful = useRef(false);

  // Only Output nodes may connect to Swimlane containers; Swimlanes cannot be a source
  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const { nodes: ns } = useStore.getState();
    const src = ns.find((n) => n.id === connection.source);
    const tgt = ns.find((n) => n.id === connection.target);
    if (tgt?.type === 'swimlane') return src?.data.kind === 'output';
    if (src?.type === 'swimlane') return false;
    return true;
  }, []);

  const handleReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const handleReconnect = useCallback((oldEdge: Edge, newConnection: Connection) => {
    edgeReconnectSuccessful.current = true;
    onReconnect(oldEdge, newConnection);
  }, [onReconnect]);

  // If drag ended without a valid target, delete the edge
  const handleReconnectEnd = useCallback((_: MouseEvent | TouchEvent, edge: Edge) => {
    if (!edgeReconnectSuccessful.current) {
      const { onEdgesChange: applyChanges } = useStore.getState();
      applyChanges([{ type: 'remove', id: edge.id }]);
    }
    edgeReconnectSuccessful.current = true;
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onReconnect={handleReconnect}
      onReconnectStart={handleReconnectStart}
      onReconnectEnd={handleReconnectEnd}
      isValidConnection={isValidConnection}
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
  const [statusOpen, setStatusOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);

  function startTour() {
    setShowWelcome(false);
    setTourStep(0);
  }

  function dismissOnboarding() {
    localStorage.setItem(ONBOARDED_KEY, '1');
    setShowWelcome(false);
    setTourStep(null);
  }

  function advanceTour() {
    if (tourStep === null) return;
    const total = 8; // must match STEPS.length in OnboardingTour
    if (tourStep < total - 1) {
      setTourStep(tourStep + 1);
    } else {
      dismissOnboarding();
    }
  }

  function retreatTour() {
    if (tourStep !== null && tourStep > 0) setTourStep(tourStep - 1);
  }

  const { openGroup, saveDraftNow, saveStatus, undo, redo, canUndo, canRedo } = useStore();

  // Restore last open group on mount; show welcome if first visit
  useEffect(() => {
    const lastGroup = localStorage.getItem('cs:lastGroup');
    if (lastGroup) openGroup(lastGroup);
    if (!localStorage.getItem(ONBOARDED_KEY)) setShowWelcome(true);
  }, [openGroup]);

  // Auto-save draft when there are unsaved changes (debounced)
  useEffect(() => {
    if (saveStatus !== 'unsaved') return;
    const t = setTimeout(() => saveDraftNow(), 1000);
    return () => clearTimeout(t);
  }, [saveStatus, saveDraftNow]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (saveStatus === 'unsaved') {
        e.preventDefault();
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveStatus]);

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
      // Undo: Cmd+Z / Ctrl+Z
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          if (canUndo) undo();
        }
      }
      // Redo: Cmd+Shift+Z / Ctrl+Shift+Z / Ctrl+Y
      if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') || ((e.ctrlKey) && e.key === 'y')) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          if (canRedo) redo();
        }
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setGroupPickerOpen(false);
        setCtxMenu(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canUndo, canRedo, undo, redo]);

  return (
    <ReactFlowProvider>
      <div className="app">
        <Toolbar
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenGroupPicker={() => { setGroupPickerMode('list'); setGroupPickerOpen(true); }}
          onNewBot={() => { setGroupPickerMode('new'); setGroupPickerOpen(true); }}
          onOpenStatus={() => setStatusOpen(true)}
          onStartTour={startTour}
        />
        <div className="app__body">
          <div data-tour="chat-panel">
            <ChatPanel prefill={chatPrefill} onPrefillUsed={() => setChatPrefill(null)} />
          </div>
          <div className="app__canvas" data-tour="canvas">
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
      {statusOpen && <StatusPanel onClose={() => setStatusOpen(false)} />}
      {showWelcome && <WelcomeModal onStartTour={startTour} onSkip={dismissOnboarding} />}
      {tourStep !== null && (
        <OnboardingTour
          step={tourStep}
          onNext={advanceTour}
          onBack={retreatTour}
          onSkip={dismissOnboarding}
        />
      )}
    </ReactFlowProvider>
  );
}
