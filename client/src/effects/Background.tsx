import { useEffect, useRef, useState } from 'react';
import { COLORS } from '../../../shared/challenges';
import type { GameEngine } from '../game/gameEngine';
import type { GameState } from '../game/gameTypes';
import type { Mood, PanicScene } from './webglScene';

/** CSS-only animated background, used when WebGL is unavailable. */
export function CssBackground() {
  return (
    <div className="css-bg" aria-hidden>
      <div className="css-bg__grid" />
      <div className="css-bg__orb css-bg__orb--a" />
      <div className="css-bg__orb css-bg__orb--b" />
    </div>
  );
}

function webglAvailable(): boolean {
  if (new URLSearchParams(location.search).has('nowebgl')) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function moodFor(s: GameState): Mood {
  switch (s.status) {
    case 'MENU':
      return 'calm';
    case 'MUTATION_TRANSITION':
      return 'mutation';
    case 'GAME_OVER':
    case 'AI_ANALYSIS':
      return s.finalSummary?.endReason === 'win' ? 'victory' : 'gameover';
    default:
      if (s.mutation) return 'mutation';
      return s.lives === 1 ? 'danger' : 'play';
  }
}

function slotCenter(slot: number | null): { x: number; y: number } {
  const el = slot === null ? null : document.querySelectorAll<HTMLElement>('.targets .target')[slot];
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function Background({ engine }: { engine: GameEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(() => !webglAvailable());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (failed || !canvas) return;
    let scene: PanicScene | null = null;
    let raf = 0;
    let disposed = false;
    const cleanups: Array<() => void> = [];

    // Three.js is loaded lazily so the menu paints instantly.
    import('./webglScene')
      .then(({ PanicScene }) => {
        if (disposed) return;
        try {
          scene = new PanicScene(canvas);
        } catch {
          setFailed(true);
          return;
        }
        const s = scene;
        const resize = () => s.resize(window.innerWidth, window.innerHeight);
        resize();
        window.addEventListener('resize', resize);
        cleanups.push(() => window.removeEventListener('resize', resize));

        const onLost = (e: Event) => {
          e.preventDefault();
          setFailed(true);
        };
        canvas.addEventListener('webglcontextlost', onLost);
        cleanups.push(() => canvas.removeEventListener('webglcontextlost', onLost));

        cleanups.push(
          engine.onEvent((e) => {
            const state = engine.getState();
            switch (e.type) {
              case 'correct': {
                const t = state.round?.targets[e.slot];
                const color = !t || state.round?.monochrome ? '#ffffff' : COLORS[t.color].hex;
                const p = slotCenter(e.slot);
                s.emitBurst(p.x, p.y, color, 36 + Math.min(e.combo * 3, 60), 1 + Math.min(e.combo, 20) / 20);
                s.pulseHit(1 + Math.min(e.combo, 10) / 10);
                break;
              }
              case 'progress': {
                const p = slotCenter(e.slot);
                s.emitBurst(p.x, p.y, '#ffffff', 14, 0.6);
                break;
              }
              case 'wrong': {
                const p = slotCenter(e.slot);
                s.emitBurst(p.x, p.y, '#ff2e63', 40, 0.8);
                s.shake(0.35);
                s.pulseHit(0.6);
                break;
              }
              case 'mutation':
                s.spinUp(1);
                s.pulseHit(2);
                s.emitBurst(window.innerWidth / 2, window.innerHeight / 2, '#2de2ff', 120, 1.6);
                break;
              case 'mutationCleared':
                s.emitBurst(window.innerWidth / 2, window.innerHeight * 0.35, '#b6ff3b', 140, 1.4);
                s.pulseHit(1.5);
                break;
              case 'levelUp':
                s.pulseHit(1);
                break;
              case 'gameOver':
                if (e.won) {
                  s.spinUp(1.5);
                  s.pulseHit(2);
                  s.emitBurst(window.innerWidth / 2, window.innerHeight / 2, '#b6ff3b', 220, 2.2);
                  s.emitBurst(window.innerWidth / 2, window.innerHeight / 2, '#2de2ff', 140, 1.6);
                } else {
                  s.shake(0.7);
                  s.emitBurst(window.innerWidth / 2, window.innerHeight / 2, '#ff1744', 180, 2);
                }
                break;
              case 'start':
                s.spinUp(0.6);
                break;
              default:
                break;
            }
          }),
        );

        const loop = () => {
          const st = engine.getState();
          s.setMood(moodFor(st));
          s.setAiThinking(st.aiState === 'thinking');
          s.setComboHeat(st.combo);
          s.render();
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch(() => setFailed(true));

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanups.forEach((fn) => fn());
      scene?.dispose();
    };
  }, [engine, failed]);

  if (failed) return <CssBackground />;
  return <canvas ref={canvasRef} className="bg-canvas" aria-hidden />;
}
