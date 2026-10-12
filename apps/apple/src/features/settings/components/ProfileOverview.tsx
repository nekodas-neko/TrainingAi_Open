import { useEffect } from 'react';
import {
  shiftDateStr,
  formatDateDisplay,
  toAestDay,
  msToHHMMInTz,
} from '@trainingai/shared/date-utils';
import {
  readingGroups,
  sleepAverages,
  circularMeanMinutes,
  clockFromMinutes,
  type MetricRow,
  type ReadingGroup,
} from '@trainingai/shared/profile/measured-overview';
import { performanceGroups } from '@trainingai/shared/profile/performance-overview';
import { AppButton, AppText, Card, ListRow, Stack, StatusIndicator } from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { bodyOverviewSpec } from '../../health/data/models';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useAppleImport } from '../../health/HealthProvider';
import { rmrSpec, dexaSpec } from '../../health/data/clinical';
import { baselinesSpec } from '../../activities/data/models';
import { useActivities } from '../../activities/data/ActivityProvider';
import { StrengthScreen } from '../../progress/StrengthScreen';
export function ReadingCards({ groups }: { groups: ReadingGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <Card key={group.title}>
          <AppText variant="eyebrow" tone="muted">
            {group.title}
          </AppText>
          {group.readings.map((row) => (
            <Stack key={row.label} gap="xs">
              <Stack direction="row" justify="space-between">
                <AppText style={{ flex: 1 }}>{row.label}</AppText>
                <Stack gap="xs" align="flex-end">
                  <AppText variant="label">{row.value}</AppText>
                  <AppText variant="micro" tone="muted">
                    {formatDateDisplay(row.asOf, 'short')}
                  </AppText>
                </Stack>
              </Stack>
              {row.note && (
                <AppText variant="caption" tone="muted">
                  {row.note}
                </AppText>
              )}
            </Stack>
          ))}
        </Card>
      ))}
    </>
  );
}
export function ProfileOverview({
  openClinical,
  openBaselines,
}: {
  openClinical?: () => void;
  openBaselines?: () => void;
}) {
  const health = useHealthData(),
    apple = useAppleImport(),
    activities = useActivities();
  const history = useWorkoutResource(bodyOverviewSpec(health.today));
  useEffect(() => {
    void health.store?.refresh();
  }, [health.store, health.today]);
  const rmr = useWorkoutResource(rmrSpec),
    dexa = useWorkoutResource(dexaSpec),
    tests = useWorkoutResource(baselinesSpec);
  const rows = new Map(
    (history.data?.measuredOverview ?? history.data?.recent ?? []).map((x) => [x.date, x]),
  );
  for (const row of health.body?.recent ?? []) rows.set(row.date, row);
  const groups = readingGroups(
    [...rows.values()]
      .filter((x) => x.date >= shiftDateStr(health.today, -366))
      .map((x) => ({
        ...x,
        bodyFatPct: x.bodyFatCorrected ?? x.bodyFat,
      })) as unknown as MetricRow[],
  );
  const sdnn = apple.completed?.hrv;
  if (sdnn)
    groups.push({
      title: 'Apple Health',
      readings: [
        {
          label: 'HRV · SDNN',
          value: `${sdnn.value.toFixed(1)} ms`,
          asOf: toAestDay(new Date(sdnn.at), health.timezone),
        },
      ],
    });
  const nights = health.sleep.filter((x) => !x.provisional);
  const sleep = sleepAverages(nights);
  const bedtime = circularMeanMinutes(
    nights.map((x) => x.sleepStart),
    (iso) => {
      const [h, m] = msToHHMMInTz(iso, health.timezone).split(':').map(Number);
      return h * 60 + m;
    },
  );
  const entries = new Map((tests.data?.fitnessTests ?? []).map((x) => [x.id, x]));
  for (const row of activities.tests)
    if (row.pending || !entries.has(row.payload.id)) entries.set(row.payload.id, row.payload);
  const performance = performanceGroups({
    fitnessTests: [...entries.values()],
    dexaScans: dexa.data?.scans,
    measuredRmr: rmr.data?.tests,
  });
  return (
    <>
      <AppText variant="heading">What the app has measured</AppText>
      <AppText variant="caption" tone="muted">
        The latest reading of each metric and when it was taken.
      </AppText>
      <StatusIndicator
        label="Measured readings"
        busy={history.refreshing}
        error={history.error}
        onRetry={history.refresh}
      />
      <ReadingCards groups={groups} />
      {history.data && history.data.measuredOverview == null && (
        <AppText variant="caption" tone="muted">
          Showing recent saved readings. Older history couldn’t be loaded.
        </AppText>
      )}
      <StatusIndicator
        label="Sleep readings"
        busy={health.refreshing}
        error={health.sleepError}
        onRetry={health.refresh}
      />
      {sleep && (
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Sleep · average of {sleep.nights} nights
          </AppText>
          {[
            [
              'Time asleep',
              sleep.durationHours == null ? null : `${sleep.durationHours.toFixed(1)} h`,
            ],
            ['Bedtime', bedtime == null ? null : clockFromMinutes(bedtime)],
            [
              'Efficiency',
              sleep.efficiency == null ? null : `${Math.round(sleep.efficiency)}%`,
            ],
            [
              'Lowest heart rate overnight',
              sleep.lowestHeartRate == null ? null : `${Math.round(sleep.lowestHeartRate)} bpm`,
            ],
            [
              'Breathing rate',
              sleep.respiratoryRate == null ? null : `${sleep.respiratoryRate.toFixed(1)} /min`,
            ],
          ]
            .filter(([, value]) => value != null)
            .map(([label, value]) => (
              <ListRow key={label!} title={label!} subtitle={value!} />
            ))}
        </Card>
      )}
      <AppText variant="heading">Tests and scans</AppText>
      <StatusIndicator
        label="Tests and scans"
        busy={rmr.refreshing || dexa.refreshing || tests.refreshing}
        error={rmr.error ?? dexa.error ?? tests.error}
        onRetry={() => {
          rmr.refresh();
          dexa.refresh();
          tests.refresh();
        }}
      />
      <ReadingCards groups={performance} />
      {openClinical && (
        <AppButton title="DEXA & RMR results" variant="ghost" onPress={openClinical} />
      )}
      {openBaselines && (
        <AppButton title="Fitness baselines" variant="ghost" onPress={openBaselines} />
      )}
      <AppText variant="heading">Lifting</AppText>
      <StrengthScreen embedded section="records" onBack={() => {}} />
    </>
  );
}
