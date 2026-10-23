import { formatDateDisplay } from '@trainingai/shared/date-utils';
import type { IconName } from '../../../shared/ui/Icon.tsx';

export type SessionFact = { icon: IconName; text: string };

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
    text: `Last: ${
      session.lastTrained
        ? session.lastTrained === today
          ? 'Today'
          : formatDateDisplay(session.lastTrained, 'short')
        : '—'
    }`,
  });
  return facts;
}

/** recommendation-card.tsx draws the soreness chip in this orange, on an 18% wash of it. */
export const SORE_CHIP_COLOR = '#ff6a1a';

/** The soreness chip beside the mood face names the muscles, not how many (the current app joins them). */
export function soreMusclesLabel(muscles: readonly string[]) {
  return muscles.join(', ');
}
