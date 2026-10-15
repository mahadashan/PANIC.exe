import { COLORS, SYMBOLS } from '../../../shared/challenges';
import type { HealthStatus } from '../services/aiClient';
import { CONFIG } from '../game/scoring';

interface Props {
  bestScore: number;
  health: HealthStatus | null;
  onPlay: () => void;
}

export function AiStatus({ health }: { health: HealthStatus | null }) {
  let label = 'CHECKING LOCAL AI…';
  let tone = 'pending';
  if (health) {
    if (health.modelAvailable) {
      label = `${health.model.toUpperCase()} · LOCAL · ${health.warm ? 'ONLINE' : 'LOADING'}`;
      tone = health.warm ? 'online' : 'pending';
    } else if (health.ollama) {
      label = `OLLAMA UP · ${health.model} MISSING · FALLBACK MODE`;
      tone = 'offline';
    } else {
      label = health.server ? 'OLLAMA OFFLINE · FALLBACK MODE' : 'AI SERVER OFFLINE · FALLBACK MODE';
      tone = 'offline';
    }
  }
  return (
    <div className={`ai-status ai-status--${tone}`} role="status">
      <span className="ai-status__dot" />
      {label}
    </div>
  );
}

export function StartScreen({ bestScore, health, onPlay }: Props) {
  return (
    <main className="screen start">
      <div className="start__top">
        <AiStatus health={health} />
      </div>

      <div className="start__hero">
        <h1 className="logo" data-text="PANIC.exe">
          PANIC<span className="logo__ext">.exe</span>
        </h1>
        <p className="tagline">Your reflexes are your worst enemy.</p>

        <button className="btn btn--primary btn--huge" onClick={onPlay} autoFocus>
          PLAY
          <kbd>ENTER</kbd>
        </button>

        <div className="best">
          BEST <strong>{bestScore.toLocaleString()}</strong>
        </div>
      </div>

      <ol className="howto">
        <li>
          <span className="howto__n">01</span>
          Read the order. Tap the matching target —{' '}
          <span style={{ color: COLORS.red.hex }}>RED</span>, <span className="glyph">{SYMBOLS.triangle.glyph}</span>,
          whatever it says.
        </li>
        <li>
          <span className="howto__n">02</span>
          Mouse, touch, or keys <kbd>1</kbd>
          <kbd>2</kbd>
          <kbd>3</kbd>
          <kbd>4</kbd>. Three lives. 75 seconds.
        </li>
        <li>
          <span className="howto__n">03</span>A local AI mutates the rules to break your habits. Clear{' '}
          {CONFIG.winMutationClears} mutations without a single miss to override it and win.
        </li>
      </ol>
    </main>
  );
}
