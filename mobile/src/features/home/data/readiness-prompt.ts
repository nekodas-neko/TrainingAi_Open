// What Home's readiness card says today (#2106). A usual score is stated and nothing is asked; a
// score outside the user's own band is asked about. The band and the verdict come from the server
// (`/api/readiness-verdict`), never from a client copy of the rule.
//
// The answers are NOT validation of the score. Only unusual days are asked, so an ordinary-looking
// day the user would have called bad is never sampled; nothing here or downstream may describe an
// answer as agreement with the score (#2106, OR-171).

export type ReadinessVerdictData = {
  verdict: 'poor' | 'normal' | 'good';
  score: number;
  band: { low: number; high: number };
  responseState: 'none' | 'rated' | 'dismissed';
};

export type ReadinessPrompt =
  /** No verdict yet (too few scored days, or today has no score): say nothing about the score. */
  | { kind: 'silent' }
  | { kind: 'usual'; line: string }
  | {
      kind: 'ask';
      eyebrow: string;
      title: string;
      /** The user already answered or skipped today: the card goes back to stating the score. */
      answered: boolean;
    };

export const FEEL_OPTIONS = [
  { value: 'better', label: 'Better' },
  { value: 'same', label: 'About the same' },
  { value: 'worse', label: 'Worse' },
] as const;
export type Feel = (typeof FEEL_OPTIONS)[number]['value'];

const range = (verdict: ReadinessVerdictData) =>
  `${Math.round(verdict.band.low)}–${Math.round(verdict.band.high)}`;

export function readinessPrompt(
  verdict: ReadinessVerdictData | null | undefined,
  /** Today's check-in already carries a tapped answer to the same question. */
  feelAnswered = false,
): ReadinessPrompt {
  if (!verdict) {
    return { kind: 'silent' };
  }
  const score = Math.round(verdict.score);
  if (verdict.verdict === 'normal') {
    return {
      kind: 'usual',
      line: `Readiness ${score} is a usual day for you (usual ${range(verdict)}).`,
    };
  }
  const low = verdict.verdict === 'poor';
  if (verdict.responseState !== 'none' || feelAnswered) {
    return {
      kind: 'usual',
      line: `Readiness ${score} is ${low ? 'under' : 'over'} your usual ${range(verdict)}.`,
    };
  }
  return {
    kind: 'ask',
    eyebrow: low ? 'Readiness is low today' : 'Readiness is high today',
    title: `${score} is ${low ? 'under' : 'over'} your usual ${range(verdict)}. How do you feel?`,
    answered: false,
  };
}

type SavedCheckin = {
  [key: string]: unknown;
  soreMuscles?: string[] | null;
  journal?: string | null;
  illnessContext?: 'sick' | 'alcohol' | 'poor_sleep' | null;
};
const carried = [
  'physicalTiredness',
  'mentalDrain',
  'barelyMoved',
  'hydration',
  'lateHeavyMeal',
  'wakeMood',
  'perceivedRecovery',
  'motivation',
  'sleepQualityFeel',
  'restingSoreness',
  'perceivedRecoveryTouched',
  'sleepQualityFeelTouched',
] as const;

/**
 * The morning check-in to save for a tapped answer. A check-in save writes the whole row, so every
 * answer already given today is carried over and only the comparison changes: tapping here must not
 * blank the sleep feel or soreness the morning sheet saved. `vsNormalTouched` is true because this
 * is a real tap, not the sheet's seeded neutral.
 */
export function feelCheckin(row: SavedCheckin | null | undefined, feel: Feel, vsQuestion: 1 | 2) {
  const kept: Record<string, unknown> = {};
  for (const key of carried) {
    const value = row?.[key];
    if (typeof value === 'number' || typeof value === 'boolean') {
      kept[key] = value;
    }
  }
  return {
    ...kept,
    phase: 'morning' as const,
    soreMuscles: row?.soreMuscles ?? [],
    journal: row?.journal ?? null,
    illnessContext: row?.illnessContext ?? null,
    vsNormal: feel,
    vsQuestion,
    vsNormalTouched: true,
  };
}
