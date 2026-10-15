import { MUTATIONS } from '../../../shared/challenges';
import type { ActiveMutation } from '../game/gameTypes';
import { CONFIG } from '../game/scoring';

interface Props {
  mutation: ActiveMutation;
  cleared: number;
  target: number;
}

export function MutationOverlay({ mutation, cleared, target }: Props) {
  const { rec } = mutation;
  const def = MUTATIONS[rec.mutationId];
  const isAi = rec.source === 'ai';
  return (
    <div className="overlay mutation" role="alert">
      <div className="mutation__flash" />
      <div className="mutation__inner">
        <div className="mutation__kicker">
          <span className="glitch" data-text={mutation.isFinal ? 'FINAL MUTATION' : 'RULE MUTATION'}>
            {mutation.isFinal ? 'FINAL MUTATION' : 'RULE MUTATION'}
          </span>
          <span className="mutation__intensity" aria-label={`Intensity ${rec.intensity}`}>
            {[1, 2, 3].map((i) => (
              <i key={i} className={i <= rec.intensity ? 'on' : ''} />
            ))}
          </span>
        </div>
        <h2 className="mutation__name">{def.name}</h2>
        <p className="mutation__instruction">“{rec.instruction}”</p>
        <p className="mutation__rule">{def.rule}</p>
        <p className="mutation__stakes" data-final={mutation.isFinal}>
          {mutation.isFinal
            ? `Survive all ${mutation.totalRounds} rounds without a miss and you win.`
            : `No misses for ${mutation.totalRounds} rounds = override ${cleared + 1}/${target}.`}
        </p>

        <div className="mutation__why">
          <span className={`src-badge src-badge--${rec.source}`}>
            {isAi ? 'CHOSEN BY GEMMA 3 4B · LOCAL' : 'FALLBACK PROTOCOL'}
          </span>
          <p className="mutation__reason">{rec.reason}</p>
          <p className="mutation__taunt">{rec.taunt}</p>
        </div>

        <div className="mutation__bar">
          <div style={{ animationDuration: `${CONFIG.mutationTransitionMs}ms` }} />
        </div>
      </div>
    </div>
  );
}
