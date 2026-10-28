import { scoreBand } from '@trainingai/shared/health/score-band';
import { bandColor, type statusColors } from '../../../shared/theme/tokens';

// The badge on an explainer card, as the current app draws it (contributor-details.tsx): the band
// word and the score in bold capitals, coloured by the band (green High, amber Moderate, red Low).
// Returns null when there is no score to show (learning, or nothing recorded).
export function explainerBadge(
  score: number | null | undefined,
  status: typeof statusColors.dark,
): { text: string; color: string } | null {
  if (score == null) return null;
  const band = scoreBand(score);
  return { text: `${band.label} · ${score}`, color: bandColor(band.color, status) };
}

// A bullet in "How to improve it" is a row: the dot sits in its own fixed-width column and the text
// takes the rest, so a wrapped line lines up under the first word, not under the dot (the web's
// `list-disc pl-4`). `indent` is the width of the dot column.
export function bulletLayout(indent: number) {
  return {
    row: { flexDirection: 'row' as const, alignItems: 'flex-start' as const },
    dot: { width: indent },
    text: { flex: 1 },
  };
}
export const BULLET_GLYPH = '•';

// What an explainer card draws for a factor, as the current app decides it (contributor-details.tsx).
// `score` is the factor's own score, null when nothing was recorded; `learning` is a factor with a
// score that is still settling against its baseline. The heading follows the score alone (a learning
// factor keeps "What your score means" over its note), while the badge and gauge wait until the
// score is settled (#3514).
export function explainerShape(input: {
  score: number | null | undefined;
  learning?: boolean;
  gauge?: number;
}): { badge: boolean; gauge: 'centered' | 'toward-high' | null; meaningHeading: boolean } {
  const hasScore = input.score != null;
  const settled = hasScore && !input.learning;
  return {
    badge: settled,
    gauge: input.gauge != null ? 'centered' : settled ? 'toward-high' : null,
    meaningHeading: hasScore,
  };
}
