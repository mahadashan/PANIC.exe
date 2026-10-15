import type { CSSProperties, PointerEvent, MouseEvent } from 'react';
import { COLORS, SYMBOLS } from '../../../shared/challenges';
import type { GameState, Round } from '../game/gameTypes';
import { SLOT_KEYS } from '../game/input';

interface Props {
  state: GameState;
  onTap: (slot: number) => void;
}

export function Instruction({ round, active }: { round: Round; active: boolean }) {
  return (
    <div className={`instruction ${active ? '' : 'instruction--done'}`} key={round.index} aria-live="assertive">
      <div className="instruction__line">
        {round.instruction.map((part, i) => (
          <span
            key={i}
            className={`ins ins--${part.kind}${part.ink ? ' ins--tinted' : ''}`}
            style={part.ink ? ({ '--tint': COLORS[part.ink].hex } as CSSProperties) : undefined}
          >
            {part.text}
          </span>
        ))}
      </div>
      {round.hint && <div className="instruction__hint">{round.hint}</div>}
    </div>
  );
}

export function TargetGrid({ state, onTap }: Props) {
  const round = state.round;
  if (!round) return <div className="targets targets--empty" />;
  const resolved = !state.roundActive;
  const fb = state.feedback;

  const handlePointer = (slot: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    onTap(slot);
  };
  // Keyboard activation of a focused button (Enter/Space) arrives as a click with detail 0.
  const handleClick = (slot: number) => (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0) onTap(slot);
  };

  return (
    <div className="targets" data-count={round.targets.length} key={round.index}>
      {round.targets.map((t) => {
        const classes = ['target'];
        if (round.monochrome) classes.push('target--mono');
        if (resolved) {
          if (t.correct) classes.push(fb?.kind === 'correct' ? 'target--hit' : 'target--reveal');
          else if (fb?.slot === t.slot) classes.push('target--miss');
          else classes.push('target--fade');
        } else if (round.clicksRequired === 2 && state.taps === 1 && t.correct) {
          classes.push('target--armed');
        }
        const color = round.monochrome ? '#c9c9d6' : COLORS[t.color].hex;
        return (
          <button
            key={t.slot}
            className={classes.join(' ')}
            style={{ '--c': color, animationDelay: `${t.slot * 35}ms` } as CSSProperties}
            onPointerDown={handlePointer(t.slot)}
            onClick={handleClick(t.slot)}
            disabled={resolved}
            aria-label={`Target ${t.slot + 1}: ${round.monochrome ? '' : COLORS[t.color].label.toLowerCase()} ${SYMBOLS[t.symbol].label.toLowerCase()}`}
          >
            <span className="target__glyph">{SYMBOLS[t.symbol].glyph}</span>
            <kbd className="target__key">{SLOT_KEYS[t.slot]}</kbd>
            {round.clicksRequired === 2 && <span className="target__x2">×2</span>}
            {resolved && fb && fb.slot === t.slot && fb.kind === 'correct' && (
              <span className="target__points">{fb.text}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function RoundTimer({ round, active }: { round: Round; active: boolean }) {
  return (
    <div className="round-timer" aria-hidden>
      <div
        key={round.index}
        className={`round-timer__fill ${active ? '' : 'round-timer__fill--stop'}`}
        style={{ animationDuration: `${round.windowMs}ms` }}
      />
    </div>
  );
}
