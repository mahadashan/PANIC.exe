/**
 * Deterministic round builders. Every base rule and every mutation from the
 * shared allowlist has exactly one builder here, and every builder produces
 * exactly one correct target.
 */
import {
  COLOR_IDS,
  COLOR_SWAP,
  COLORS,
  SYMBOL_IDS,
  SYMBOLS,
  type ColorId,
  type MutationId,
  type RuleKind,
  type SymbolId,
} from '../../../shared/challenges';
import type { InstructionPart, Round, Target } from './gameTypes';
import { pick, shuffle, type Rng } from './rng';

export interface BuildContext {
  rng: Rng;
  targetCount: 3 | 4;
  level: number;
  /** Color carried over from the previous round (see Round.memoryColor). */
  memoryColor: ColorId | null;
  firstOfPhase: boolean;
}

export type RoundBlueprint = Pick<
  Round,
  'ruleKind' | 'instruction' | 'hint' | 'targets' | 'correctSlot' | 'clicksRequired' | 'monochrome' | 'memoryColor'
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function distinctColors(rng: Rng, n: number, mustInclude: ColorId[] = []): ColorId[] {
  const rest = shuffle(rng, COLOR_IDS.filter((c) => !mustInclude.includes(c)));
  return shuffle(rng, [...mustInclude, ...rest].slice(0, n));
}

function distinctSymbols(rng: Rng, n: number, mustInclude: SymbolId[] = [], exclude: SymbolId[] = []): SymbolId[] {
  const rest = shuffle(rng, SYMBOL_IDS.filter((s) => !mustInclude.includes(s) && !exclude.includes(s)));
  return shuffle(rng, [...mustInclude, ...rest].slice(0, n));
}

function finalize(
  specs: Array<{ color: ColorId; symbol: SymbolId }>,
  isCorrect: (t: { color: ColorId; symbol: SymbolId }) => boolean,
  rest: Omit<RoundBlueprint, 'targets' | 'correctSlot' | 'memoryColor'> & { memoryColor?: ColorId },
): RoundBlueprint {
  const targets: Target[] = specs.map((s, slot) => ({ ...s, slot, correct: isCorrect(s) }));
  const correct = targets.filter((t) => t.correct);
  if (correct.length !== 1) {
    throw new Error(`Round builder produced ${correct.length} correct targets for ${rest.ruleKind}`);
  }
  return {
    ...rest,
    targets,
    correctSlot: correct[0].slot,
    memoryColor: rest.memoryColor ?? correct[0].color,
  };
}

const verb = (text: string): InstructionPart => ({ text, kind: 'verb' });
const colorWord = (color: ColorId, ink: ColorId = color): InstructionPart => ({
  text: COLORS[color].label,
  ink,
  kind: 'color',
});
const symbolWord = (symbol: SymbolId, ink?: ColorId): InstructionPart => ({
  text: SYMBOLS[symbol].glyph,
  ink,
  kind: 'symbol',
});
const note = (text: string): InstructionPart => ({ text, kind: 'note' });

/** From level 4 the color word is sometimes printed in a different ink (Stroop trap). */
function inkFor(ctx: BuildContext, color: ColorId, present: ColorId[]): ColorId {
  if (ctx.level < 4 || ctx.rng() < 0.5) return color;
  const others = present.filter((c) => c !== color);
  return others.length ? pick(ctx.rng, others) : color;
}

// ---------------------------------------------------------------------------
// Base rules
// ---------------------------------------------------------------------------

export function buildTapColor(ctx: BuildContext, opts: { clicks?: 1 | 2 } = {}): RoundBlueprint {
  const c = pick(ctx.rng, COLOR_IDS);
  const colors = distinctColors(ctx.rng, ctx.targetCount, [c]);
  const symbols = distinctSymbols(ctx.rng, ctx.targetCount);
  const clicks = opts.clicks ?? 1;
  return finalize(
    colors.map((color, i) => ({ color, symbol: symbols[i] })),
    (t) => t.color === c,
    {
      ruleKind: clicks === 2 ? 'doubleTap' : 'tapColor',
      instruction: [verb(clicks === 2 ? 'DOUBLE-TAP' : 'TAP'), colorWord(c, inkFor(ctx, c, colors))],
      clicksRequired: clicks,
      monochrome: false,
    },
  );
}

export function buildAvoidColor(ctx: BuildContext): RoundBlueprint {
  const c = pick(ctx.rng, COLOR_IDS);
  const other = pick(ctx.rng, COLOR_IDS.filter((x) => x !== c));
  const colors = shuffle(ctx.rng, [other, ...Array<ColorId>(ctx.targetCount - 1).fill(c)]);
  const symbols = distinctSymbols(ctx.rng, ctx.targetCount);
  return finalize(
    colors.map((color, i) => ({ color, symbol: symbols[i] })),
    (t) => t.color !== c,
    { ruleKind: 'avoidColor', instruction: [verb('AVOID'), colorWord(c)], clicksRequired: 1, monochrome: false },
  );
}

export function buildTapSymbol(
  ctx: BuildContext,
  opts: { clicks?: 1 | 2; monochrome?: boolean } = {},
): RoundBlueprint {
  const s = pick(ctx.rng, SYMBOL_IDS);
  const symbols = distinctSymbols(ctx.rng, ctx.targetCount, [s]);
  const colors = symbols.map(() => pick(ctx.rng, COLOR_IDS));
  const clicks = opts.clicks ?? 1;
  const decoyInk = !opts.monochrome && ctx.level >= 3 ? pick(ctx.rng, colors) : undefined;
  return finalize(
    symbols.map((symbol, i) => ({ color: colors[i], symbol })),
    (t) => t.symbol === s,
    {
      ruleKind: clicks === 2 ? 'doubleTap' : 'tapSymbol',
      instruction: [verb(clicks === 2 ? 'DOUBLE-TAP' : 'TAP'), symbolWord(s, decoyInk)],
      clicksRequired: clicks,
      monochrome: opts.monochrome ?? false,
    },
  );
}

/** Base rule: tap the color of the previous round's target. */
export function buildPreviousColor(ctx: BuildContext): RoundBlueprint {
  if (!ctx.memoryColor) return buildTapColor(ctx);
  const m = ctx.memoryColor;
  const colors = distinctColors(ctx.rng, ctx.targetCount, [m]);
  const symbols = distinctSymbols(ctx.rng, ctx.targetCount);
  return finalize(
    colors.map((color, i) => ({ color, symbol: symbols[i] })),
    (t) => t.color === m,
    {
      ruleKind: 'previousColor',
      instruction: [verb('TAP'), note('THE PREVIOUS COLOR')],
      clicksRequired: 1,
      monochrome: false,
    },
  );
}

/** Tap the named color, but a ★ in that same color is a decoy. */
export function buildIgnoreTarget(ctx: BuildContext, opts: { showNote?: boolean } = {}): RoundBlueprint {
  const c = pick(ctx.rng, COLOR_IDS);
  const others = shuffle(ctx.rng, COLOR_IDS.filter((x) => x !== c)).slice(0, ctx.targetCount - 2);
  const nonStar = distinctSymbols(ctx.rng, ctx.targetCount - 1, [], ['star']);
  const specs = shuffle(ctx.rng, [
    { color: c, symbol: 'star' as SymbolId },
    { color: c, symbol: nonStar[0] },
    ...others.map((color, i) => ({ color, symbol: nonStar[i + 1] })),
  ]);
  const instruction = [verb('TAP'), colorWord(c)];
  if (opts.showNote ?? true) instruction.push(note('NOT ★'));
  return finalize(specs, (t) => t.color === c && t.symbol !== 'star', {
    ruleKind: 'ignoreTarget',
    instruction,
    clicksRequired: 1,
    monochrome: false,
  });
}

export function baseRulesForLevel(level: number): RuleKind[] {
  const rules: RuleKind[] = ['tapColor', 'tapSymbol'];
  if (level >= 2) rules.push('avoidColor');
  if (level >= 3) rules.push('doubleTap', 'previousColor');
  if (level >= 4) rules.push('ignoreTarget');
  return rules;
}

export function buildBaseRule(kind: RuleKind, ctx: BuildContext): RoundBlueprint {
  switch (kind) {
    case 'tapColor':
      return buildTapColor(ctx);
    case 'avoidColor':
      return buildAvoidColor(ctx);
    case 'tapSymbol':
      return buildTapSymbol(ctx);
    case 'previousColor':
      return buildPreviousColor(ctx);
    case 'doubleTap':
      return ctx.rng() < 0.5 ? buildTapColor(ctx, { clicks: 2 }) : buildTapSymbol(ctx, { clicks: 2 });
    case 'ignoreTarget':
      return buildIgnoreTarget(ctx);
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Symbols beat colors: the named color sits on a different target than the named symbol. */
export function buildSymbolOverride(ctx: BuildContext): RoundBlueprint {
  const s = pick(ctx.rng, SYMBOL_IDS);
  const c = pick(ctx.rng, COLOR_IDS);
  const symbols = distinctSymbols(ctx.rng, ctx.targetCount, [s]);
  // Distinct colors where `c` is guaranteed to land on a target that is NOT `s`.
  const colors = distinctColors(ctx.rng, ctx.targetCount, [c]);
  const sIdx = symbols.indexOf(s);
  const cIdx = colors.indexOf(c);
  if (sIdx === cIdx) {
    const swapWith = (sIdx + 1) % ctx.targetCount;
    [colors[sIdx], colors[swapWith]] = [colors[swapWith], colors[sIdx]];
  }
  return finalize(
    symbols.map((symbol, i) => ({ color: colors[i], symbol })),
    (t) => t.symbol === s,
    {
      ruleKind: 'tapSymbol',
      instruction: [verb('TAP'), colorWord(c), symbolWord(s)],
      clicksRequired: 1,
      monochrome: false,
    },
  );
}

/** Named color maps to its swap pair. */
export function buildReverseColors(ctx: BuildContext): RoundBlueprint {
  const c = pick(ctx.rng, COLOR_IDS);
  const actual = COLOR_SWAP[c];
  const colors = distinctColors(ctx.rng, ctx.targetCount, [c, actual]);
  const symbols = distinctSymbols(ctx.rng, ctx.targetCount);
  return finalize(
    colors.map((color, i) => ({ color, symbol: symbols[i] })),
    (t) => t.color === actual,
    { ruleKind: 'tapColor', instruction: [verb('TAP'), colorWord(c)], clicksRequired: 1, monochrome: false },
  );
}

/** TAP means AVOID and AVOID means TAP. */
export function buildReverseInstruction(ctx: BuildContext): RoundBlueprint {
  const c = pick(ctx.rng, COLOR_IDS);
  const symbols = distinctSymbols(ctx.rng, ctx.targetCount);
  if (ctx.rng() < 0.5) {
    // Shows "TAP c" over an avoid layout: the only non-c target is correct.
    const other = pick(ctx.rng, COLOR_IDS.filter((x) => x !== c));
    const colors = shuffle(ctx.rng, [other, ...Array<ColorId>(ctx.targetCount - 1).fill(c)]);
    return finalize(
      colors.map((color, i) => ({ color, symbol: symbols[i] })),
      (t) => t.color !== c,
      { ruleKind: 'tapColor', instruction: [verb('TAP'), colorWord(c)], clicksRequired: 1, monochrome: false },
    );
  }
  // Shows "AVOID c" over a tap layout: c is correct.
  const colors = distinctColors(ctx.rng, ctx.targetCount, [c]);
  return finalize(
    colors.map((color, i) => ({ color, symbol: symbols[i] })),
    (t) => t.color === c,
    { ruleKind: 'avoidColor', instruction: [verb('AVOID'), colorWord(c)], clicksRequired: 1, monochrome: false },
  );
}

/**
 * One-back memory: every round shows a new color word, but the correct target
 * is the color carried from the previous round.
 */
export function buildPreviousColorMutation(ctx: BuildContext): RoundBlueprint {
  const m = ctx.memoryColor ?? pick(ctx.rng, COLOR_IDS);
  const shown = pick(ctx.rng, COLOR_IDS.filter((c) => c !== m));
  const colors = distinctColors(ctx.rng, ctx.targetCount, [m, shown]);
  const symbols = distinctSymbols(ctx.rng, ctx.targetCount);
  return finalize(
    colors.map((color, i) => ({ color, symbol: symbols[i] })),
    (t) => t.color === m,
    {
      ruleKind: 'previousColor',
      instruction: [verb('TAP PREVIOUS'), note('· REMEMBER'), colorWord(shown)],
      hint: ctx.firstOfPhase || !ctx.memoryColor ? `LAST TARGET WAS ${COLORS[m].label}` : undefined,
      clicksRequired: 1,
      monochrome: false,
      memoryColor: shown,
    },
  );
}

export function buildMutationRound(id: MutationId, ctx: BuildContext): RoundBlueprint {
  switch (id) {
    case 'doubleTap':
      return ctx.rng() < 0.5 ? buildTapColor(ctx, { clicks: 2 }) : buildTapSymbol(ctx, { clicks: 2 });
    case 'colorBlind':
      return buildTapSymbol(ctx, { monochrome: true });
    case 'speedSurge':
      return buildBaseRule(pick(ctx.rng, ['tapColor', 'tapSymbol', 'avoidColor'] as const), ctx);
    case 'ignoreTarget':
      return buildIgnoreTarget(ctx, { showNote: false });
    case 'previousColor':
      return buildPreviousColorMutation(ctx);
    case 'symbolOverride':
      return buildSymbolOverride(ctx);
    case 'reverseColors':
      return buildReverseColors(ctx);
    case 'reverseInstruction':
      return buildReverseInstruction(ctx);
  }
}
