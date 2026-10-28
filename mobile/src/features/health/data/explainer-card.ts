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
