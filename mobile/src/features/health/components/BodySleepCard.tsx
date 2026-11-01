import { formatHoursMinutes } from '@trainingai/shared/format/units';
import { pickSleepCardNight } from '@trainingai/shared/health/sleep-card-night';
import { sleepCoverageNote } from '@trainingai/shared/health/sleep-coverage-note';
import { AppButton, AppText, Badge, Stack } from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { readinessSpec } from '../data/models';
import { OuraStaleNote } from '../../devices/components/OuraStaleNote';
import { sleepChips, sleepTimeRange } from '../data/body-view';
import type { HealthDetail } from '../screens/HealthDetailScreen';
import { HealthMetricCard } from './HealthMetricCard';
import { useCueColor } from './RangeBar';
import { bodyCardColors } from '../../../shared/theme/tokens';

/**
 * Health > Body > Sleep: duration and bed-to-wake range, the score badge, the stage chips and the
 * efficiency, onset, overnight HRV, lowest heart rate and breathing chips, as the current app's card.
 */
export function BodySleepCard({ openDetail }: { openDetail: (detail: HealthDetail) => void }) {
  const cueColor = useCueColor();
  const health = useHealthData();
  const readiness = useWorkoutResource(readinessSpec(health.today));
  // Same rule and caption as the current app's card (issue 2906): the canonical latest night when
  // dated today or yesterday, with its date named.
  const { night: lastNight, label: nightLabel } = pickSleepCardNight(health.sleep, health.today, health.timezone);
  // Our computed score, the number Home shows, and nothing else: a night's stored `sleepScore` could
  // only be Oura's (#3011).
  const score = readiness.data?.sleepScore ?? null;
  const note = score !== null ? sleepCoverageNote(readiness.data?.sleepScoreCoverage) : null;
  const range = sleepTimeRange(lastNight ?? undefined, health.timezone);
  const chips = lastNight ? sleepChips(lastNight) : null;
  return (
    <HealthMetricCard
      title="Sleep"
      accent={bodyCardColors.sleep}
      onOpen={() => openDetail('sleep')}
      caption={nightLabel}
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
          <OuraStaleNote />
        </Stack>
        <Stack direction="row" align="center" gap="xs">
          {lastNight?.provisional && <Badge label="Still syncing" tone="checkin" />}
          {score !== null && <Badge label={String(Math.round(score))} tone="sleep" />}
        </Stack>
      </Stack>
      {note && (
        <AppText
          variant="caption"
          tone="muted"
          style={note.strong ? { color: cueColor('watch') } : undefined}
        >
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
