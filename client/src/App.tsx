import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GameEngine, type ScoreStore } from './game/gameEngine';
import { keyToSlot } from './game/input';
import { createAiPort, fetchHealth, warmUp, type HealthStatus } from './services/aiClient';
import { isMuted, playEvent, playUiClick, setMuted } from './services/sound';
import { StartScreen } from './components/StartScreen';
import { GameHUD } from './components/GameHUD';
import { Instruction, RoundTimer, TargetGrid } from './components/TargetGrid';
import { MutationOverlay } from './components/MutationOverlay';
import { GameOverScreen, GameOverSplash } from './components/GameOverScreen';
import { Background } from './effects/Background';

const BEST_KEY = 'panic.bestScore';

const localStore: ScoreStore = {
  loadBest() {
    try {
      return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      return 0;
    }
  },
  saveBest(score) {
    try {
      localStorage.setItem(BEST_KEY, String(score));
    } catch {
      /* private mode etc. */
    }
  },
};

export default function App() {
  const engine = useMemo(() => new GameEngine({ ai: createAiPort(), store: localStore }), []);
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const stageRef = useRef<HTMLDivElement>(null);

  // Single frame loop drives every game timer.
  useEffect(() => {
    let id = 0;
    const loop = () => {
      engine.tick(performance.now());
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [engine]);

  useEffect(() => () => engine.dispose(), [engine]);

  // Test hook for the automated browser check (scripts/e2e.ts). Only with ?debug=1.
  useEffect(() => {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __panic: GameEngine }).__panic = engine;
  }, [engine]);

  // Sound + screen shake.
  useEffect(
    () =>
      engine.onEvent((e) => {
        playEvent(e);
        const el = stageRef.current;
        if (!el) return;
        const cls =
          e.type === 'wrong'
            ? 'shake'
            : e.type === 'gameOver'
              ? e.won
                ? 'warp'
                : 'shake-big'
              : e.type === 'mutation'
                ? 'warp'
                : null;
        if (cls) {
          el.classList.remove('shake', 'shake-big', 'warp');
          void el.offsetWidth; // restart the CSS animation
          el.classList.add(cls);
        }
      }),
    [engine],
  );

  // Local AI health: poll while on the menu, warm the model up once.
  useEffect(() => {
    warmUp();
  }, []);
  useEffect(() => {
    if (state.status !== 'MENU' && health) return;
    let alive = true;
    const check = () => fetchHealth().then((h) => alive && setHealth(h));
    check();
    const id = window.setInterval(check, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [state.status === 'MENU']); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(() => {
    playUiClick();
    engine.start(performance.now());
  }, [engine]);
  const toMenu = useCallback(() => engine.toMenu(), [engine]);
  const tap = useCallback((slot: number) => engine.input(slot, performance.now()), [engine]);
  const toggleMute = useCallback(() => {
    setMuted(!isMuted());
    setMutedState(isMuted());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const status = engine.getState().status;
      if (status === 'PLAYING') {
        const slot = keyToSlot(e.key);
        if (slot !== null) {
          e.preventDefault();
          tap(slot);
          return;
        }
      }
      if ((e.key === 'Enter' || e.key === ' ') && (status === 'MENU' || status === 'AI_ANALYSIS')) {
        e.preventDefault();
        start();
      } else if (e.key === 'Escape' && status !== 'MENU') {
        toMenu();
      } else if (e.key.toLowerCase() === 'm') {
        toggleMute();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, start, tap, toMenu, toggleMute]);

  const inRun = state.status === 'COUNTDOWN' || state.status === 'PLAYING' || state.status === 'MUTATION_TRANSITION';
  const round = state.round;

  return (
    <div className="app" data-status={state.status}>
      <Background engine={engine} />
      <div className="vignette" aria-hidden />

      <div className="stage" ref={stageRef}>
        {state.status === 'MENU' && <StartScreen bestScore={state.bestScore} health={health} onPlay={start} />}

        {inRun && (
          <main className="screen play">
            <GameHUD state={state} />
            <div className="arena">
              {round ? (
                <>
                  <Instruction round={round} active={state.roundActive} />
                  <RoundTimer round={round} active={state.roundActive} />
                  <TargetGrid state={state} onTap={tap} />
                </>
              ) : (
                <div className="arena__idle" />
              )}
              {!state.roundActive && state.feedback && state.feedback.kind !== 'correct' && round && (
                <div className={`verdict verdict--${state.feedback.kind}`} key={state.feedback.id}>
                  {state.feedback.text}
                </div>
              )}
            </div>
          </main>
        )}

        {state.status === 'COUNTDOWN' && (
          <div className="overlay countdown" key={state.countdown}>
            <span>{state.countdown}</span>
          </div>
        )}
        {state.status === 'MUTATION_TRANSITION' && state.announcing && (
          <MutationOverlay mutation={state.announcing} cleared={state.mutationsSurvived} target={state.winTarget} />
        )}
        {state.status === 'GAME_OVER' && <GameOverSplash state={state} />}
        {state.status === 'AI_ANALYSIS' && <GameOverScreen state={state} onRetry={start} onMenu={toMenu} />}
      </div>

      <footer className="corner">
        <button className="mute" onClick={toggleMute} aria-pressed={muted} title="Toggle sound (M)">
          {muted ? 'SOUND OFF' : 'SOUND ON'} <kbd>M</kbd>
        </button>
      </footer>
    </div>
  );
}
