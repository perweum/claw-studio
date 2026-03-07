import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { NODE_KIND_META, type NodeKind } from '../types';

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram', slack: 'Slack', whatsapp: 'WhatsApp',
  discord: 'Discord', github: 'GitHub', gmail: 'Gmail',
};

function detectChannelLabel(folder: string): string | null {
  for (const [prefix, label] of Object.entries(CHANNEL_LABELS)) {
    if (folder === prefix || folder.startsWith(prefix + '_')) return label;
  }
  return null;
}

const PRIMARY_KINDS: NodeKind[] = ['agent', 'tool', 'router', 'output'];
const PRIMARY_STYLE: Record<string, string> = {
  agent: 'btn-agent', tool: 'btn-tool', router: 'btn-router', output: 'btn-output',
};

const SAVE_STATUS_LABELS: Record<string, string> = {
  idle: '', unsaved: '● Unsaved', saving: '↑ Saving…', saved: '✓ Saved', error: '✕ Error',
};
const SAVE_STATUS_COLORS: Record<string, string> = {
  idle: 'var(--text-muted)', unsaved: '#f59e0b', saving: 'var(--text-muted)',
  saved: 'var(--accent-output)', error: 'var(--danger)',
};

type DeployState = 'idle' | 'deploying' | 'done' | 'error';

function formatBotName(folder: string): string {
  return folder.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

interface ToolbarProps {
  onOpenPalette: () => void;
  onOpenGroupPicker: () => void;
  onNewBot: () => void;
}

export function Toolbar({ onOpenPalette, onOpenGroupPicker, onNewBot }: ToolbarProps) {
  const { nodes, addNode, currentGroupFolder, saveStatus, saveCurrentGroup, exportProject, deployToGroup } = useStore();
  const [deployState, setDeployState] = useState<DeployState>('idle');
  const [deployPreview, setDeployPreview] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployActions, setDeployActions] = useState<{ done: string[]; manual: string[] } | null>(null);
  const [channels, setChannels] = useState<Array<{ jid: string; name: string; folder: string }>>([]);
  const [scheduleChannelJids, setScheduleChannelJids] = useState<Record<string, string>>({});
  const [registeringSchedule, setRegisteringSchedule] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasAgentNode = nodes.some(n => n.type === 'agent');

  // Load channels for schedule registration
  useEffect(() => {
    fetch('/api/groups/channels')
      .then(r => r.json())
      .then(d => setChannels(d.channels ?? []))
      .catch(() => {/* non-fatal */});
  }, []);

  // Cmd+S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (currentGroupFolder) saveCurrentGroup();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentGroupFolder, saveCurrentGroup]);

  async function handleRegisterAndRedeploy(cronExpr: string) {
    if (!currentGroupFolder) return;
    const channelJid = scheduleChannelJids[cronExpr];
    if (!channelJid) return;
    setRegisteringSchedule(cronExpr);
    try {
      await fetch(`/api/groups/${currentGroupFolder}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelJid }),
      });
      // Re-deploy now that the group is registered
      setDeployState('idle');
      setRegisteringSchedule(null);
      await handleDeploy();
    } catch {
      setRegisteringSchedule(null);
    }
  }

  // Close menu when clicking outside
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  function handleBackup() {
    setMenuOpen(false);
    const a = document.createElement('a');
    a.href = '/api/backup';
    a.click();
  }

  async function handleDeploy() {
    setDeployState('deploying');
    setDeployError(null);
    setDeployPreview(null);
    setDeployActions(null);
    const result = await deployToGroup();
    if (result.ok) {
      setDeployPreview(result.preview ?? '');
      setDeployActions(result.actions ?? null);
      setDeployState('done');
    } else {
      setDeployError(result.error ?? 'Unknown error');
      setDeployState('error');
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar__left">
          <span className="toolbar__logo">◈ Claw Studio</span>
          <button
            className={`toolbar__group-btn ${currentGroupFolder ? 'toolbar__group-btn--active' : ''}`}
            onClick={onOpenGroupPicker}
            title="Switch bot"
          >
            {currentGroupFolder ? (
              <><span className="toolbar__group-dot" />{formatBotName(currentGroupFolder)}</>
            ) : (
              'My bots'
            )}
          </button>
          <button
            className="toolbar__group-btn toolbar__group-btn--new"
            onClick={onNewBot}
            title="Create a new bot"
          >
            + New bot
          </button>
          {saveStatus !== 'idle' && (
            <span className="toolbar__save-status" style={{ color: SAVE_STATUS_COLORS[saveStatus] }}>
              {SAVE_STATUS_LABELS[saveStatus]}
            </span>
          )}
        </div>

        <div className="toolbar__center">
          {PRIMARY_KINDS.map((kind) => (
            <button key={kind} className={`toolbar__btn ${PRIMARY_STYLE[kind]}`} onClick={() => addNode(kind)}>
              + {NODE_KIND_META[kind].label}
            </button>
          ))}
          <button className="toolbar__btn btn-secondary toolbar__btn--palette" onClick={onOpenPalette} title="Command palette (⌘K)">
            ⌘K
          </button>
        </div>

        <div className="toolbar__right">
          {currentGroupFolder ? (
            <>
              <button
                className={`toolbar__btn btn-secondary ${saveStatus === 'saving' ? 'toolbar__btn--saving' : ''}`}
                onClick={saveCurrentGroup}
                disabled={saveStatus === 'saving' || saveStatus === 'saved'}
                title="Save blueprint (⌘S)"
              >
                {saveStatus === 'saving' ? 'Saving…' : 'Save'}
              </button>
              <button
                className={`toolbar__btn btn-deploy ${deployState === 'deploying' ? 'toolbar__btn--saving' : ''}`}
                onClick={handleDeploy}
                disabled={deployState === 'deploying' || !hasAgentNode}
                title={hasAgentNode ? 'Generate CLAUDE.md from this blueprint and deploy to the group' : 'Add an Agent node to deploy'}
              >
                {deployState === 'deploying' ? 'Deploying…' : '⬆ Deploy'}
              </button>
            </>
          ) : (
            <button className="toolbar__btn btn-secondary" onClick={exportProject} title="Export blueprint as JSON">
              Export
            </button>
          )}

          {/* Overflow menu */}
          <div className="toolbar__menu-wrap" ref={menuRef}>
            <button
              className={`toolbar__btn btn-secondary toolbar__menu-btn ${menuOpen ? 'toolbar__menu-btn--open' : ''}`}
              onClick={() => setMenuOpen(o => !o)}
              title="More options"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="toolbar__menu">
                <button className="toolbar__menu-item" onClick={handleBackup}>
                  <span className="toolbar__menu-icon">↓</span>
                  Back up all bots
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Deploy result modal */}
      {(deployState === 'done' || deployState === 'error') && (
        <div className="deploy-modal-backdrop" onClick={() => setDeployState('idle')}>
          <div className="deploy-modal" onClick={e => e.stopPropagation()}>
            {deployState === 'done' ? (
              <>
                <div className="deploy-modal__header deploy-modal__header--success">
                  <span>✓ Deployed to {currentGroupFolder}</span>
                  <button className="deploy-modal__close" onClick={() => setDeployState('idle')}>✕</button>
                </div>

                {deployActions && (
                  <div className="deploy-modal__actions">
                    {deployActions.done.length > 0 && (
                      <div>
                        <div className="deploy-modal__section-label">Done automatically</div>
                        <ul className="deploy-modal__action-list">
                          {deployActions.done.map((item, i) => (
                            <li key={i} className="deploy-modal__action-done">
                              <span>✓</span><span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {deployActions.manual.length > 0 && (
                      <>
                        {deployActions.done.length > 0 && <div className="deploy-modal__divider" />}
                        <div>
                          <div className="deploy-modal__section-label">Still needs your attention</div>
                          <ul className="deploy-modal__action-list">
                            {deployActions.manual.map((item, i) => {
                              const scheduleMatch = item.match(/^__UNREGISTERED_SCHEDULE__:(.+)$/);
                              if (scheduleMatch) {
                                const cronExpr = scheduleMatch[1];
                                const selectedJid = scheduleChannelJids[cronExpr] ?? '';
                                const isRegistering = registeringSchedule === cronExpr;
                                return (
                                  <li key={i} className="deploy-modal__action-schedule">
                                    <div className="deploy-modal__schedule-header">
                                      <span className="deploy-modal__action-icon">!</span>
                                      <span>Schedule <code>{cronExpr}</code> — choose an output channel to activate</span>
                                    </div>
                                    <div className="deploy-modal__schedule-fix">
                                      <select
                                        className="deploy-modal__channel-select"
                                        value={selectedJid}
                                        onChange={e => setScheduleChannelJids(prev => ({ ...prev, [cronExpr]: e.target.value }))}
                                      >
                                        <option value="">— select channel —</option>
                                        {channels.map(ch => {
                                          const label = detectChannelLabel(ch.folder);
                                          return (
                                            <option key={ch.jid} value={ch.jid}>
                                              {label ? `${label} · ` : ''}{ch.name}
                                            </option>
                                          );
                                        })}
                                      </select>
                                      <button
                                        className="deploy-modal__register-btn"
                                        disabled={!selectedJid || isRegistering}
                                        onClick={() => handleRegisterAndRedeploy(cronExpr)}
                                      >
                                        {isRegistering ? 'Registering…' : 'Register & Redeploy'}
                                      </button>
                                    </div>
                                  </li>
                                );
                              }
                              return (
                                <li key={i} className="deploy-modal__action-manual">
                                  <span>!</span><span>{item}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </>
                    )}

                    {deployActions.manual.length === 0 && (
                      <p style={{ fontSize: '12px', color: 'var(--accent-output)', margin: 0 }}>
                        All done! Your bot is ready to use.
                      </p>
                    )}
                  </div>
                )}

                <div className="deploy-modal__preview-label">Generated CLAUDE.md:</div>
                <pre className="deploy-modal__preview">{deployPreview}</pre>
              </>
            ) : (
              <>
                <div className="deploy-modal__header deploy-modal__header--error">
                  <span>✕ Deploy failed</span>
                  <button className="deploy-modal__close" onClick={() => setDeployState('idle')}>✕</button>
                </div>
                <p className="deploy-modal__desc">{deployError}</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
