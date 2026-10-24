import { daysBetweenDateStrs, formatDateDisplay } from '@trainingai/shared/date-utils';
import type { IconName } from '../../../shared/ui/Icon.tsx';

export type SessionFact = { icon: IconName; text: string };

/** recommendation-card.tsx lastSessionDay: "Today", "Yesterday", else the weekday, or a dash. */
export function lastTrainedLabel(lastTrained: string | null | undefined, today: string) {
  if (!lastTrained) return '—';
  const days = daysBetweenDateStrs(lastTrained, today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return formatDateDisplay(lastTrained, 'weekday');
}

/**
 * The three facts under the session name, as recommendation-card.tsx prints them: the estimated
 * length (when the session has one), the exercise count, and when it was last trained.
 */
export function sessionFacts(
  session: {
    durationMinutes: number | null;
    exercises: readonly unknown[];
    lastTrained?: string | null;
  },
  today: string,
): SessionFact[] {
  const facts: SessionFact[] = [];
  if (session.durationMinutes !== null)
    facts.push({ icon: 'history', text: `~${Math.round(session.durationMinutes)} min` });
  facts.push({ icon: 'workout', text: `${session.exercises.length} exercises` });
  facts.push({
    icon: 'calendarPlain',
    text: `Last: ${lastTrainedLabel(session.lastTrained, today)}`,
  });
  return facts;
}

/** recommendation-card.tsx draws the soreness chip in this orange, on an 18% wash of it. */
export const SORE_CHIP_COLOR = '#ff6a1a';

/**
 * The soreness chip's text colour. The current app's orange is about 2.6:1 on a light card, so a
 * light theme takes the warning step that reaches 4.5:1 (tests/light-contrast.test.ts).
 */
export function soreChipColor(mode: 'light' | 'dark', warning: string) {
  return mode === 'light' ? warning : SORE_CHIP_COLOR;
}
