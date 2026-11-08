import { isPartialNight as sharedIsPartialNight } from '@trainingai/shared/health/partial-night';
import type { SleepRow } from './models';

// #2265, mockup A: what the sleep night card shows for the "ring was off" switch. The rules live
// here, not in the component, so a test can pin them.

/** Duration-derived rows, dimmed on a marked night. HRV, heart rate and breathing stay at full strength. */
export const PARTIAL_DIMMED_FIELDS: ReadonlySet<string> = new Set([
  'deepSleepHours',
  'remSleepHours',
  'lightSleepHours',
  'awakHours',
  'efficiency',
]);

export const PARTIAL_COPY = {
  label: 'The ring was off for part of this night',
  hintOff: 'Keeps hours, efficiency and bedtime out of your scores and averages.',
  hintOn: 'Turn off to count the whole night again.',
  badge: 'Partial night',
  reason: 'Kept out of your sleep score and averages. Heart rate, HRV and breathing still count.',
  failed: 'Could not save that change. Try again.',
  hintSourceFlagged: 'Your device flagged this night as an incomplete recording, so it already counts as partial.',
} as const;

/** The owner's mark or the source's incomplete-recording flag: the one shared rule (#3600), not a second copy. */
export function isPartialNight(night: Partial<Pick<SleepRow, 'partialNightAt' | 'recordingIncomplete'>>): boolean {
  return sharedIsPartialNight(night);
}

/**
 * What the switch shows. It stands for the owner's own mark only: turning it off clears that mark
 * and nothing else. A night the source itself flagged as incomplete stays partial whatever the
 * mark says, so the switch is shown on and locked, rather than snapping back on after a tap.
 */
export function partialSwitchState(
  night: Partial<Pick<SleepRow, 'partialNightAt' | 'recordingIncomplete'>>,
): { value: boolean; locked: boolean } {
  const sourceFlagged = night.recordingIncomplete === true;
  return { value: sourceFlagged || night.partialNightAt != null, locked: sourceFlagged };
}

/** Only a night the ring or phone measured can be marked, the same rule `markNightPartial` enforces. */
export function canMarkPartial(
  night: Pick<SleepRow, 'id' | 'manualEntry' | 'localOnly'>,
): night is typeof night & { id: string } {
  return !!night.id && !night.manualEntry && !night.localOnly;
}

export function partialErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : PARTIAL_COPY.failed;
}

/**
 * #3667: Home's sleep verdict is not shown for last night when that night is marked partial (#2265:
 * a marked night is never judged) or exists only on this phone so far. The server stops returning a
 * stored verdict once the mark lands; this hides it the moment the owner marks it.
 */
export function hidesSleepVerdict(
  sleep: readonly Partial<Pick<SleepRow, 'date' | 'localOnly' | 'partialNightAt' | 'recordingIncomplete'>>[],
  today: string,
): boolean {
  return sleep.some((night) => night.date === today && (night.localOnly === true || isPartialNight(night)));
}
