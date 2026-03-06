import { useEffect, useRef, useState } from 'react';
import { useStore, type GroupInfo } from '../store';

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

interface GroupPickerProps {
  onClose: () => void;
  initialMode?: 'list' | 'new';
}

export function GroupPicker({ onClose, initialMode = 'list' }: GroupPickerProps) {
  const { currentGroupFolder, openGroup, closeGroup, createBot } = useStore();
  const [mode, setMode] = useState<'list' | 'new'>(initialMode);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New bot form state
  const [botName, setBotName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/groups')
      .then((r) => r.json())
      .then((d) => setGroups(d.groups ?? []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (mode === 'new') setTimeout(() => nameInputRef.current?.focus(), 50);
  }, [mode]);

  function pick(folder: string) {
    openGroup(folder);
    onClose();
  }

  async function handleCreate() {
    const name = botName.trim();
    if (!name) { setCreateError('Enter a name for your bot.'); return; }
    setCreating(true);
    setCreateError(null);
    try {
      await createBot(name);
      onClose();
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
            <button className="group-picker__close-btn" onClick={() => { closeGroup(); onClose(); }}>
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
            {groups.map((g) => {
              const channel = detectChannel(g.folder);
              const isActive = g.folder === currentGroupFolder;
              return (
                <button
                  key={g.folder}
                  className={`palette__item group-picker__item ${isActive ? 'group-picker__item--active' : ''}`}
                  onClick={() => pick(g.folder)}
                >
                  <div className="group-picker__item-main">
                    <span className="group-picker__bot-name">{formatBotName(g.folder)}</span>
                    <div className="group-picker__item-meta">
                      {channel && (
                        <span className="group-picker__channel-badge" style={{ background: channel.color + '22', color: channel.color, border: `1px solid ${channel.color}44` }}>
                          {channel.label}
                        </span>
                      )}
                      {!g.hasClaude && (
                        <span className="group-picker__status-badge group-picker__status-badge--warn">no CLAUDE.md</span>
                      )}
                      {g.hasBlueprint && (
                        <span className="group-picker__status-badge">blueprint</span>
                      )}
                    </div>
                  </div>
                  {isActive && <span className="group-picker__current-badge">editing</span>}
                </button>
              );
            })}
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
