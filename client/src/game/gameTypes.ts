import type {
  ChallengeRecommendation,
  ColorId,
  MutationId,
  RuleKey,
  RuleKind,
  RunAnalysis,
  RunSummary,
  SymbolId,
} from '../../../shared/challenges';

export type GameStatus = 'MENU' | 'COUNTDOWN' | 'PLAYING' | 'MUTATION_TRANSITION' | 'GAME_OVER' | 'AI_ANALYSIS';

export interface Target {
  slot: number;
  color: ColorId;
  symbol: SymbolId;
  correct: boolean;
}

/** One visual chunk of the instruction line. */
export interface InstructionPart {
  text: string;
  /** Ink color for the chunk. May deliberately differ from the color it names. */
  ink?: ColorId;
  kind: 'verb' | 'color' | 'symbol' | 'note';
}

export interface Round {
  index: number;
  ruleKind: RuleKind;
  /** Key used for statistics: the mutation id during a mutation, else the rule kind. */
  ruleKey: RuleKey;
  mutationId: MutationId | null;
  instruction: InstructionPart[];
  hint?: string;
  targets: Target[];
  correctSlot: number;
  clicksRequired: 1 | 2;
  monochrome: boolean;
  windowMs: number;
  startedAt: number;
  deadline: number;
  /** Color the player must carry into the next round (previous-color rules). */
  memoryColor: ColorId;
}

export interface RoundRecord {
  ruleKey: RuleKey;
  mutationId: MutationId | null;
  correct: boolean;
  timeout: boolean;
  reactionMs: number | null;
  wrongTarget: { color: ColorId; symbol: SymbolId } | null;
}

export type FeedbackKind = 'correct' | 'wrong' | 'timeout' | 'progress';

export interface Feedback {
  id: number;
  kind: FeedbackKind;
  slot: number | null;
  points: number;
  text: string;
  at: number;
}

export interface ActiveMutation {
  rec: ChallengeRecommendation;
  roundsLeft: number;
  totalRounds: number;
  hadMiss: boolean;
  phaseId: number;
  /** Clearing this mutation flawlessly wins the run. */
  isFinal: boolean;
}

export type AiState = 'idle' | 'thinking' | 'ready' | 'failed';

export interface GameState {
  status: GameStatus;
  statusUntil: number;
  countdown: number;

  score: number;
  lives: number;
  combo: number;
  bestCombo: number;
  multiplier: number;
  level: number;
  levelProgress: number;

  roundIndex: number;
  round: Round | null;
  roundActive: boolean;
  nextRoundAt: number;
  taps: number;
  feedback: Feedback | null;

  mutation: ActiveMutation | null;
  /** Mutation being announced during MUTATION_TRANSITION. */
  announcing: ActiveMutation | null;
  nextMutationAtRound: number;
  mutationHistory: MutationId[];
  mutationsSurvived: number;
  /** Flawless mutation clears needed to win. */
  winTarget: number;
  /** Time bonus awarded on a win (already included in score). */
  winBonus: number;

  runStartedAt: number;
  runEndsAt: number;
  timeLeftMs: number;
  runDurationMs: number;

  records: RoundRecord[];
  bestScore: number;
  isNewBest: boolean;

  aiState: AiState;
  aiCached: ChallengeRecommendation | null;
  finalSummary: RunSummary | null;
  analysis: RunAnalysis | null;
  analysisStatus: 'idle' | 'loading' | 'done';
}

export type GameEvent =
  | { type: 'correct'; slot: number; points: number; combo: number }
  | { type: 'progress'; slot: number }
  | { type: 'wrong'; slot: number | null; timeout: boolean }
  | { type: 'mutation'; mutationId: MutationId; source: 'ai' | 'fallback' }
  | { type: 'mutationCleared'; bonus: number }
  | { type: 'levelUp'; level: number }
  | { type: 'countdown'; value: number }
  | { type: 'roundStart' }
  | { type: 'gameOver'; won: boolean }
  | { type: 'start' };
