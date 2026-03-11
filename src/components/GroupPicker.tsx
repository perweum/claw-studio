import React, { useEffect, useRef, useState } from 'react';
import { useStore, type GroupInfo } from '../store';
import type { AdditionalMount } from '../types';

// ── Bot Settings Modal ────────────────────────────────────────────────────────

function BotSettingsModal({ folder, onClose }: { folder: string; onClose: () => void }) {
  const [mounts, setMounts] = useState<AdditionalMount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    fetch(`/api/groups/${folder}/settings`)
      .then(r => r.json())
      .then(({ additionalMounts }) => setMounts(additionalMounts ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [folder]);

  function addMount() {
    setMounts(m => [...m, { hostPath: '', containerPath: '', readonly: true }]);
  }

  function updateMount(i: number, patch: Partial<AdditionalMount>) {
    setMounts(m => m.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, ...patch };
      // Auto-fill containerPath from last path segment when it hasn't been set yet
      if ('hostPath' in patch && !item.containerPath) {
        updated.containerPath = patch.hostPath!.split('/').filter(Boolean).pop() ?? '';
      }
      return updated;
    }));
  }

  async function save() {
    setSaveState('saving');
    try {
      await fetch(`/api/groups/${folder}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ additionalMounts: mounts.filter(m => m.hostPath.trim()) }),
      });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('idle');
    }
  }

  return (
    <div className="bot-settings-backdrop" onClick={onClose}>
      <div className="bot-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="bot-settings-modal__header">
          <span>Bot settings — {formatBotName(folder)}</span>
          <button className="bot-settings-modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="bot-settings-modal__body">
          <div className="bot-settings__section-title">File access</div>
          <p className="bot-settings__section-desc">
            Give this bot access to folders on your computer. Useful for bots that need to read your code, documents, or projects.
          </p>

          {loading ? (
            <div className="bot-settings__loading">Loading…</div>
          ) : (
            <>
              {mounts.length > 0 && (
                <div className="bot-settings__mount-header">
                  <span>Folder on your computer</span>
                  <span>Name inside bot</span>
                  <span>Access</span>
                  <span />
                </div>
              )}
              {mounts.map((m, i) => (
                <div key={i} className="bot-settings__mount-row">
                  <input
                    className="bot-settings__mount-input"
                    value={m.hostPath}
                    placeholder="/Users/you/my-project"
                    onChange={e => updateMount(i, { hostPath: e.target.value })}
                    spellCheck={false}
                  />
                  <input
                    className="bot-settings__mount-input bot-settings__mount-input--short"
                    value={m.containerPath}
                    placeholder="my-project"
                    onChange={e => updateMount(i, { containerPath: e.target.value })}
                    spellCheck={false}
                  />
                  <select
                    className="bot-settings__mount-select"
                    value={m.readonly ? 'readonly' : 'readwrite'}
                    onChange={e => updateMount(i, { readonly: e.target.value === 'readonly' })}
                  >
                    <option value="readonly">Read only</option>
                    <option value="readwrite">Read &amp; write</option>
                  </select>
                  <button className="bot-settings__mount-remove" onClick={() => setMounts(m2 => m2.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}

              <button className="bot-settings__add-btn" onClick={addMount}>+ Add folder</button>
              {mounts.length > 0 && (
                <p className="bot-settings__hint">Changes take effect the next time this bot runs.</p>
              )}
            </>
          )}
        </div>

        <div className="bot-settings-modal__footer">
          <button className="bot-settings-modal__save" onClick={save} disabled={saveState === 'saving'}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

const CHANNEL_LABELS: Record<string, { label: string; color: string }> = {
  telegram:  { label: 'Telegram',  color: '#2ca5e0' },
  slack:     { label: 'Slack',     color: '#4a154b' },
  whatsapp:  { label: 'WhatsApp',  color: '#25d366' },
  discord:   { label: 'Discord',   color: '#5865f2' },
  github:    { label: 'GitHub',    color: '#6e7681' },
  gmail:     { label: 'Gmail',     color: '#ea4335' },
  main:      { label: 'Main',      color: '#7c3aed' },
  global:    { label: 'Global',    color: '#374151' },
};

function detectChannel(folder: string): { label: string; color: string } | null {
  for (const [prefix, info] of Object.entries(CHANNEL_LABELS)) {
    if (folder === prefix || folder.startsWith(prefix + '_')) return info;
  }
  return null;
}

function formatBotName(folder: string): string {
  return folder.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const ADDABLE_CHANNELS: Array<{ platform: string; label: string; color: string; skillMsg: string }> = [
  { platform: 'telegram', label: 'Telegram', color: '#2ca5e0', skillMsg: 'I want to add a new Telegram channel to nanoclaw' },
  { platform: 'slack',    label: 'Slack',    color: '#4a154b', skillMsg: 'I want to add a Slack channel to nanoclaw' },
  { platform: 'whatsapp', label: 'WhatsApp', color: '#25d366', skillMsg: 'I want to add WhatsApp as a channel to nanoclaw' },
  { platform: 'discord',  label: 'Discord',  color: '#5865f2', skillMsg: 'I want to add a Discord channel to nanoclaw' },
];

// ── BotRow ────────────────────────────────────────────────────────────────────

interface BotRowProps {
  g: GroupInfo;
  isActive: boolean;
  isMenuOpen: boolean;
  menuRef: React.RefObject<HTMLDivElement>;
  hasChildren: boolean;
  isExpanded: boolean;
  isChild?: boolean;
  isRenaming: boolean;
  renameValue: string;
  onExpand?: () => void;
  onPick: (folder: string) => void;
  onMenuToggle: (folder: string) => void;
  onSettings: (folder: string) => void;
  onRenameStart: (folder: string, currentName: string) => void;
  onRenameChange: (val: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

function BotRow({ g, isActive, isMenuOpen, menuRef, hasChildren, isExpanded, isChild, isRenaming, renameValue, onExpand, onPick, onMenuToggle, onSettings, onRenameStart, onRenameChange, onRenameCommit, onRenameCancel }: BotRowProps) {
  const channel = detectChannel(g.folder);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) setTimeout(() => renameRef.current?.select(), 30);
  }, [isRenaming]);

  return (
    <div className="group-picker__item-wrap group-picker__parent-row">
      {hasChildren ? (
        <button className="group-picker__expand-btn" onClick={onExpand} title={isExpanded ? 'Collapse' : 'Expand swarm'}>
          {isExpanded ? '▾' : '▸'}
        </button>
      ) : (
        <span className="group-picker__expand-spacer" />
      )}

      {isRenaming ? (
        <div className="group-picker__rename-wrap">
          <input
            ref={renameRef}
            className="group-picker__rename-input"
            value={renameValue}
            onChange={e => onRenameChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel(); }}
            onBlur={onRenameCommit}
            spellCheck={false}
          />
        </div>
      ) : (
        <button
          className={`palette__item group-picker__item ${isActive ? 'group-picker__item--active' : ''}`}
          style={{ flex: 1, minWidth: 0 }}
          onClick={() => onPick(g.folder)}
        >
          <div className="group-picker__item-main">
            <span className="group-picker__bot-name">{g.displayName}</span>
            <div className="group-picker__item-meta">
              {channel && (
                <span className="group-picker__channel-badge" style={{ background: channel.color + '22', color: channel.color, border: `1px solid ${channel.color}44` }}>
                  {channel.label}
                </span>
              )}
              {isChild && <span className="group-picker__child-badge">sub-bot</span>}
              {!g.hasClaude && (
                <span className="group-picker__status-badge group-picker__status-badge--warn">no CLAUDE.md</span>
              )}
            </div>
          </div>
          {isActive && <span className="group-picker__current-badge">open</span>}
        </button>
      )}

      {/* ⋯ menu */}
      {!isRenaming && (
        <div className="group-picker__item-menu" ref={isMenuOpen ? menuRef : undefined}>
          <button
            className="group-picker__menu-btn"
            title="Bot options"
            onClick={e => { e.stopPropagation(); onMenuToggle(g.folder); }}
          >
            ···
          </button>
          {isMenuOpen && (
            <div className="group-picker__menu-dropdown">
              <button className="group-picker__menu-item" onClick={e => { e.stopPropagation(); onRenameStart(g.folder, g.displayName); }}>
                Rename
              </button>
              <button className="group-picker__menu-item" onClick={e => { e.stopPropagation(); onSettings(g.folder); }}>
                Bot settings
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── GroupPicker ───────────────────────────────────────────────────────────────

interface GroupPickerProps {
  onClose: () => void;
  initialMode?: 'list' | 'new';
  onNewChannel?: (setupMessage: string) => void;
}

export function GroupPicker({ onClose, initialMode = 'list', onNewChannel }: GroupPickerProps) {
  const { currentGroupFolder, openGroup, closeGroup, createBot } = useStore();
  const [mode, setMode] = useState<'list' | 'new'>(initialMode);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New bot form state
  const [botName, setBotName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Array<{ jid: string; name: string; folder: string }>>([]);
  const [selectedChannelJid, setSelectedChannelJid] = useState('');
  const [pendingChannel, setPendingChannel] = useState<{ label: string; skillMsg: string } | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // ⋯ menu, settings modal, and rename state
  const [menuFolder, setMenuFolder] = useState<string | null>(null);
  const [settingsFolder, setSettingsFolder] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Close menu on outside click
  useEffect(() => {
    if (!menuFolder) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuFolder(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuFolder]);

  useEffect(() => {
    fetch('/api/groups')
      .then((r) => r.json())
      .then((d) => {
        const gs: GroupInfo[] = d.groups ?? [];
        setGroups(gs);
        // Default-expand all swarm parents
        const parents = gs.filter(g => (g.swarmChildren ?? []).length > 0).map(g => g.folder);
        setExpanded(new Set(parents));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/groups/channels')
      .then((r) => r.json())
      .then((d) => setChannels(d.channels ?? []))
      .catch(() => {/* non-fatal */});
  }, []);

  useEffect(() => {
    if (mode === 'new') setTimeout(() => nameInputRef.current?.focus(), 50);
  }, [mode]);

  function startRename(folder: string, currentName: string) {
    setMenuFolder(null);
    setRenamingFolder(folder);
    setRenameValue(currentName);
  }

  async function commitRename() {
    const name = renameValue.trim();
    setRenamingFolder(null);
    if (!name || !renamingFolder) return;
    await fetch(`/api/groups/${renamingFolder}/name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => {});
    setGroups(gs => gs.map(g => g.folder === renamingFolder ? { ...g, displayName: name } : g));
  }

  function cancelRename() {
    setRenamingFolder(null);
    setRenameValue('');
  }

  function pick(folder: string) {
    if (folder === currentGroupFolder) { onClose(); return; }
    const { saveStatus } = useStore.getState();
    if (saveStatus === 'unsaved') {
      if (!confirm('You have unsaved changes. Open a different bot and lose them?')) return;
    }
    openGroup(folder);
    onClose();
  }

  async function handleCreate() {
    const name = botName.trim();
    if (!name) { setCreateError('Enter a name for your bot.'); return; }
    setCreating(true);
    setCreateError(null);
    try {
      await createBot(name, selectedChannelJid || undefined);
      onClose();
      if (pendingChannel) onNewChannel?.(pendingChannel.skillMsg);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette group-picker" onClick={(e) => e.stopPropagation()}>

        {/* Header with tabs */}
        <div className="group-picker__header">
          <button
            className={`group-picker__tab ${mode === 'list' ? 'group-picker__tab--active' : ''}`}
            onClick={() => setMode('list')}
          >
            My bots
          </button>
          <button
            className={`group-picker__tab ${mode === 'new' ? 'group-picker__tab--active' : ''}`}
            onClick={() => setMode('new')}
          >
            + New bot
          </button>
          {currentGroupFolder && mode === 'list' && (
            <button className="group-picker__close-btn" onClick={() => {
              const { saveStatus } = useStore.getState();
              if (saveStatus === 'unsaved' && !confirm('You have unsaved changes. Close and lose them?')) return;
              closeGroup(); onClose();
            }}>
              Close current
            </button>
          )}
        </div>

        {/* My bots list */}
        {mode === 'list' && (
          <div className="palette__list">
            {loading && <div className="palette__empty">Loading…</div>}
            {error && <div className="palette__empty" style={{ color: 'var(--danger)' }}>Error: {error}</div>}
            {!loading && !error && groups.length === 0 && (
              <div className="palette__empty">No bots yet — create your first one above.</div>
            )}
            {!loading && !error && (() => {
              // Determine which folders appear as children of some other bot
              const allChildren = new Set(groups.flatMap((g) => g.swarmChildren ?? []));
              // Top-level = not a child of anyone
              const topLevel = groups.filter((g) => !allChildren.has(g.folder));

              return topLevel.map((g) => {
                const children = (g.swarmChildren ?? [])
                  .map((cf) => groups.find((x) => x.folder === cf))
                  .filter(Boolean) as GroupInfo[];
                const hasChildren = children.length > 0;
                const isExpanded = expanded.has(g.folder);

                const sharedRowProps = {
                  menuRef,
                  onPick: pick,
                  onMenuToggle: (folder: string) => setMenuFolder((f) => f === folder ? null : folder),
                  onSettings: (folder: string) => { setMenuFolder(null); setSettingsFolder(folder); },
                  onRenameStart: startRename,
                  onRenameChange: setRenameValue,
                  onRenameCommit: commitRename,
                  onRenameCancel: cancelRename,
                };

                return (
                  <div key={g.folder} className="group-picker__swarm-parent">
                    <BotRow
                      {...sharedRowProps}
                      g={g}
                      isActive={g.folder === currentGroupFolder}
                      isMenuOpen={menuFolder === g.folder}
                      hasChildren={hasChildren}
                      isExpanded={isExpanded}
                      isRenaming={renamingFolder === g.folder}
                      renameValue={renameValue}
                      onExpand={() => setExpanded((s) => {
                        const next = new Set(s);
                        next.has(g.folder) ? next.delete(g.folder) : next.add(g.folder);
                        return next;
                      })}
                    />
                    {hasChildren && isExpanded && (
                      <div className="group-picker__children">
                        {children.map((child) => (
                          <div key={child.folder} className="group-picker__child-row">
                            <BotRow
                              {...sharedRowProps}
                              g={child}
                              isActive={child.folder === currentGroupFolder}
                              isMenuOpen={menuFolder === child.folder}
                              hasChildren={false}
                              isExpanded={false}
                              isChild
                              isRenaming={renamingFolder === child.folder}
                              renameValue={renameValue}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              });
            })()}

            {settingsFolder && (
              <BotSettingsModal folder={settingsFolder} onClose={() => setSettingsFolder(null)} />
            )}
          </div>
        )}

        {/* New bot form */}
        {mode === 'new' && (
          <div className="group-picker__new-form">
            <p className="group-picker__new-desc">
              Give your bot a name. This creates a new isolated workspace for it in nanoclaw.
            </p>
            <input
              ref={nameInputRef}
              className="setup-wizard__input"
              type="text"
              placeholder="e.g. GitHub Reviewer, Morning Briefing…"
              value={botName}
              onChange={(e) => { setBotName(e.target.value); setCreateError(null); }}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              spellCheck={false}
            />
            {createError && <p className="setup-wizard__error">{createError}</p>}
            <div className="group-picker__new-hint">
              Folder name: <code>{botName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '') || '…'}</code>
            </div>
            <div className="group-picker__new-channel">
              <label className="group-picker__new-channel-label">Output channel (optional)</label>
              {channels.length > 0 ? (
                <>
                  <select
                    className="group-picker__channel-select"
                    value={selectedChannelJid}
                    onChange={(e) => setSelectedChannelJid(e.target.value)}
                  >
                    <option value="">— none / set up later —</option>
                    {channels.map((ch) => {
                      const info = detectChannel(ch.folder);
                      return (
                        <option key={ch.jid} value={ch.jid}>
                          {info ? `${info.label} · ` : ''}{ch.name}
                        </option>
                      );
                    })}
                  </select>
                  {selectedChannelJid && (() => {
                    const ch = channels.find(c => c.jid === selectedChannelJid);
                    const info = ch ? detectChannel(ch.folder) : null;
                    return ch ? (
                      <span className="group-picker__channel-confirm">
                        ✓ Bot output will appear in your existing {info?.label ?? ''} chat: <strong>{ch.name}</strong>
                      </span>
                    ) : null;
                  })()}
                  {!selectedChannelJid && (
                    <span className="group-picker__new-channel-hint">
                      Needed if your bot has a schedule trigger — determines where output is sent.
                    </span>
                  )}
                </>
              ) : (
                <span className="group-picker__new-channel-hint">
                  No channels connected yet. Set one up below to enable scheduled output.
                </span>
              )}

              {/* New channel setup */}
              {onNewChannel && (
                <div className="group-picker__new-channel-setup">
                  <span className="group-picker__new-channel-setup-label">
                    {channels.length > 0 ? 'Or connect a new channel:' : 'Connect a channel:'}
                  </span>
                  <div className="group-picker__channel-btns">
                    {ADDABLE_CHANNELS.map(({ platform, label, color, skillMsg }) => (
                      <button
                        key={platform}
                        className={`group-picker__channel-add-btn ${pendingChannel?.label === label ? 'group-picker__channel-add-btn--selected' : ''}`}
                        style={{ '--ch': color, borderColor: color + '66', color } as React.CSSProperties}
                        onClick={() => setPendingChannel(p => p?.label === label ? null : { label, skillMsg })}
                      >
                        {pendingChannel?.label === label ? '✓ ' : '+ '}{label}
                      </button>
                    ))}
                  </div>
                  {pendingChannel && (
                    <span className="group-picker__channel-confirm">
                      The assistant will help you set up {pendingChannel.label} after the bot is created.
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="group-picker__new-actions">
              <button className="setup-wizard__skip" onClick={() => setMode('list')}>Back</button>
              <button
                className="setup-wizard__submit"
                onClick={handleCreate}
                disabled={creating || !botName.trim()}
              >
                {creating ? 'Creating…' : 'Create bot'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
