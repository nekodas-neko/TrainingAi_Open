import { useState } from 'react';
import { displayOneRm, displayOneRmSeries, oneRmLabel } from '@trainingai/shared/1rm';
import { toAestDay } from '@trainingai/shared/date-utils';
import { isRmPlateau, projectRm } from '@trainingai/shared/health/strength-projection';
import {
  AppText,
  Badge,
  Card,
  IconButton,
  LineChart,
  ListRow,
  PageDots,
  Sheet,
  Stack,
} from '../../shared/ui';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { WorkoutLayout } from '../workouts/components/WorkoutLayout';
import { ResourceStatus } from '../workouts/components/ResourceStatus';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import { recordsSpec, strengthSpec, weeklySpec, librarySpec } from '../workouts/data/models';
import { ExerciseHistory } from '../workouts/components/ExerciseHistory';
import { WeeklyTrainingCard } from './WeeklyTrainingCard';

export function StrengthScreen({
  onBack,
  embedded = false,
  section = 'all',
}: {
  onBack: () => void;
  embedded?: boolean;
  section?: 'all' | 'trend' | 'records';
}) {
  const { timezone } = useWorkoutContext();
  const strength = useWorkoutResource(strengthSpec);
  const weekly = useWorkoutResource(weeklySpec, section === 'all');
  const records = useWorkoutResource(recordsSpec, section !== 'trend');
  const library = useWorkoutResource(librarySpec, section !== 'trend');
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const exercises = strength.data?.exercises ?? [];
  const currentIndex = Math.min(index, Math.max(0, exercises.length - 1));
  const exercise = exercises[currentIndex];
  const values = exercise
    ? displayOneRmSeries(
        exercise.history.map((point) => point.rm),
        exercise.exerciseType,
      )
    : [];
  const projection =
    exercise && exercise.history.length >= 4
      ? projectRm(
          exercise.history.map((point) => ({ ...point, date: point.date.replace(/\//g, '-') })),
        )
      : null;
  const content = (
    <>
      {section === 'all' && (
        <>
          <ResourceStatus state={weekly} refresh={weekly.refresh} />
          {weekly.data && <WeeklyTrainingCard data={weekly.data} />}
        </>
      )}
      {section !== 'records' && (
        <>
          {!embedded && (
            <ResourceStatus
              inline={embedded}
              label="Strength trend"
              state={strength}
              refresh={strength.refresh}
            />
          )}
          {exercise ? (
            <Card>
              <Stack direction="row" justify="space-between">
                <AppText
                  variant={embedded ? 'heading' : 'eyebrow'}
                  tone={embedded ? 'text' : 'muted'}
                >
                  Strength Trend
                </AppText>
                <Stack direction="row" align="center" gap="none">
                  <AppText variant="micro" tone="muted">
                    90 days
                  </AppText>
                  {embedded && (
                    <ResourceStatus
                      inline
                      label="Strength trend"
                      state={strength}
                      refresh={strength.refresh}
                    />
                  )}
                </Stack>
              </Stack>
              <Stack direction="row" align="center" justify="space-between">
                <IconButton
                  icon="back"
                  label="Previous exercise"
                  onPress={currentIndex > 0 ? () => setIndex(currentIndex - 1) : undefined}
                />
                <Stack align="center" style={{ flex: 1, minWidth: 0 }}>
                  <AppText variant="label" numberOfLines={1}>
                    {exercise.name}
                  </AppText>
                  <Stack direction="row" align="center">
                    <AppText variant="hero" tone="brand">
                      {displayOneRm(exercise.currentRm, exercise.exerciseType).text}
                    </AppText>
                    {exercise.gainPct !== null && (
                      <Badge
                        label={(exercise.gainPct > 0 ? '+' : '') + exercise.gainPct + '%'}
                        tone={
                          exercise.gainPct > 0
                            ? 'activity'
                            : exercise.gainPct < 0
                              ? 'heart'
                              : 'recovery'
                        }
                      />
                    )}
                  </Stack>
                  {projection && (
                    <AppText variant="micro" tone="muted">
                      → ~{displayOneRm(projection.projectedRm, exercise.exerciseType).text} in
                      30d
                    </AppText>
                  )}
                  {projection &&
                    isRmPlateau(
                      exercise.history.map((point) => ({
                        ...point,
                        date: point.date.replace(/\//g, '-'),
                      })),
                    ) && <Badge label="Plateau" tone="recovery" />}
                </Stack>
                <IconButton
                  icon="forward"
                  label="Next exercise"
                  onPress={
                    currentIndex < exercises.length - 1
                      ? () => setIndex(currentIndex + 1)
                      : undefined
                  }
                />
              </Stack>
              <LineChart
                label={oneRmLabel(exercise.exerciseType)}
                height={64}
                showLabels={false}
                fill
                points={exercise.history.map((point, index) => ({
                  label: point.date,
                  value: values[index],
                }))}
              />
              <Stack direction="row" justify="space-between">
                <AppText variant="micro" tone="muted">
                  90d low:{' '}
                  {exercise.history.length
                    ? displayOneRm(
                        Math.min(...exercise.history.map((point) => point.rm)),
                        exercise.exerciseType,
                      ).text
                    : '—'}
                </AppText>
                <AppText variant="micro" tone="muted">
                  Peak: {displayOneRm(exercise.peakRm, exercise.exerciseType).text}
                </AppText>
              </Stack>
              {exercises.length > 1 && (
                <PageDots
                  labels={exercises.map((exercise) => 'Go to ' + exercise.name)}
                  selectedIndex={currentIndex}
                  onSelect={setIndex}
                  variant="horizontal"
                />
              )}
            </Card>
          ) : embedded ? (
            <Card>
              <Stack direction="row" align="center" justify="space-between">
                <AppText variant="heading">Strength Trend</AppText>
                <ResourceStatus
                  inline
                  label="Strength trend"
                  state={strength}
                  refresh={strength.refresh}
                />
              </Stack>
              <AppText variant="caption" tone="muted">
                {strength.data
                  ? 'Log a workout to see how your strength changes.'
                  : 'Your strength history is unavailable.'}
              </AppText>
            </Card>
          ) : (
            strength.data && <AppText tone="muted">No strength history recorded yet.</AppText>
          )}
        </>
      )}
      {section !== 'trend' && (
        <>
          <AppText variant="eyebrow" tone="muted">
            Personal records
          </AppText>
          <ResourceStatus state={records} refresh={records.refresh} />
          {records.data?.records.length === 0 && (
            <AppText tone="muted">No personal records yet.</AppText>
          )}
          {records.data?.records.map((record) => {
            const type = library.data?.exercises.find(
              (exercise) => exercise.name === record.exerciseName,
            )?.exerciseType;
            const achievedAt = new Date(record.achievedAt);
            const date = Number.isFinite(achievedAt.getTime())
              ? toAestDay(achievedAt, timezone)
              : record.achievedAt;
            return (
              <ListRow
                key={record.exerciseName}
                title={record.exerciseName}
                subtitle={
                  (type
                    ? displayOneRm(record.estimated1rm, type).text
                    : 'Load type unavailable') +
                  ' · ' +
                  date
                }
                onPress={() => setSelected(record.exerciseName)}
              />
            );
          })}
        </>
      )}
      <Sheet
        visible={selected !== null}
        title={selected ?? 'History'}
        onClose={() => setSelected(null)}
      >
        {selected && <ExerciseHistory name={selected} />}
      </Sheet>
    </>
  );
  return embedded ? (
    content
  ) : (
    <WorkoutLayout
      title="Strength progress"
      onBack={onBack}
      actions={
        <IconButton
          icon="refresh"
          label="Refresh progress"
          busy={strength.refreshing || weekly.refreshing || records.refreshing}
          onPress={() => {
            strength.refresh();
            weekly.refresh();
            records.refresh();
            library.refresh();
          }}
        />
      }
    >
      {content}
    </WorkoutLayout>
  );
}
