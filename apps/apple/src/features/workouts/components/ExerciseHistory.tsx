import { displayOneRm, displayOneRmSeries, oneRmLabel } from '@trainingai/shared/1rm';
import { AppText, Card, LineChart, Stack } from '../../../shared/ui';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { exerciseHistorySpec } from '../data/models';
import { ResourceStatus } from './ResourceStatus';
import { formatSetLoad } from '../logging/targets';

export function ExerciseHistory({ name }: { name: string }) {
  const state = useWorkoutResource(exerciseHistorySpec(name));
  const type = state.data?.exerciseType ?? 'weighted';
  const dated = (state.data?.entries ?? [])
    .filter((entry) => entry.estimated1rm !== null)
    .slice()
    .reverse();
  const values = displayOneRmSeries(
    dated.map((entry) => entry.estimated1rm!),
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
          {state.data.entries.length === 0 ? (
            <AppText tone="muted">No previous sessions recorded.</AppText>
          ) : (
            state.data.entries.map((entry, index) => (
              <Card key={`${entry.date}-${index}`}>
                <Stack direction="row" justify="space-between">
                  <AppText variant="label">{entry.sessionName}</AppText>
                  <AppText variant="caption" tone="muted">
                    {entry.date}
                  </AppText>
                </Stack>
                {entry.estimated1rm !== null && (
                  <AppText variant="caption" tone="brand">
                    {oneRmLabel(type)} · {displayOneRm(entry.estimated1rm, type).text}
                  </AppText>
                )}
                <Stack gap="xs">
                  {entry.reps.map((reps, index) => (
                    <AppText key={index} variant="caption" tone="muted">
                      Set {index + 1} ·{' '}
                      {entry.weightKg[index] === undefined
                        ? `${reps} reps · load unavailable`
                        : formatSetLoad(
                            { exerciseType: type },
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
