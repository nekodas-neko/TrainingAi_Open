import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { AppText, Picker, Stack } from '../../shared/ui';
import { useCoach } from '../coach/CoachProvider';
import { coachError } from '../coach/data/models';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import { liftPreferencesSpec, REP_RANGE_OPTIONS, repRangeDisplay, repRangePatch } from './rep-range';

/**
 * "Rep range: 10 to 12" on a saved lift in the program editor (#3896 step 7, 8c A). Opens a short
 * list, the current range ticked; choosing one saves it at once, for this lift in every session it is
 * in, through the same apply path the Coach uses. "Use the program's default" clears it.
 */
export function RepRangeRow({
  sessionExerciseId,
  name,
  names,
  disabled = false,
}: {
  sessionExerciseId: string;
  name: string;
  /** Every saved lift in the program, so the rows share one read. */
  names: readonly string[];
  disabled?: boolean;
}) {
  const coach = useCoach();
  const prefs = useWorkoutResource(liftPreferencesSpec(names));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = prefs.data ? (prefs.data.preferences[name]?.repRange ?? null) : undefined;
  async function choose(to: string) {
    if (current === undefined || !coach) return;
    const patch = repRangePatch(sessionExerciseId, current, to, randomUUID());
    if (!patch) return;
    setBusy(true);
    setError(null);
    try {
      await coach.actions.apply(patch, [patch.changes[0].id]);
    } catch (cause) {
      setError(coachError(cause, 'save the rep range'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack gap="xs">
      <Picker
        label="Rep range"
        value={current ?? (current === null ? 'program_default' : '')}
        display={current === undefined ? (prefs.error ? 'Could not load' : 'Loading…') : repRangeDisplay(current)}
        options={REP_RANGE_OPTIONS}
        disabled={disabled || busy || current === undefined || !coach}
        onChange={(to) => {
          void choose(to);
        }}
      />
      {(error || prefs.error) && (
        <AppText variant="caption" tone="danger">
          {error ?? prefs.error}
        </AppText>
      )}
    </Stack>
  );
}
