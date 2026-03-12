import { useEffect, useRef, useState } from 'react';

interface TourStep {
  target: string; // matches data-tour attribute
  title: string;
  body: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

const STEPS: TourStep[] = [
  {
    target: 'canvas',
    title: 'The Canvas',
    body: 'Build your bot pipeline here by adding and connecting nodes. Each node is a step in your bot\'s workflow.',
    placement: 'bottom',
  },
  {
    target: 'bot-picker',
    title: 'Your Bots',
    body: 'All your bots live here. Click to switch between them, or create a new one. Swarms show their sub-bots indented beneath.',
    placement: 'bottom',
  },
  {
    target: 'add-agent',
    title: 'Agent Node',
    body: 'The brain of your pipeline. Choose a model and write a system prompt to define what this agent does.',
    placement: 'bottom',
  },
  {
    target: 'add-tool',
    title: 'Tool Node',
    body: 'Give your agent capabilities — run shell commands, browse the web, or call an MCP server.',
    placement: 'bottom',
  },
  {
    target: 'add-output',
    title: 'Output Node',
    body: 'Define where results go: Slack, Telegram, a file, or pass to another bot in the pipeline.',
    placement: 'bottom',
  },
  {
    target: 'add-bot',
    title: 'Bot Container',
    body: 'Group agents into a Bot Container to build multi-bot pipelines — one bot hands off work to another.',
    placement: 'bottom',
  },
  {
    target: 'deploy',
    title: 'Deploy',
    body: 'When your blueprint is ready, Deploy generates the instructions and pushes the bot live to NanoClaw.',
    placement: 'bottom',
  },
  {
    target: 'chat-panel',
    title: 'The Assistant',
    body: 'Always here for help. Use it to connect channels, ask questions, or create your first bot with a single message.',
    placement: 'right',
  },
];

const TOOLTIP_WIDTH = 300;
const SPOTLIGHT_PAD = 8;
const TOOLTIP_GAP = 14;

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Props {
  step: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function OnboardingTour({ step, onNext, onBack, onSkip }: Props) {
  const total = STEPS.length;
  const current = STEPS[step];
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({ opacity: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function position() {
      const el = document.querySelector(`[data-tour="${current.target}"]`) as HTMLElement | null;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const sp: SpotlightRect = {
        top: rect.top - SPOTLIGHT_PAD,
        left: rect.left - SPOTLIGHT_PAD,
        width: rect.width + SPOTLIGHT_PAD * 2,
        height: rect.height + SPOTLIGHT_PAD * 2,
      };
      setSpotlight(sp);

      const th = tooltipRef.current?.offsetHeight ?? 120;
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      let top = 0;
      let left = 0;

      switch (current.placement) {
        case 'bottom':
          top = rect.bottom + SPOTLIGHT_PAD + TOOLTIP_GAP;
          left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
          break;
        case 'top':
          top = rect.top - SPOTLIGHT_PAD - TOOLTIP_GAP - th;
          left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
          break;
        case 'right':
          top = rect.top + rect.height / 2 - th / 2;
          left = rect.right + SPOTLIGHT_PAD + TOOLTIP_GAP;
          break;
        case 'left':
          top = rect.top + rect.height / 2 - th / 2;
          left = rect.left - SPOTLIGHT_PAD - TOOLTIP_GAP - TOOLTIP_WIDTH;
          break;
      }

      // Clamp to viewport with margin
      left = Math.max(12, Math.min(left, vpW - TOOLTIP_WIDTH - 12));
      top = Math.max(12, Math.min(top, vpH - th - 12));

      setTooltipStyle({ top, left, width: TOOLTIP_WIDTH, opacity: 1 });
    }

    // Run once now, then again after a frame to account for layout
    position();
    const raf = requestAnimationFrame(position);
    return () => cancelAnimationFrame(raf);
  }, [step, current.target, current.placement]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === 'Enter') onNext();
      if (e.key === 'ArrowLeft') onBack();
      if (e.key === 'Escape') onSkip();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext, onBack, onSkip]);

  return (
    <>
      {/* Dim overlay — box-shadow on spotlight creates the vignette */}
      <div className="tour-overlay" />

      {/* Spotlight cutout */}
      {spotlight && (
        <div
          className="tour-spotlight"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      )}

      {/* Tooltip */}
      <div ref={tooltipRef} className="tour-tooltip" style={tooltipStyle}>
        <div className="tour-tooltip__header">
          <span className="tour-tooltip__title">{current.title}</span>
          <button className="tour-tooltip__close" onClick={onSkip} title="Skip tour">✕</button>
        </div>
        <p className="tour-tooltip__body">{current.body}</p>
        <div className="tour-tooltip__footer">
          <span className="tour-tooltip__progress">{step + 1} / {total}</span>
          <div className="tour-tooltip__actions">
            {step > 0 && (
              <button className="tour-btn tour-btn--secondary" onClick={onBack}>← Back</button>
            )}
            <button className="tour-btn tour-btn--primary" onClick={onNext}>
              {step === total - 1 ? 'Done' : 'Next →'}
            </button>
          </div>
        </div>
        {/* Progress dots */}
        <div className="tour-tooltip__dots">
          {STEPS.map((_, i) => (
            <span key={i} className={`tour-dot ${i === step ? 'tour-dot--active' : ''}`} />
          ))}
        </div>
      </div>
    </>
  );
}
