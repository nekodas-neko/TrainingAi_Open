import { z } from 'zod';
import {
  AppText,
  Card,
  Grid,
  MetricTile,
  BarChart,
  PageLayout,
  Stack,
  StatusIndicator,
  TabPanel,
  Skeleton,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useTheme } from '../../../shared/theme/ThemeProvider';
const schema = z.object({
  sessionCount: z.number(),
  totalSets: z.number(),
  totalVolumeKg: z.number(),
  totalMinutes: z.number(),
  prCount: z.number(),
  longestWeeklyStreak: z.number(),
  monthlySessionCounts: z.array(z.number()),
  topExercises: z.array(
    z.object({
      exerciseName: z.string(),
      setCount: z.number(),
      first1rm: z.number().nullable(),
      last1rm: z.number().nullable(),
      exerciseType: z.string().nullable(),
    }),
  ),
  biggestPr: z
    .object({
      exerciseName: z.string(),
      estimated1rm: z.number(),
      exerciseType: z.string().nullable(),
    })
    .nullable(),
});
export function YearReviewScreen({ onBack }: { onBack: () => void }) {
  const state = useWorkoutResource({ path: '/api/year-review', ttl: 1800000, schema }),
    { theme } = useTheme();
  const data = state.data;
  const months = Array.from({ length: 12 }, (_, i) => {
    const date = new Date();
    date.setMonth(date.getMonth() - 11 + i, 1);
    return date.toLocaleDateString('en-AU', { month: 'short' });
  });
  return (
    <PageLayout
      title="Your Year"
      subtitle="The last 12 months"
      onBack={onBack}
      actions={
        <StatusIndicator
          label="Your Year"
          busy={state.loading}
          error={state.error}
          onRetry={state.refresh}
        />
      }
    >
      <TabPanel>
        <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
          {!data ? (
            <Card>
              <Skeleton style={{ height: theme.sizes.weekVolumeChart }} />
            </Card>
          ) : (
            <>
              <Grid columns={2}>
                {[
                  ['Sessions', data.sessionCount, ''],
                  ['Sets', data.totalSets, ''],
                  ['Volume', data.totalVolumeKg, 'kg'],
                  ['Training time', Math.round(data.totalMinutes / 60), 'h'],
                  ['Personal records', data.prCount, ''],
                  ['Best weekly streak', data.longestWeeklyStreak, 'weeks'],
                ].map(([label, value, unit]) => (
                  <MetricTile
                    key={String(label)}
                    label={String(label)}
                    value={String(value)}
                    unit={String(unit)}
                  />
                ))}
              </Grid>
              <Card>
                <AppText variant="heading">Sessions by month</AppText>
                <BarChart
                  label="Sessions by month"
                  unit="sessions"
                  height={theme.sizes.weekVolumeChart}
                  bars={data.monthlySessionCounts.map((value, index) => ({
                    label: months[index],
                    value,
                    colors: [theme.colors.brand],
                  }))}
                />
              </Card>
              {data.biggestPr && (
                <Card>
                  <AppText variant="heading">Biggest personal record</AppText>
                  <AppText>{data.biggestPr.exerciseName}</AppText>
                  <AppText variant="hero">
                    {data.biggestPr.estimated1rm.toFixed(1)}{' '}
                    {data.biggestPr.exerciseType === 'bodyweight'
                      ? 'BW-relative index'
                      : 'kg estimated 1RM'}
                  </AppText>
                </Card>
              )}
              <Card>
                <AppText variant="heading">Top exercises</AppText>
                {data.topExercises.length ? (
                  data.topExercises.map((row) => (
                    <Stack key={row.exerciseName}>
                      <AppText variant="label">
                        {row.exerciseName} · {row.setCount} sets
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {row.first1rm?.toFixed(1) ?? '—'} → {row.last1rm?.toFixed(1) ?? '—'}{' '}
                        {row.exerciseType === 'bodyweight'
                          ? 'BW-relative index'
                          : 'kg estimated 1RM'}
                      </AppText>
                    </Stack>
                  ))
                ) : (
                  <AppText tone="muted">No recorded exercises yet.</AppText>
                )}
              </Card>
            </>
          )}
        </Stack>
      </TabPanel>
    </PageLayout>
  );
}
