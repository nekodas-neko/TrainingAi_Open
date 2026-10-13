import { volumeTargetKg } from '@trainingai/shared/health/activity-score';
import { AppText, Card, ProgressBar, Stack } from '../../../shared/ui';
import { useHealthData } from '../data/HealthDataProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { readinessSpec, metricValue } from '../data/models';
export function ActivitySignalsCard() {
  const { today } = useHealthData();
  const { data } = useWorkoutResource(readinessSpec(today));
  const signals = data?.activitySignals;
  const goals = data?.activityGoals;
  if (!signals || !goals) {
    return null;
  }
  const volumeGoal =
    goals.strengthFreqGoal !== null && goals.sessionVolumeGoalKg !== null
      ? volumeTargetKg({
          strengthFreqGoal: goals.strengthFreqGoal,
          sessionVolumeGoalKg: goals.sessionVolumeGoalKg,
        })
      : null;
  const rows = [
    { label: 'Steps', value: signals.steps, goal: goals.stepGoal, unit: '' },
    {
      label: 'Active energy',
      value: signals.activeCalories,
      goal: goals.activeEnergyGoal,
      unit: 'kcal',
    },
    {
      label: 'Zone minutes',
      value: signals.zoneMinutes,
      goal: goals.zoneMinutesGoal,
      unit: 'min',
    },
    { label: 'Hours moved', value: signals.moveHours, goal: goals.moveHoursGoal, unit: 'h' },
    { label: 'Sessions', value: signals.sessions7d, goal: goals.strengthFreqGoal, unit: '' },
    { label: 'Volume', value: signals.volume7dKg, goal: volumeGoal, unit: 'kg' },
  ];
  return (
    <Card>
      <AppText variant="eyebrow" tone="muted">
        Today’s activity vs your goals
      </AppText>
      {signals.zoneMinutes === null && signals.moveHours === null && (
        <AppText variant="caption" tone="muted">
          Zone minutes and hours moved need consistent heart-rate readings. Sparse readings are
          treated as unmeasured time.
        </AppText>
      )}
      {rows.map((row, index) => (
        <Stack key={row.label}>
          {index === 4 && (
            <AppText variant="eyebrow" tone="muted">
              This week’s training (rolling 7 days)
            </AppText>
          )}
          <Stack direction="row" justify="space-between">
            <AppText variant="caption">{row.label}</AppText>
            <AppText variant="caption">
              {metricValue(row.value, row.unit)} / {metricValue(row.goal, row.unit)}
            </AppText>
          </Stack>
          {row.value !== null && row.goal !== null && row.goal > 0 && (
            <ProgressBar value={row.value / row.goal} />
          )}
        </Stack>
      ))}
    </Card>
  );
}
