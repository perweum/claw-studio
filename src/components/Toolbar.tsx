import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { NODE_KIND_META, type NodeKind } from '../types';

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

  const hasAgentNode = nodes.some(n => n.type === 'agent');

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
          <span className="toolbar__logo">◈ Blueprint</span>
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
                            {deployActions.manual.map((item, i) => (
                              <li key={i} className="deploy-modal__action-manual">
                                <span>!</span><span>{item}</span>
                              </li>
                            ))}
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
