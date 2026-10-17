import { formatHoursMinutes } from '@trainingai/shared/format/units';
import { sleepCoverageNote } from '@trainingai/shared/health/sleep-coverage-note';
import { AppButton, AppText, Badge, Stack } from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { readinessSpec } from '../data/models';
import { sleepChips, sleepTimeRange } from '../data/body-view';
import type { HealthDetail } from '../screens/HealthDetailScreen';
import { HealthMetricCard } from './HealthMetricCard';

/**
 * Health > Body > Sleep: duration and bed-to-wake range, the score badge, the stage chips and the
 * efficiency, onset, overnight HRV, lowest heart rate and breathing chips, as the current app's card.
 */
export function BodySleepCard({ openDetail }: { openDetail: (detail: HealthDetail) => void }) {
  const health = useHealthData();
  const readiness = useWorkoutResource(readinessSpec(health.today));
  const lastNight = health.sleep.find((row) => row.date === health.today);
  const newest = health.sleep[0];
  // The computed score is the number Home shows; the stored one is only a fallback.
  const computed = readiness.data?.sleepScore ?? null;
  const score = computed ?? lastNight?.sleepScore ?? newest?.sleepScore ?? null;
  const note = computed !== null ? sleepCoverageNote(readiness.data?.sleepScoreCoverage) : null;
  const range = sleepTimeRange(lastNight, health.timezone);
  const chips = lastNight ? sleepChips(lastNight) : null;
  return (
    <HealthMetricCard
      title="Sleep"
      tone="sleep"
      onOpen={() => openDetail('sleep')}
      caption={
        lastNight
          ? lastNight.date
          : newest
            ? `Last recorded ${newest.date}`
            : 'No night recorded today'
      }
    >
      <Stack direction="row" align="center" justify="space-between">
        <Stack gap="xxs" style={{ flexShrink: 1 }}>
          <AppText variant="title">
            {lastNight?.durationHours != null
              ? formatHoursMinutes(lastNight.durationHours * 60)
              : '—'}
          </AppText>
          {range && (
            <AppText variant="caption" tone="muted">
              {range}
            </AppText>
          )}
        </Stack>
        <Stack direction="row" align="center" gap="xs">
          {lastNight?.provisional && <Badge label="Still syncing" tone="checkin" />}
          {score !== null && <Badge label={String(Math.round(score))} tone="sleep" />}
        </Stack>
      </Stack>
      {note && (
        <AppText variant="caption" tone={note.strong ? 'danger' : 'muted'}>
          {note.text}
        </AppText>
      )}
      {lastNight?.manualEntry && <Badge label="Logged by hand" tone="sleep" />}
      {chips && (
        <>
          <Stack direction="row" wrap gap="xs">
            {chips.stages.map((chip) => (
              <Badge key={chip.key} tone={chip.tone} label={chip.label} />
            ))}
          </Stack>
          <Stack direction="row" wrap gap="xs">
            {chips.vitals.map((chip) => (
              <Badge key={chip.key} tone={chip.tone} label={chip.label} />
            ))}
          </Stack>
        </>
      )}
      {health.sleepError && (
        <AppText tone="muted" variant="caption">
          {health.sleepError}
        </AppText>
      )}
      <AppButton title="Sleep details →" variant="ghost" onPress={() => openDetail('sleep')} />
    </HealthMetricCard>
  );
}
