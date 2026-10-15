import { MUTATIONS } from '../../../shared/challenges';
import type { GameState } from '../game/gameTypes';
import { CONFIG } from '../game/scoring';

export function GameHUD({ state }: { state: GameState }) {
  const timePct = Math.max(0, Math.min(1, state.timeLeftMs / state.runDurationMs));
  const seconds = Math.ceil(state.timeLeftMs / 1000);
  const m = state.mutation;

  return (
    <header className="hud">
      <div className="hud__block hud__score">
        <span className="hud__label">SCORE</span>
        <span className="hud__value" key={state.score}>
          {state.score.toLocaleString()}
        </span>
      </div>

      <div className="hud__block hud__combo" data-hot={state.multiplier > 1}>
        <span className="hud__label">COMBO</span>
        <span className="hud__value">
          ×{state.multiplier.toFixed(1)}
          <small>{state.combo}</small>
        </span>
      </div>

      <div className="hud__center">
        {m ? (
          <div className="mut-chip" data-source={m.rec.source} data-failed={m.hadMiss} data-final={m.isFinal}>
            <span className="mut-chip__src">{m.rec.source === 'ai' ? 'GEMMA' : 'FALLBACK'}</span>
            <span className="mut-chip__name">{MUTATIONS[m.rec.mutationId].name}</span>
            <span className="mut-chip__left">
              {m.hadMiss ? 'FAILED' : `${m.totalRounds - m.roundsLeft + 1}/${m.totalRounds}`}
            </span>
          </div>
        ) : (
          <div className="lvl">
            LVL <strong>{state.level}</strong>
            <AiPip state={state} />
          </div>
        )}
        <OverrideMeter state={state} />
      </div>

      <div className="hud__block hud__lives" aria-label={`${state.lives} lives left`}>
        <span className="hud__label">LIVES</span>
        <span className="lives">
          {Array.from({ length: CONFIG.startingLives }, (_, i) => (
            <span key={i} className={`life ${i < state.lives ? 'life--on' : 'life--off'}`} />
          ))}
        </span>
      </div>

      <div className="hud__block hud__time" data-low={seconds <= 10}>
        <span className="hud__label">TIME</span>
        <span className="hud__value">{seconds}</span>
      </div>

      <div className="hud__timebar" aria-hidden>
        <div className="hud__timebar-fill" style={{ transform: `scaleX(${timePct})` }} />
      </div>
    </header>
  );
}

/** Win progress: flawless mutation clears out of the target. */
function OverrideMeter({ state }: { state: GameState }) {
  return (
    <div
      className="override"
      title="Clear mutations without a single miss to override the AI and win"
      aria-label={`Override ${state.mutationsSurvived} of ${state.winTarget}`}
    >
      <span className="override__label">OVERRIDE</span>
      {Array.from({ length: state.winTarget }, (_, i) => (
        <i key={i} className={i < state.mutationsSurvived ? 'on' : ''} />
      ))}
    </div>
  );
}

/** Tiny indicator that the model is preparing the next mutation. */
function AiPip({ state }: { state: GameState }) {
  if (state.aiState === 'idle') return null;
  const label =
    state.aiState === 'thinking' ? 'AI THINKING' : state.aiState === 'ready' ? 'AI MUTATION READY' : 'AI · FALLBACK';
  return (
    <span className={`ai-pip ai-pip--${state.aiState}`} title={label}>
      <span className="ai-pip__dot" />
      {label}
    </span>
  );
}
