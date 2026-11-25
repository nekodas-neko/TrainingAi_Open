import { plural } from '@trainingai/shared/format/plural';
import { formatDateDisplay } from '@trainingai/shared/date-utils';
import { displayOneRmSeries, oneRmLabel, oneRmText } from '@trainingai/shared/1rm';
import { AppText, Card, LineChart, Stack } from '../../../shared/ui';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { exerciseHistorySpec } from '../data/models';
import { ResourceStatus } from './ResourceStatus';
import { formatSetLoad } from '../logging/targets';
import { weightUnitOf } from '../logging/preferences';
import { useWeightUnits } from '../logging/WorkoutJournalProvider';
import { oneRmTrendEntries } from '../data/exercise-history';
import { ExerciseHrTrendCard } from './ExerciseHrTrendCard';

/**
 * `sessionExerciseId` ties the sheet to the lift it was opened from, so its set loads read in the
 * unit that lift is logged in (#4072). Without one (Strength, the library) the unit is unknown
 * and loads stay kilograms.
 */
export function ExerciseHistory({
  name,
  sessionExerciseId,
}: {
  name: string;
  sessionExerciseId?: string | null;
}) {
  const weightUnit = weightUnitOf(useWeightUnits(), sessionExerciseId);
  const state = useWorkoutResource(exerciseHistorySpec(name));
  const type = state.data?.exerciseType ?? 'weighted';
  const dated = oneRmTrendEntries(state.data?.entries ?? []);
  const values = displayOneRmSeries(
    dated.map((entry) => entry.estimated1rm),
    type,
  );
  return (
    <>
      <ResourceStatus state={state} refresh={state.refresh} />
      {state.data && (
        <>
          <Card>
            <AppText variant="eyebrow" tone="muted">
              {oneRmLabel(type)} trend
            </AppText>
            <LineChart
              label={oneRmLabel(type)}
              points={dated.map((entry, index) => ({
                label: entry.date.split(' ')[0],
                value: values[index],
              }))}
            />
          </Card>
          <ExerciseHrTrendCard name={name} />
          {state.data.entries.length === 0 ? (
            <AppText tone="muted">No previous sessions recorded.</AppText>
          ) : (
            state.data.entries.map((entry, index) => (
              <Card key={`${entry.date}-${index}`}>
                <Stack direction="row" justify="space-between">
                  <AppText variant="label">{entry.sessionName}</AppText>
                  <AppText variant="caption" tone="muted">
                    {formatDateDisplay(entry.date, 'short')}
                  </AppText>
                </Stack>
                {oneRmText(entry.estimated1rm, type) !== null && (
                  <AppText variant="caption" tone="brand">
                    {oneRmLabel(type)} · {oneRmText(entry.estimated1rm, type)}
                  </AppText>
                )}
                <Stack gap="xs">
                  {entry.reps.map((reps, index) => (
                    <AppText key={index} variant="caption" tone="muted">
                      Set {index + 1} ·{' '}
                      {entry.weightKg[index] === undefined
                        ? `${plural(reps, 'rep', 'reps')} · load unavailable`
                        : formatSetLoad(
                            { exerciseType: type, weightUnit },
                            { weight: String(entry.weightKg[index]), reps: String(reps) },
                          )}
                    </AppText>
                  ))}
                </Stack>
                {entry.isDeload && (
                  <AppText variant="micro" tone="muted">
                    Deload session
                  </AppText>
                )}
              </Card>
            ))
          )}
        </>
      )}
    </>
  );
}
