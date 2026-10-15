/** Tiny synthesized sound kit: no audio files, no latency from decoding. */
import type { GameEvent } from '../game/gameTypes';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

try {
  muted = localStorage.getItem('panic.muted') === '1';
} catch {
  /* storage unavailable */
}

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', when = 0, slideTo?: number, vol = 1) {
  const ac = audio();
  if (!ac || !master) return;
  const t = ac.currentTime + when;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem('panic.muted', value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function playUiClick() {
  tone(660, 0.06, 'triangle', 0, 990, 0.6);
}

export function playEvent(e: GameEvent) {
  switch (e.type) {
    case 'correct': {
      const base = 440 * Math.pow(2, Math.min(e.combo, 16) / 12);
      tone(base, 0.09, 'square', 0, undefined, 0.5);
      tone(base * 1.5, 0.12, 'triangle', 0.045, undefined, 0.5);
      break;
    }
    case 'progress':
      tone(520, 0.05, 'triangle', 0, undefined, 0.5);
      break;
    case 'wrong':
      tone(140, 0.28, 'sawtooth', 0, 70, 0.9);
      tone(147, 0.28, 'square', 0, 72, 0.4);
      break;
    case 'mutation':
      tone(180, 0.5, 'sawtooth', 0, 1400, 0.5);
      tone(90, 0.5, 'square', 0.05, 700, 0.3);
      break;
    case 'mutationCleared':
      [0, 0.07, 0.14].forEach((w, i) => tone(660 * (1 + i * 0.25), 0.12, 'triangle', w, undefined, 0.6));
      break;
    case 'levelUp':
      tone(880, 0.08, 'triangle', 0, 1320, 0.4);
      break;
    case 'countdown':
      if (e.value > 0) tone(e.value === 1 ? 880 : 520, 0.1, 'square', 0, undefined, 0.5);
      break;
    case 'start':
      tone(330, 0.12, 'triangle', 0, 660, 0.5);
      break;
    case 'gameOver':
      if (e.won) {
        [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', i * 0.09, undefined, 0.6));
        tone(1047, 0.8, 'square', 0.5, 2093, 0.3);
      } else {
        tone(440, 0.9, 'sawtooth', 0, 55, 0.7);
        tone(220, 0.9, 'square', 0.1, 40, 0.4);
      }
      break;
    default:
      break;
  }
}
