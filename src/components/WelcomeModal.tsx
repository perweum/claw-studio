interface Props {
  onStartTour: () => void;
  onSkip: () => void;
}

export function WelcomeModal({ onStartTour, onSkip }: Props) {
  return (
    <div className="welcome-backdrop">
      <div className="welcome-modal">
        <div className="welcome-modal__logo">◈</div>
        <h1 className="welcome-modal__title">Welcome to Claw Studio</h1>
        <p className="welcome-modal__body">
          A visual editor for building AI bot pipelines. Connect triggers, agents, tools,
          and outputs to create bots that run on a schedule or respond to messages.
        </p>
        <div className="welcome-modal__actions">
          <button className="welcome-btn welcome-btn--primary" onClick={onStartTour}>
            Take the tour →
          </button>
          <button className="welcome-btn welcome-btn--secondary" onClick={onSkip}>
            Skip — I'll explore myself
          </button>
        </div>
      </div>
    </div>
  );
}
