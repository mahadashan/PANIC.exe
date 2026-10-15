import type { ReactNode } from 'react';
import type { GameState } from '../game/gameTypes';

interface Props {
  state: GameState;
  onRetry: () => void;
  onMenu: () => void;
}

const SPLASH = {
  win: { title: 'SYSTEM OVERRIDDEN', sub: 'you broke the machine' },
  time: { title: 'TIME UP', sub: 'the machine outlasted you' },
  lives: { title: 'SYSTEM CRASH', sub: 'panic.exe has stopped responding' },
} as const;

export function GameOverSplash({ state }: { state: GameState }) {
  const reason = state.finalSummary?.endReason ?? 'lives';
  const { title, sub } = SPLASH[reason];
  return (
    <div className={`overlay crash crash--${reason}`}>
      <h2 className="crash__title glitch" data-text={title}>
        {title}
      </h2>
      <p className="crash__sub">{sub}</p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? 'stat--accent' : ''}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  );
}

export function GameOverScreen({ state, onRetry, onMenu }: Props) {
  const run = state.finalSummary;
  if (!run) return null;
  const a = state.analysis;
  const loading = state.analysisStatus !== 'done' || !a;

  return (
    <main className="screen results">
      <div className="results__head">
        <span className={`results__kicker results__kicker--${run.endReason}`}>
          {run.endReason === 'win'
            ? 'AI OVERRIDDEN · YOU WIN'
            : run.endReason === 'time'
              ? 'TIME UP · NO OVERRIDE'
              : 'OUT OF LIVES'}
        </span>
        <div className="results__score">{run.score.toLocaleString()}</div>
        {state.winBonus > 0 && <div className="results__bonus">+{state.winBonus.toLocaleString()} TIME BONUS</div>}
        {state.isNewBest ? (
          <div className="results__best results__best--new">NEW BEST</div>
        ) : (
          <div className="results__best">BEST {state.bestScore.toLocaleString()}</div>
        )}
      </div>

      <div className="stats">
        <Stat label="ACCURACY" value={`${Math.round(run.accuracy * 100)}%`} />
        <Stat label="AVG REACTION" value={run.averageReactionMs ? `${run.averageReactionMs} ms` : '—'} />
        <Stat label="BEST COMBO" value={run.bestCombo} />
        <Stat label="ROUNDS" value={run.roundsPlayed} />
        <Stat label="OVERRIDE" value={`${run.mutationsSurvived}/${state.winTarget}`} accent={run.endReason === 'win'} />
      </div>

      <section className="analysis" aria-live="polite">
        <div className="analysis__head">
          <span className="analysis__title">DIAGNOSIS</span>
          {!loading && (
            <span className={`src-badge src-badge--${a!.source === 'fallback' ? 'fallback' : 'ai'}`}>
              {a!.source === 'ai' ? 'GEMMA 3 4B · LOCAL' : a!.source === 'mixed' ? 'GEMMA 3 4B · PARTLY VERIFIED' : 'OFFLINE ANALYSIS'}
            </span>
          )}
        </div>
        {loading ? (
          <div className="analysis__loading">
            <span className="spinner" /> Gemma is studying your failure…
          </div>
        ) : (
          <>
            <p className="analysis__taunt">“{a!.taunt}”</p>
            <dl className="analysis__grid">
              <div>
                <dt>STRONGEST SKILL</dt>
                <dd>{a!.strongestSkill}</dd>
              </div>
              <div>
                <dt>MOST FREQUENT MISTAKE</dt>
                <dd>{a!.frequentMistake}</dd>
              </div>
              <div>
                <dt>OBSERVATION</dt>
                <dd>{a!.observation}</dd>
              </div>
              <div>
                <dt>FIX THIS</dt>
                <dd>{a!.improvement}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <div className="results__actions">
        <button className="btn btn--primary btn--big" onClick={onRetry} autoFocus>
          RETRY <kbd>ENTER</kbd>
        </button>
        <button className="btn btn--ghost" onClick={onMenu}>
          MENU <kbd>ESC</kbd>
        </button>
      </div>
    </main>
  );
}
