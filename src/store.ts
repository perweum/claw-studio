import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge as rfReconnectEdge,
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

// ── Local persistence helpers ─────────────────────────────────────────────────

type CanvasSnapshot = { nodes: Node<BlueprintNodeData>[]; edges: Edge[] };

const LS_LAST_GROUP = 'cs:lastGroup';
const LS_DRAFT_PREFIX = 'cs:draft:';
const SS_CHAT = 'cs:chat';

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
function lsDel(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
function ssGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function ssSet(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
}

function saveDraft(folder: string, snapshot: CanvasSnapshot) {
  lsSet(LS_DRAFT_PREFIX + folder, JSON.stringify(snapshot));
}
function loadDraft(folder: string): CanvasSnapshot | null {
  try {
    const raw = lsGet(LS_DRAFT_PREFIX + folder);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearDraft(folder: string) {
  lsDel(LS_DRAFT_PREFIX + folder);
}

function loadSessionChat(): ChatMessage[] {
  try {
    const raw = ssGet(SS_CHAT);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveSessionChat(messages: ChatMessage[]) {
  ssSet(SS_CHAT, JSON.stringify(messages.slice(-100)));
}

// Inline history push — returns the partial state update for past/future
function withHistoryPush(s: { past: CanvasSnapshot[]; future: CanvasSnapshot[]; nodes: Node<BlueprintNodeData>[]; edges: Edge[] }) {
  const snap: CanvasSnapshot = { nodes: s.nodes, edges: s.edges };
  return {
    past: [...s.past, snap].slice(-50),
    future: [] as CanvasSnapshot[],
  };
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
    case 'swimlane':
      return { kind: 'swimlane', label: 'Bot Container', groupFolder: 'bot_container', width: 640, height: 420 };
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
  options?: string[];
}

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';
export type AssistantModel = 'auto' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001' | 'claude-opus-4-6';

export interface GroupInfo {
  folder: string;
  displayName: string;
  hasBlueprint: boolean;
  hasClaude: boolean;
  swarmChildren?: string[];
}

export interface ChannelInfo {
  jid: string;
  name: string;
  folder: string;
}

interface BlueprintStore {
  projectName: string;
  nodes: Node<BlueprintNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  chatLoadingCmd: string | null;  // description of the currently-running command, if any
  assistantModel: AssistantModel;
  channels: ChannelInfo[];

  currentGroupFolder: string | null;
  saveStatus: SaveStatus;

  // Undo/redo
  past: CanvasSnapshot[];
  future: CanvasSnapshot[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // Draft persistence
  saveDraftNow: () => void;

  setProjectName: (name: string) => void;
  setAssistantModel: (model: AssistantModel) => void;
  fetchChannels: () => Promise<void>;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onReconnect: (oldEdge: Edge, newConnection: Connection) => void;
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

const VALID_MODELS: AssistantModel[] = ['auto', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'];
function loadStoredModel(): AssistantModel {
  try {
    const stored = localStorage.getItem('assistantModel') as AssistantModel;
    return VALID_MODELS.includes(stored) ? stored : 'auto';
  } catch { return 'auto'; }
}

export const useStore = create<BlueprintStore>((set, get) => ({
  projectName: 'Untitled Project',
  nodes: [],
  edges: [],
  selectedNodeId: null,
  chatMessages: loadSessionChat(),
  isChatLoading: false,
  chatLoadingCmd: null,
  assistantModel: loadStoredModel(),
  channels: [],
  currentGroupFolder: null,
  saveStatus: 'idle',

  // Undo/redo initial state
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,

  undo: () => {
    set((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      const newPast = s.past.slice(0, -1);
      const newFuture = [{ nodes: s.nodes, edges: s.edges }, ...s.future].slice(0, 50);
      if (s.currentGroupFolder) saveDraft(s.currentGroupFolder, prev);
      return { ...prev, past: newPast, future: newFuture, canUndo: newPast.length > 0, canRedo: true, saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus };
    });
  },

  redo: () => {
    set((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      const newFuture = s.future.slice(1);
      const newPast = [...s.past, { nodes: s.nodes, edges: s.edges }].slice(-50);
      if (s.currentGroupFolder) saveDraft(s.currentGroupFolder, next);
      return { ...next, past: newPast, future: newFuture, canUndo: true, canRedo: newFuture.length > 0, saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus };
    });
  },

  saveDraftNow: () => {
    const { currentGroupFolder, nodes, edges } = get();
    if (currentGroupFolder) saveDraft(currentGroupFolder, { nodes, edges });
  },

  setProjectName: (name) => set({ projectName: name }),

  setAssistantModel: (model) => {
    try { localStorage.setItem('assistantModel', model); } catch { /* ignore */ }
    set({ assistantModel: model });
  },

  fetchChannels: async () => {
    try {
      const r = await fetch('/api/groups/channels');
      const d = await r.json();
      set({ channels: d.channels ?? [] });
    } catch { /* non-fatal */ }
  },

  onNodesChange: (changes) =>
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes) as Node<BlueprintNodeData>[],
      saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
    })),

  onEdgesChange: (changes) =>
    set((s) => {
      const removedIds = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id);
      const hasRemove = removedIds.length > 0;

      // Revert Output nodes whose cross-bot edge was deleted
      let nodes = s.nodes;
      if (hasRemove) {
        const removedEdges = s.edges.filter((e) => removedIds.includes(e.id));
        for (const edge of removedEdges) {
          const sourceNode = s.nodes.find((n) => n.id === edge.source);
          const targetNode = s.nodes.find((n) => n.id === edge.target);
          if (sourceNode?.data.kind === 'output' && targetNode?.type === 'swimlane') {
            nodes = nodes.map((n) =>
              n.id === sourceNode.id
                ? { ...n, data: { ...n.data, destination: 'telegram' as const, targetFolder: undefined } }
                : n,
            );
          }
        }
      }

      return {
        ...(hasRemove ? withHistoryPush(s) : {}),
        edges: applyEdgeChanges(changes, s.edges),
        nodes,
        saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
        ...(hasRemove ? { canUndo: true, canRedo: false } : {}),
      };
    }),

  onConnect: (connection) =>
    set((s) => {
      const sourceNode = s.nodes.find((n) => n.id === connection.source);
      const targetNode = s.nodes.find((n) => n.id === connection.target);
      const isCrossBot = sourceNode?.data.kind === 'output' && targetNode?.type === 'swimlane';

      const newEdges = addEdge({ ...connection, animated: true }, s.edges);

      // Auto-configure the Output node when connected to a Swimlane
      let nodes = s.nodes;
      if (isCrossBot && sourceNode && targetNode) {
        const targetFolder = (targetNode.data as import('./types').SwimlaneNodeData).groupFolder;
        nodes = s.nodes.map((n) =>
          n.id === sourceNode.id
            ? { ...n, data: { ...n.data, destination: 'agent_handoff' as const, targetFolder } }
            : n,
        );
      }

      return {
        ...withHistoryPush(s),
        edges: newEdges,
        nodes,
        saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
        canUndo: true,
        canRedo: false,
      };
    }),

  onReconnect: (oldEdge, newConnection) =>
    set((s) => {
      // Revert Output node if the old edge was a cross-bot handoff
      const oldSource = s.nodes.find((n) => n.id === oldEdge.source);
      const oldTarget = s.nodes.find((n) => n.id === oldEdge.target);
      const wasHandoff = oldSource?.data.kind === 'output' && oldTarget?.type === 'swimlane';

      const newTarget = s.nodes.find((n) => n.id === newConnection.target);
      const isHandoff = oldSource?.data.kind === 'output' && newTarget?.type === 'swimlane';

      // Reconnect the edge
      const updatedEdge = { ...oldEdge, animated: true, style: undefined };
      const newEdges = rfReconnectEdge(updatedEdge, newConnection, s.edges as typeof updatedEdge[]);

      // Update Output node data
      let nodes = s.nodes;
      if (oldSource) {
        if (wasHandoff && !isHandoff) {
          // Moved from swimlane to non-swimlane — revert
          nodes = nodes.map((n) =>
            n.id === oldSource.id
              ? { ...n, data: { ...n.data, destination: 'telegram' as const, targetFolder: undefined } }
              : n,
          );
        } else if (isHandoff && newTarget) {
          // Moved to a different swimlane — update targetFolder
          const targetFolder = (newTarget.data as import('./types').SwimlaneNodeData).groupFolder;
          nodes = nodes.map((n) =>
            n.id === oldSource.id
              ? { ...n, data: { ...n.data, destination: 'agent_handoff' as const, targetFolder } }
              : n,
          );
        }
      }

      return {
        edges: newEdges,
        nodes,
        saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
      };
    }),

  addNode: (kind, position = { x: 200 + Math.random() * 200, y: 150 + Math.random() * 200 }) => {
    const id = nextId();
    const extra = kind === 'swimlane' ? { style: { width: 640, height: 420 }, zIndex: -1 } : {};
    const node: Node<BlueprintNodeData> = { id, type: kind, position, data: defaultData(kind), ...extra };
    set((s) => ({
      ...withHistoryPush(s),
      nodes: [...s.nodes, node],
      selectedNodeId: id,
      saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
      canUndo: true,
      canRedo: false,
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
      ...withHistoryPush(s),
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
      saveStatus: s.currentGroupFolder ? 'unsaved' : s.saveStatus,
      canUndo: true,
      canRedo: false,
    })),

  applyOperations: (ops) => {
    const tempIdMap = new Map<string, string>();
    let opsApplied = 0;

    set((state) => {
      const history = withHistoryPush(state);
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
        ...history,
        nodes,
        edges,
        saveStatus: state.currentGroupFolder ? 'unsaved' : state.saveStatus,
        canUndo: true,
        canRedo: false,
      };
    });

    return opsApplied;
  },

  sendChatMessage: async (text: string) => {
    const { chatMessages, nodes, edges, applyOperations, assistantModel } = get();

    const userMsg: ChatMessage = { id: nextMsgId(), role: 'user', content: text };
    set((s) => {
      const msgs = [...s.chatMessages, userMsg];
      saveSessionChat(msgs);
      return { chatMessages: msgs, isChatLoading: true };
    });

    const graphState = buildGraphSummary(nodes, edges);
    const history = [...chatMessages, userMsg].map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, graphState, model: assistantModel }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      // Read NDJSON stream — each line is a JSON event
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotResult = false;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            continue; // genuinely malformed JSON line — skip
          }
          if (event.type === 'running') {
            set({ chatLoadingCmd: (event.description as string) || (event.cmd as string) });
          } else if (event.type === 'result') {
            const opsApplied = Array.isArray(event.operations) && event.operations.length
              ? applyOperations(event.operations as Parameters<typeof applyOperations>[0])
              : 0;
            const assistantMsg: ChatMessage = {
              id: nextMsgId(),
              role: 'assistant',
              content: event.message as string,
              opsApplied,
              commandLog: event.commandLog as ChatMessage['commandLog'],
              pendingCommand: event.pendingCommand as ChatMessage['pendingCommand'],
              options: event.options as string[] | undefined,
            };
            set((s) => {
              const msgs = [...s.chatMessages, assistantMsg];
              saveSessionChat(msgs);
              return { chatMessages: msgs };
            });
            gotResult = true;
          } else if (event.type === 'error') {
            streamError = (event.error as string) || 'Unknown error';
          }
        }
      }

      if (!gotResult) {
        throw new Error(streamError ?? 'No response received — the assistant may still be working. Try asking again.');
      }
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: nextMsgId(),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      };
      set((s) => {
        const msgs = [...s.chatMessages, errorMsg];
        saveSessionChat(msgs);
        return { chatMessages: msgs };
      });
    } finally {
      set({ isChatLoading: false, chatLoadingCmd: null });
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
        body: JSON.stringify({ messages: history, graphState, confirmedCommands: [confirmedCmd], model: get().assistantModel }),
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((e as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotResult = false;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(trimmed) as Record<string, unknown>; }
          catch { continue; }
          if (event.type === 'running') {
            set({ chatLoadingCmd: (event.description as string) || (event.cmd as string) });
          } else if (event.type === 'result') {
            const opsApplied = Array.isArray(event.operations) && event.operations.length
              ? applyOperations(event.operations as Operation[])
              : 0;
            set((s) => ({
              chatMessages: [...s.chatMessages, {
                id: nextMsgId(),
                role: 'assistant' as const,
                content: event.message as string,
                opsApplied,
                commandLog: event.commandLog as CommandLogEntry[] | undefined,
                pendingCommand: event.pendingCommand as { cmd: string; description: string } | undefined,
                options: event.options as string[] | undefined,
              }],
            }));
            gotResult = true;
          } else if (event.type === 'error') {
            streamError = (event.error as string) || 'Unknown error';
          }
        }
      }

      if (!gotResult) {
        throw new Error(streamError ?? 'No response received — try asking again.');
      }
    } catch (err) {
      set((s) => ({
        chatMessages: [...s.chatMessages, {
          id: nextMsgId(),
          role: 'assistant' as const,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
      }));
    } finally {
      set({ isChatLoading: false, chatLoadingCmd: null });
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
    lsSet(LS_LAST_GROUP, folder);
    // Clear nodes/edges immediately so stale data can't be auto-drafted for the new folder
    set({ currentGroupFolder: folder, projectName: folder, saveStatus: 'idle', nodes: [], edges: [], selectedNodeId: null, past: [], future: [], canUndo: false, canRedo: false });

    try {
      const res = await fetch(`/api/groups/${folder}/blueprint`);
      if (res.status === 404) {
        // Check for a local draft — only use it if it actually has nodes
        const draft = loadDraft(folder);
        if (draft && draft.nodes.length > 0) {
          set({ nodes: draft.nodes, edges: draft.edges, saveStatus: 'unsaved' });
        } else {
          set({ nodes: [], edges: [], saveStatus: 'idle' });
        }
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

      // Prefer a local draft only if it actually has content (guards against empty draft corruption)
      const draft = loadDraft(folder);
      if (draft && draft.nodes.length > 0) {
        set({ nodes: draft.nodes, edges: draft.edges, saveStatus: 'unsaved' });
      } else {
        if (draft) clearDraft(folder); // discard empty/corrupted draft
        set({ nodes: project.nodes ?? [], edges: project.edges ?? [], saveStatus: 'saved' });
      }
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
        body: JSON.stringify(project),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error);
      }
      clearDraft(currentGroupFolder);
      set({ saveStatus: 'saved' });
    } catch (err) {
      console.error('[saveCurrentGroup]', err);
      set({ saveStatus: 'error' });
    }
  },

  closeGroup: () => {
    lsDel(LS_LAST_GROUP);
    set({
      currentGroupFolder: null,
      projectName: 'Untitled Project',
      nodes: [],
      edges: [],
      selectedNodeId: null,
      saveStatus: 'idle',
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
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
    case 'swimlane':
      return { kind: 'swimlane', label: op.label, groupFolder: op.groupFolder ?? 'bot_container', width: op.width ?? 640, height: op.height ?? 420 };
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
    if (d.kind === 'swimlane') return `- ${n.id}: swimlane "${d.label}" (bot: ${d.groupFolder})`;
    if (d.kind === 'comment') return `- ${n.id}: comment "${d.text}"`;
    return `- ${n.id}: ${d.kind} "${d.label}"${detail}`;
  });

  const edgeLines = edges.map((e) => {
    const handlePart = e.sourceHandle ? ` (${e.sourceHandle})` : '';
    return `- ${e.source}${handlePart} → ${e.target}`;
  });

  return `Nodes:\n${nodeLines.join('\n')}\n\nConnections:\n${edgeLines.join('\n') || '(none)'}`;
}
