import { useState } from 'react';
import { HR_ZONE_META } from '@trainingai/shared/health/hr-zones';
import { deviceHealthName } from '../../../integrations/device-health/platform';
import {
  AppText,
  Card,
  Grid,
  MetricTile,
  ProgressBar,
  SegmentedControl,
  Stack,
} from '../../../shared/ui';
import type { z } from 'zod';
import { cardioWeekSpec } from '../data/models';
type CardioWeek = z.infer<ReturnType<typeof cardioWeekSpec>['schema']>;
export function HeartProfileCard({
  heart,
  hasSource,
}: {
  heart: CardioWeek['heart'];
  hasSource: boolean | null | undefined;
}) {
  const assumedRest = ['default', 'unavailable'].includes(heart.restingHrSource ?? '');
  return (
    <Card>
      <Stack direction="row" justify="space-between">
        <AppText variant="eyebrow" tone="muted">
          Your heart
        </AppText>
        <AppText variant="micro" tone="muted">
          last 30 days
        </AppText>
      </Stack>
      <Grid columns={3} gap="xs">
        {(
          [
            [heart.restingHr, 'Resting', heart.restingHrDeltaBpm],
            [heart.avgHr, 'Avg', heart.avgHrDeltaBpm],
            [heart.maxHr, 'Max', heart.maxHrDeltaBpm],
          ] as const
        ).map(([value, label, delta]) => (
          <MetricTile
            compact
            key={label}
            label={label}
            value={value == null ? null : String(value)}
            tone="neutral"
            caption={delta ? `${delta > 0 ? '+' : ''}${delta} bpm` : undefined}
          />
        ))}
      </Grid>
      {assumedRest && (
        <AppText variant="micro" tone="muted">
          {heart.restingHrSource === 'unavailable'
            ? 'Resting heart rate could not be read. Zones currently assume 60 bpm.'
            : 'No resting readings yet. Zones currently assume 60 bpm.'}
        </AppText>
      )}
      {heart.maxHrSource === 'estimated-age-unread' && (
        <AppText variant="micro" tone="muted">
          Your age could not be read. Zones currently use a generic maximum of 190 bpm.
        </AppText>
      )}
      {heart.maxHrSource === 'cooper-blend' && (
        <AppText variant="micro" tone="muted">
          Zone boundaries use a blend of your Cooper test peak and age estimate.
        </AppText>
      )}
      {!heart.isReliable && !assumedRest && heart.maxHrSource !== 'estimated-age-unread' && (
        <AppText variant="micro" tone="muted">
          {hasSource === false
            ? `No heart-rate data yet. Connect ${deviceHealthName} to build your range.`
            : 'Still learning your range — it sharpens with a few more days of heart-rate data.'}
        </AppText>
      )}
    </Card>
  );
}
export function ZoneQuotaCard({ data }: { data: CardioWeek }) {
  const [view, setView] = useState('day');
  const quota = view === 'day' ? data.dayQuota : data.quota;
  const passive = quota.zones.find((row) => row.zoneId === 1);
  return (
    <Card>
      <SegmentedControl
        label="Zone quota period"
        value={view}
        onChange={setView}
        options={[
          { value: 'day', label: 'Today' },
          { value: 'week', label: 'This week' },
        ]}
      />
      {data.quota.hasHrSource === false || data.dayQuota.hasHrSource === false ? (
        <AppText variant="caption" tone="muted">
          No heart-rate data yet. Connect {deviceHealthName}, then record a workout.
        </AppText>
      ) : (
        <>
          {quota.zones
            .filter((row) => row.zoneId !== 1)
            .map((row) => {
              const meta = HR_ZONE_META.find((zone) => zone.id === row.zoneId);
              return (
                <Stack key={row.zoneId} gap="xxs">
                  <Stack direction="row" justify="space-between">
                    <AppText variant="caption">
                      Z{row.zoneId} {meta?.name}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {row.status === 'not-required'
                        ? 'not needed'
                        : `${row.doneMin} / ${row.targetMin} min`}
                    </AppText>
                  </Stack>
                  <ProgressBar value={row.pctComplete / 100} color={meta?.color} />
                  {row.status !== 'not-required' && (
                    <Stack direction="row" justify="space-between">
                      <AppText variant="micro" tone="muted">
                        {row.pctComplete}% done
                      </AppText>
                      <AppText variant="micro" tone="muted">
                        {row.remainingMin ? `${row.remainingMin} min left` : 'complete'}
                      </AppText>
                    </Stack>
                  )}
                </Stack>
              );
            })}
          {passive && (
            <AppText variant="micro" tone="muted">
              Z1 Recovery{' '}
              {passive.status === 'complete'
                ? 'complete'
                : `${passive.doneMin}/${passive.targetMin} min`}{' '}
              — Zone 1 fills from ordinary daily movement, so it isn’t counted toward your
              training week.
            </AppText>
          )}
        </>
      )}
    </Card>
  );
}
export function StepsQuotaCard({ steps }: { steps: CardioWeek['steps'] }) {
  return (
    <Card>
      <AppText variant="eyebrow" tone="muted">
        Steps
      </AppText>
      <Grid gap="sm">
        {(
          [
            [steps.today, steps.todayGoal, 'today'],
            [steps.week, steps.weekGoal, 'wk'],
          ] as const
        ).map(([value, goal, label]) => (
          <Stack key={label}>
            <AppText variant="caption">
              {value.toLocaleString()} / {goal.toLocaleString()} {label}
            </AppText>
            <ProgressBar value={goal > 0 ? value / goal : 0} />
          </Stack>
        ))}
      </Grid>
    </Card>
  );
}
