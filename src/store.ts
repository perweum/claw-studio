import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';
import type { AgentModel, BlueprintNodeData, NodeKind } from './types';
import type { Operation } from './schema';

let nodeCounter = 0;
function nextId() {
  return `node-${++nodeCounter}`;
}

let msgCounter = 0;
function nextMsgId() {
  return `msg-${++msgCounter}`;
}

function defaultData(kind: NodeKind): BlueprintNodeData {
  switch (kind) {
    case 'agent':
      return { kind: 'agent', label: 'Agent', model: 'claude-sonnet-4-6' as AgentModel, systemPrompt: 'You are a helpful assistant.' };
    case 'tool':
      return { kind: 'tool', label: 'Tool', toolType: 'bash', config: '' };
    case 'router':
      return { kind: 'router', label: 'Router', routingPrompt: 'Route based on the input.', branches: ['Branch A', 'Branch B'] };
    case 'output':
      return { kind: 'output', label: 'Output', destination: 'telegram', config: '' };
    case 'trigger':
      return { kind: 'trigger', label: 'Trigger', triggerType: 'message', config: '' };
    case 'condition':
      return { kind: 'condition', label: 'Condition', conditionType: 'contains', value: '' };
    case 'transform':
      return { kind: 'transform', label: 'Transform', transformType: 'template', config: '' };
    case 'memory':
      return { kind: 'memory', label: 'Memory', operation: 'read', scope: 'group', key: '' };
    case 'file':
      return { kind: 'file', label: 'File Access', path: '/workspace', permissions: 'read' };
    case 'comment':
      return { kind: 'comment', text: 'Comment', color: '#4b5563' };
  }
}

export interface CommandLogEntry {
  cmd: string;
  output: string;
  ok: boolean;
  description: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  opsApplied?: number;
  commandLog?: CommandLogEntry[];
  pendingCommand?: { cmd: string; description: string } | null;
}

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

export interface GroupInfo {
  folder: string;
  hasBlueprint: boolean;
  hasClaude: boolean;
}

interface BlueprintStore {
  projectName: string;
  nodes: Node<BlueprintNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  chatMessages: ChatMessage[];
  isChatLoading: boolean;

  currentGroupFolder: string | null;
  saveStatus: SaveStatus;

  setProjectName: (name: string) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (kind: NodeKind, position?: { x: number; y: number }) => void;
  selectNode: (id: string | null) => void;
  updateNodeData: (id: string, patch: Partial<BlueprintNodeData>) => void;
  deleteNode: (id: string) => void;
  applyOperations: (ops: Operation[]) => number;
  sendChatMessage: (text: string) => Promise<void>;
  confirmPendingCommand: (msgId: string) => Promise<void>;
  cancelPendingCommand: (msgId: string) => void;

  createBot: (displayName: string, channelJid?: string) => Promise<string>;
  fetchGroups: () => Promise<GroupInfo[]>;
  openGroup: (folder: string) => Promise<void>;
  saveCurrentGroup: () => Promise<void>;
  closeGroup: () => void;
  deployToGroup: () => Promise<{ ok: boolean; preview?: string; error?: string; actions?: { done: string[]; manual: string[] } }>;
  exportProject: () => void;
  importProject: () => void;
}

export const useStore = create<BlueprintStore>((set, get) => ({
  projectName: 'Untitled Project',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  chatMessages: [],
  isChatLoading: false,
  currentGroupFolder: null,
  saveStatus: 'idle',

  setProjectName: (name) => set({ projectName: name }),

  onNodesChange: (changes) =>
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes) as Node<BlueprintNodeData>[],
      saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
    })),

  onEdgesChange: (changes) =>
    set((s) => ({
      edges: applyEdgeChanges(changes, s.edges),
      saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
    })),

  onConnect: (connection) =>
    set((s) => ({
      edges: addEdge({ ...connection, animated: true }, s.edges),
      saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
    })),

  addNode: (kind, position = { x: 200 + Math.random() * 200, y: 150 + Math.random() * 200 }) => {
    const id = nextId();
    const node: Node<BlueprintNodeData> = { id, type: kind, position, data: defaultData(kind) };
    set((s) => ({
      nodes: [...s.nodes, node],
      selectedNodeId: id,
      saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
    }));
  },

  selectNode: (id) => set({ selectedNodeId: id }),

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } as BlueprintNodeData } : n,
      ),
      saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
    })),

  deleteNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
      saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
    })),

  applyOperations: (ops) => {
    const tempIdMap = new Map<string, string>();
    let opsApplied = 0;

    set((state) => {
      let nodes = [...state.nodes];
      let edges = [...state.edges];

      for (const op of ops) {
        if (op.op === 'clear') {
          nodes = [];
          edges = [];
          opsApplied++;
        } else if (op.op === 'addNode') {
          const id = nextId();
          tempIdMap.set(op.tempId, id);
          const data = buildNodeDataFromOp(op);
          nodes = [...nodes, { id, type: op.kind, position: { x: op.x, y: op.y }, data }];
          opsApplied++;
        } else if (op.op === 'connect') {
          const source = tempIdMap.get(op.from) ?? op.from;
          const target = tempIdMap.get(op.to) ?? op.to;
          const edgeId = `e-${source}-${target}-${Date.now()}`;
          edges = addEdge({ id: edgeId, source, target, sourceHandle: op.handle ?? null, animated: true }, edges);
          opsApplied++;
        } else if (op.op === 'updateNode') {
          nodes = nodes.map((n) =>
            n.id === op.id ? { ...n, data: { ...n.data, ...op.data } as BlueprintNodeData } : n,
          );
          opsApplied++;
        } else if (op.op === 'deleteNode') {
          nodes = nodes.filter((n) => n.id !== op.id);
          edges = edges.filter((e) => e.source !== op.id && e.target !== op.id);
          opsApplied++;
        }
      }

      return {
        nodes,
        edges,
        saveStatus: state.currentGroupFolder ? 'unsaved' : state.saveStatus,
      };
    });

    return opsApplied;
  },

  sendChatMessage: async (text: string) => {
    const { chatMessages, nodes, edges, applyOperations } = get();

    const userMsg: ChatMessage = { id: nextMsgId(), role: 'user', content: text };
    set((s) => ({ chatMessages: [...s.chatMessages, userMsg], isChatLoading: true }));

    const graphState = buildGraphSummary(nodes, edges);
    const history = [...chatMessages, userMsg].map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, graphState }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      const opsApplied = data.operations?.length ? applyOperations(data.operations) : 0;

      const assistantMsg: ChatMessage = {
        id: nextMsgId(),
        role: 'assistant',
        content: data.message,
        opsApplied,
        commandLog: data.commandLog,
        pendingCommand: data.pendingCommand,
      };
      set((s) => ({ chatMessages: [...s.chatMessages, assistantMsg] }));
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: nextMsgId(),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      };
      set((s) => ({ chatMessages: [...s.chatMessages, errorMsg] }));
    } finally {
      set({ isChatLoading: false });
    }
  },

  confirmPendingCommand: async (msgId: string) => {
    const { chatMessages, nodes, edges, applyOperations } = get();
    const pendingMsg = chatMessages.find((m) => m.id === msgId);
    if (!pendingMsg?.pendingCommand) return;

    const confirmedCmd = pendingMsg.pendingCommand.cmd;

    // Mark as approved (clear the pending card) and start loading
    set((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.id === msgId ? { ...m, pendingCommand: null } : m,
      ),
      isChatLoading: true,
    }));

    // Build history without the pending-command interruption message
    const history = chatMessages
      .filter((m) => m.id !== msgId && !(m.role === 'assistant' && m.pendingCommand != null))
      .map((m) => ({ role: m.role, content: m.content }));

    const graphState = buildGraphSummary(nodes, edges);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, graphState, confirmedCommands: [confirmedCmd] }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((e as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as {
        message: string;
        operations?: Operation[];
        commandLog?: CommandLogEntry[];
        pendingCommand?: { cmd: string; description: string };
      };
      const opsApplied = data.operations?.length ? applyOperations(data.operations) : 0;
      set((s) => ({
        chatMessages: [...s.chatMessages, {
          id: nextMsgId(),
          role: 'assistant' as const,
          content: data.message,
          opsApplied,
          commandLog: data.commandLog,
          pendingCommand: data.pendingCommand,
        }],
      }));
    } catch (err) {
      set((s) => ({
        chatMessages: [...s.chatMessages, {
          id: nextMsgId(),
          role: 'assistant' as const,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
      }));
    } finally {
      set({ isChatLoading: false });
    }
  },

  cancelPendingCommand: (msgId: string) => {
    set((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.id === msgId ? { ...m, pendingCommand: null, content: m.content + '\n\n*(Cancelled)*' } : m,
      ),
    }));
  },

  // ── Group persistence ───────────────────────────────────────────────────────

  createBot: async (displayName: string, channelJid?: string) => {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: displayName, channelJid }),
    });
    const data = await res.json() as { ok?: boolean; folder?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    await get().openGroup(data.folder!);
    return data.folder!;
  },

  fetchGroups: async () => {
    const res = await fetch('/api/groups');
    if (!res.ok) throw new Error(`Failed to fetch groups: ${res.status}`);
    const data = await res.json();
    return data.groups as GroupInfo[];
  },

  openGroup: async (folder: string) => {
    set({ currentGroupFolder: folder, projectName: folder, saveStatus: 'idle', selectedNodeId: null });

    try {
      const res = await fetch(`/api/groups/${folder}/blueprint`);
      if (res.status === 404) {
        set({ nodes: [], edges: [], saveStatus: 'idle' });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const project = await res.json();

      // Sync the node counter so new nodes get unique IDs
      const maxId = (project.nodes ?? []).reduce((max: number, n: { id: string }) => {
        const num = parseInt(n.id.replace('node-', ''), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      nodeCounter = maxId;

      set({
        nodes: project.nodes ?? [],
        edges: project.edges ?? [],
        saveStatus: 'saved',
      });
    } catch (err) {
      console.error('[openGroup]', err);
      set({ nodes: [], edges: [], saveStatus: 'error' });
    }
  },

  saveCurrentGroup: async () => {
    const { currentGroupFolder, projectName, nodes, edges } = get();
    if (!currentGroupFolder) return;

    set({ saveStatus: 'saving' });
    try {
      const project = { name: projectName, version: '1', nodes, edges };
      const res = await fetch(`/api/groups/${currentGroupFolder}/blueprint`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project, null, 2),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error);
      }
      set({ saveStatus: 'saved' });
    } catch (err) {
      console.error('[saveCurrentGroup]', err);
      set({ saveStatus: 'error' });
    }
  },

  closeGroup: () => {
    set({
      currentGroupFolder: null,
      projectName: 'Untitled Project',
      nodes: [],
      edges: [],
      selectedNodeId: null,
      saveStatus: 'idle',
    });
  },

  deployToGroup: async () => {
    const { currentGroupFolder, nodes, edges } = get();
    if (!currentGroupFolder) return { ok: false, error: 'No group open' };

    try {
      // Save first so blueprint.json is always in sync
      await get().saveCurrentGroup();

      const res = await fetch(`/api/groups/${currentGroupFolder}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      return { ok: true, preview: data.preview, actions: data.actions };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  exportProject: () => {
    const { projectName, nodes, edges } = get();
    const project = { name: projectName, version: '1', nodes, edges };
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.replace(/\s+/g, '-').toLowerCase()}.blueprint.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importProject: () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.blueprint.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const project = JSON.parse(ev.target?.result as string);
          set({
            projectName: project.name ?? 'Untitled Project',
            nodes: project.nodes ?? [],
            edges: project.edges ?? [],
            selectedNodeId: null,
            saveStatus: 'idle',
          });
        } catch {
          alert('Invalid blueprint file.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildNodeDataFromOp(op: Extract<import('./schema').Operation, { op: 'addNode' }>): BlueprintNodeData {
  switch (op.kind) {
    case 'agent':
      return { kind: 'agent', label: op.label, model: (op.model ?? 'claude-sonnet-4-6') as AgentModel, systemPrompt: op.systemPrompt ?? '' };
    case 'tool':
      return { kind: 'tool', label: op.label, toolType: (op.toolType ?? 'bash') as 'bash' | 'search' | 'mcp', config: op.config ?? '' };
    case 'router':
      return { kind: 'router', label: op.label, routingPrompt: op.routingPrompt ?? '', branches: op.branches ?? ['Branch A', 'Branch B'] };
    case 'output':
      return { kind: 'output', label: op.label, destination: (op.destination ?? 'telegram') as 'telegram' | 'file' | 'webhook', config: op.config ?? '' };
    case 'trigger':
      return { kind: 'trigger', label: op.label, triggerType: (op.triggerType ?? 'message') as import('./types').TriggerType, config: op.config ?? '' };
    case 'condition':
      return { kind: 'condition', label: op.label, conditionType: (op.conditionType ?? 'contains') as import('./types').ConditionType, value: op.value ?? '' };
    case 'transform':
      return { kind: 'transform', label: op.label, transformType: (op.transformType ?? 'template') as import('./types').TransformType, config: op.config ?? '' };
    case 'memory':
      return { kind: 'memory', label: op.label, operation: (op.operation ?? 'read') as import('./types').MemoryOperation, scope: (op.scope ?? 'group') as import('./types').MemoryScope, key: op.key ?? '' };
    case 'file':
      return { kind: 'file', label: op.label, path: op.path ?? '/workspace', permissions: (op.permissions ?? 'read') as import('./types').FilePermission };
    case 'comment':
      return { kind: 'comment', text: op.text ?? '', color: op.color ?? '#4b5563' };
  }
}

function buildGraphSummary(nodes: Node<BlueprintNodeData>[], edges: Edge[]): string {
  if (nodes.length === 0) return 'Canvas is empty.';

  const nodeLines = nodes.map((n) => {
    const d = n.data;
    let detail = '';
    if (d.kind === 'agent') detail = ` [model: ${d.model}]`;
    if (d.kind === 'tool') detail = ` [${d.toolType}]`;
    if (d.kind === 'router') detail = ` [branches: ${d.branches?.join(', ')}]`;
    if (d.kind === 'output') detail = ` [→ ${d.destination}]`;
    if (d.kind === 'trigger') detail = ` [${d.triggerType}]`;
    if (d.kind === 'condition') detail = ` [${d.conditionType}]`;
    if (d.kind === 'transform') detail = ` [${d.transformType}]`;
    if (d.kind === 'memory') detail = ` [${d.operation} ${d.scope}]`;
    if (d.kind === 'file') detail = ` [${d.permissions}: ${d.path}]`;
    if (d.kind === 'comment') return `- ${n.id}: comment "${d.text}"`;
    return `- ${n.id}: ${d.kind} "${d.label}"${detail}`;
  });

  const edgeLines = edges.map((e) => {
    const handlePart = e.sourceHandle ? ` (${e.sourceHandle})` : '';
    return `- ${e.source}${handlePart} → ${e.target}`;
  });

  return `Nodes:\n${nodeLines.join('\n')}\n\nConnections:\n${edgeLines.join('\n') || '(none)'}`;
}
