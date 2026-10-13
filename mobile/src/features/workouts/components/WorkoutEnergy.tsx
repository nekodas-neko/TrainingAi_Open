import { useState } from 'react';
import {
  COMMON_WORKOUT_ACTIVITIES,
  DEFAULT_ACTIVITY_ID,
} from '@trainingai/shared/health/workout-activities';
import { AppText, Card, IconButton, Notice, Picker, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { energySpec, trainingStressSpec } from '../data/models';
import type { WorkoutRecord } from '../logging/workout';
import { formatDayShort } from '@trainingai/shared/date-utils';

export function WorkoutEnergy({ workout }: { workout: WorkoutRecord }) {
  const { theme } = useTheme();
  const [activityId, setActivityId] = useState(DEFAULT_ACTIVITY_ID);
  const minutes = Math.max(
    0,
    ((workout.completedAt ?? workout.startedAt) - workout.startedAt) / 60_000,
  );
  const enabled = workout.pending.length === 0 && minutes > 0;
  const energy = useWorkoutResource(energySpec(workout.id, minutes, activityId), enabled);
  const stress = useWorkoutResource(trainingStressSpec(workout.date), enabled);
  if (!enabled) {
    return null;
  }
  if (!energy.data?.kcal && energy.data?.kcal !== 0 && !energy.error) {
    return null;
  }
  return (
    <Card style={{ width: '100%', maxWidth: theme.sizes.summaryWidth }}>
      {energy.data?.kcal != null && (
        <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          ~{energy.data.kcal.toLocaleString()} kcal ·{' '}
          {energy.data.source === 'hr'
            ? 'from heart rate'
            : `${energy.data.intensity ?? 'moderate'} effort`}
        </AppText>
      )}
      {stress.data?.status === 'ok' && (
        <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {stress.data.ots.toFixed(1)} training stress{stress.data.high ? ' · high load' : ''}
          {stress.data.residualShare != null && stress.data.residualShare >= 0.01
            ? ` · ${Math.round(stress.data.residualShare * 100)}% of the last 12 h had no reading`
            : ''}
          {stress.data.rhrFromDay
            ? ` · resting HR from ${formatDayShort(stress.data.rhrFromDay)}`
            : ''}
        </AppText>
      )}
      {energy.error && <Notice title="Energy estimate unavailable" message={energy.error} />}
      <Stack direction="row" align="center">
        <Stack style={{ flex: 1 }}>
          <Picker
            label="Workout activity type"
            value={String(activityId)}
            options={COMMON_WORKOUT_ACTIVITIES.map((activity) => ({
              value: String(activity.id),
              label: activity.label,
            }))}
            onChange={(value) => setActivityId(Number(value))}
          />
        </Stack>
        <IconButton
          icon="refresh"
          label="Refresh energy and training stress"
          busy={energy.refreshing || stress.refreshing}
          onPress={() => {
            energy.refresh();
            stress.refresh();
          }}
        />
      </Stack>
    </Card>
  );
}
