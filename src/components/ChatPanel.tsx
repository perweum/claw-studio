import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

// ── Message renderer ─────────────────────────────────────────────────────────

function renderMessage(text: string): React.ReactNode {
  const segments: React.ReactNode[] = [];
  let key = 0;
  let lastIndex = 0;

  // Split on fenced code blocks ```...```
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;

  while ((m = codeBlockRe.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push(<span key={key++}>{renderLines(text.slice(lastIndex, m.index), key)}</span>);
      key += 100;
    }
    const lang = m[1] || 'bash';
    const code = m[2].trim();
    segments.push(
      <div key={key++} className="chat-code-block">
        <div className="chat-code-block__header">
          <span className="chat-code-block__lang">{lang}</span>
          <button
            className="chat-code-block__copy"
            onClick={() => navigator.clipboard.writeText(code)}
          >
            Copy
          </button>
        </div>
        <pre className="chat-code-block__pre">{code}</pre>
      </div>
    );
    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) {
    segments.push(<span key={key++}>{renderLines(text.slice(lastIndex), key)}</span>);
  }

  return <>{segments}</>;
}

function renderLines(text: string, baseKey: number): React.ReactNode[] {
  return text.split('\n').map((line, i) => {
    const isNumbered = /^\d+\.\s/.test(line);
    const isBullet   = /^[•\-\*]\s/.test(line) || /^\s+[•\-\*]\s/.test(line);
    const isHeader   = line.endsWith(':') && line.length < 80 && !line.startsWith(' ');

    return (
      <span
        key={baseKey + i}
        className={
          isNumbered ? 'chat-line chat-line--step' :
          isBullet   ? 'chat-line chat-line--bullet' :
          isHeader   ? 'chat-line chat-line--header' :
          'chat-line'
        }
      >
        {renderInline(line)}
        {'\n'}
      </span>
    );
  });
}

function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let last = 0, k = 0, m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[0].startsWith('**')) {
      out.push(<strong key={k++}>{m[2]}</strong>);
    } else {
      out.push(<code key={k++} className="chat-inline-code">{m[3]}</code>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ── Welcome screen ───────────────────────────────────────────────────────────

const EXAMPLES = [
  'Build a morning briefing bot',
  'Set up a Telegram channel',
  'Create a GitHub PR reviewer',
  'Add weather to my bot',
];

function WelcomeScreen({ onExample }: { onExample: (text: string) => void }) {
  return (
    <div className="chat-welcome">
      <div className="chat-welcome__logo">
        <span className="chat-welcome__mark">◈</span>
        <div className="chat-welcome__name">Claw Studio</div>
        <div className="chat-welcome__tagline">Visual AI Agent Builder</div>
      </div>

      <div className="chat-welcome__section">
        <div className="chat-welcome__section-label">I can help you</div>
        <ul className="chat-welcome__features">
          <li><span className="chat-welcome__dot" style={{ background: 'var(--accent-agent)' }} />Design agent pipelines on the canvas</li>
          <li><span className="chat-welcome__dot" style={{ background: '#2ca5e0' }} />Set up channels — Telegram, Slack, WhatsApp</li>
          <li><span className="chat-welcome__dot" style={{ background: 'var(--accent-tool)' }} />Install integrations and tools</li>
          <li><span className="chat-welcome__dot" style={{ background: 'var(--accent-output)' }} />Deploy and manage your bots</li>
        </ul>
      </div>

      <div className="chat-welcome__section">
        <div className="chat-welcome__section-label">Try asking</div>
        <div className="chat-welcome__examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chat-welcome__chip" onClick={() => onExample(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface ChatPanelProps {
  prefill?: string | null;
  onPrefillUsed?: () => void;
}

export function ChatPanel({ prefill, onPrefillUsed }: ChatPanelProps) {
  const { chatMessages, isChatLoading, sendChatMessage } = useStore();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatLoading]);

  useEffect(() => {
    if (prefill) {
      setInput(prefill);
      onPrefillUsed?.();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = (text = input) => {
    const t = text.trim();
    if (!t || isChatLoading) return;
    setInput('');
    sendChatMessage(t);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <span className="chat-panel__title">◈ Assistant</span>
        {chatMessages.length > 0 && (
          <button
            className="chat-panel__clear"
            onClick={() => useStore.setState({ chatMessages: [] })}
          >
            Clear
          </button>
        )}
      </div>

      <div className="chat-panel__messages">
        {chatMessages.length === 0 && (
          <WelcomeScreen onExample={(ex) => handleSend(ex)} />
        )}

        {chatMessages.map((msg) => (
          <div key={msg.id} className={`chat-msg chat-msg--${msg.role}`}>
            {msg.commandLog && msg.commandLog.length > 0 && (
              <div className="chat-msg__cmd-log">
                {msg.commandLog.map((entry, i) => (
                  <div key={i} className={`cmd-entry cmd-entry--${entry.ok ? 'ok' : 'err'}`}>
                    <div className="cmd-entry__header">
                      <span className="cmd-entry__status">{entry.ok ? '✓' : '✗'}</span>
                      <code className="cmd-entry__cmd">{entry.cmd}</code>
                    </div>
                    {entry.output && entry.output !== '(no output)' && (
                      <pre className="cmd-entry__output">{entry.output}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="chat-msg__bubble">
              {msg.role === 'assistant' ? renderMessage(msg.content) : msg.content}
              {msg.opsApplied !== undefined && msg.opsApplied > 0 && (
                <div className="chat-msg__ops">
                  ✦ Applied {msg.opsApplied} canvas operation{msg.opsApplied !== 1 ? 's' : ''}
                </div>
              )}
            </div>
            {msg.pendingCommand && (
              <div className="chat-msg__confirm">
                <div className="chat-msg__confirm-label">Command requires approval:</div>
                <code className="chat-msg__confirm-cmd">{msg.pendingCommand.cmd}</code>
                <div className="chat-msg__confirm-actions">
                  <button
                    className="chat-msg__confirm-cancel"
                    onClick={() => useStore.getState().cancelPendingCommand(msg.id)}
                  >
                    Cancel
                  </button>
                  <button
                    className="chat-msg__confirm-approve"
                    onClick={() => useStore.getState().confirmPendingCommand(msg.id)}
                    disabled={isChatLoading}
                  >
                    Approve & run
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {isChatLoading && (
          <div className="chat-msg chat-msg--assistant">
            <div className="chat-msg__bubble chat-msg__bubble--loading">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-panel__input-row">
        <textarea
          ref={inputRef}
          className="chat-panel__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe a workflow or ask a question…"
          rows={2}
          disabled={isChatLoading}
        />
        <button
          className="chat-panel__send"
          onClick={() => handleSend()}
          disabled={!input.trim() || isChatLoading}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
