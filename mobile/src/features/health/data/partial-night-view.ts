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
} as const;

export function isPartialNight(night: { partialNightAt?: SleepRow['partialNightAt'] }): boolean {
  return !!night.partialNightAt;
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
