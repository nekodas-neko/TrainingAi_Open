import { useState } from 'react';
import { View } from 'react-native';
import { z } from 'zod';
import { SELECTABLE_CARDIO_GOALS } from '@trainingai/shared/running/cardio-goals';
import { RUN_TYPES_FOR_STATS } from '@trainingai/shared/running/run-type-stats';
import { targetsForRunType } from '@trainingai/shared/running/hr-targets';
import { recommendRunType } from '@trainingai/shared/running/recommend-run-type';
import { formatPace } from '@trainingai/shared/health/vdot';
import type { RunType } from '@trainingai/shared/running/types';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  Carousel,
  ChipPicker,
  Grid,
  IconButton,
  MetricTile,
  NumericStepper,
  PageLayout,
  Picker,
  Sheet,
  StableContent,
  Stack,
  StatusIndicator,
  StateCard,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useActivities, useMeasuredRunCompletion } from '../data/ActivityProvider';
import { cardioWeekSpec, runningPlanSpec } from '../data/models';
const label: Record<RunType, string> = {
  recovery: 'Recovery run',
  easy: 'Easy run',
  long: 'Long run',
  tempo: 'Tempo run',
  interval: 'Interval session',
};
const blurb: Record<RunType, string> = {
  recovery: 'Keep it very light',
  easy: 'Conversational pace',
  long: 'Same easy effort, longer',
  tempo: 'Comfortably hard',
  interval: 'High-intensity work',
};
const form = z.object({
  goal: z.string(),
  distance: z.string(),
  mode: z.enum(['growing', 'fixed']),
  minutes: z.string(),
});
const initial = {
  goal: 'heart_health',
  distance: '5',
  mode: 'growing' as const,
  minutes: '30',
};
const n = z.number().finite().nullish();
const bestsSpec = {
  path: '/api/running-bests',
  ttl: 900000,
  schema: z.object({
    totalRuns: z.number(),
    best1kSec: n,
    best5kSec: n,
    bestAvgPaceSecPerKm: n,
    longestDistanceKm: n,
  }),
};
const statsSpec = {
  path: '/api/running-plan/run-type-stats',
  ttl: 900000,
  schema: z.record(
    z.string(),
    z.object({ count: z.number(), avgPaceSecPerKm: n, avgDistanceKm: n, avgHr: n }),
  ),
};
const paths = ['/api/running-plan', '/api/cardio-week'];
export function RunningScreen({
  onBack,
  openActivity,
}: {
  onBack: () => void;
  openActivity: () => void;
}) {
  const { today } = useHealthData(),
    { theme } = useTheme();
  const state = useWorkoutResource(runningPlanSpec(today)),
    week = useWorkoutResource(cardioWeekSpec(today));
  const bests = useWorkoutResource(bestsSpec),
    stats = useWorkoutResource(statsSpec);
  const draft = useWorkoutDraft('running-setup', form, initial),
    action = useWorkoutAction(),
    activity = useActivities();
  const [setup, setSetup] = useState(false);
  const data = state.data,
    prescription = data?.prescription;
  useMeasuredRunCompletion(data?.heartHealth?.days);
  const type = prescription?.type ?? 'easy';
  const minutes = prescription?.durationMin ?? 30;
  const fitness = data?.plan?.fitnessSnapshot;
  const recommended = week.data
    ? recommendRunType({
        ...week.data.quota,
        zones: week.data.quota.zones.map((row) => ({
          ...row,
          zoneId: row.zoneId as 1 | 2 | 3 | 4 | 5,
        })),
      })
    : null;
  async function override(runType: RunType, durationMin: number) {
    if (action.busy || !state.resources) {
      return;
    }
    await action.run(async () => {
      await state.resources!.write(
        'POST',
        '/api/running-plan/override',
        { runType, durationMin },
        paths,
      );
      await state.resources!.load(runningPlanSpec(today), true);
      const actual = state.resources!.state(runningPlanSpec(today)).data?.prescription;
      if (!actual) {
        throw new Error(
          'The update was sent, but the new prescription could not be confirmed. Retry refresh.',
        );
      }
    });
  }
  async function start() {
    await action.run(async () => {
      if (!activity.store) {
        throw new Error('Connect your account first.');
      }
      await activity.store.start({
        id: 'run',
        label: 'Run',
        icon: 'PersonSimpleRun',
        isDistanceBased: true,
      });
      if (prescription) {
        await activity.store.update({
          target: {
            label: label[prescription.type],
            minutes: prescription.durationMin ?? null,
            hrLow: prescription.targets.hrLowBpm,
            hrHigh: prescription.targets.hrHighBpm,
          },
        });
      }
      openActivity();
    });
  }
  const selectedGoal = SELECTABLE_CARDIO_GOALS.find((goal) => goal.key === draft.value.goal);
  return (
    <PageLayout
      title="Running"
      onBack={onBack}
      scroll
      actions={
        <StatusIndicator
          label="Running plan"
          busy={action.busy || state.refreshing}
          error={action.error ?? state.error}
          onRetry={state.refresh}
        />
      }
    >
      <StableContent minHeight={320} loading={!data && state.loading}>
        {!state.connected ? (
          <StateCard title="Connect your account" message="Sign in to set up a running plan." />
        ) : !data ? (
          <StateCard
            title="Running plan unavailable"
            message="Check your connection and retry."
            action="Retry"
            onAction={state.refresh}
          />
        ) : !data.plan ? (
          <StateCard
            title="No running plan yet"
            message="Set one up and the app will prescribe your next run."
            action="Set up my running plan"
            onAction={() => setSetup(true)}
          />
        ) : (
          <>
            {!!bests.data?.totalRuns && (
              <Card>
                <AppText variant="eyebrow" tone="muted">
                  Your bests
                </AppText>
                <Grid>
                  {(
                    [
                      [
                        'Best 1K',
                        bests.data.best1kSec == null
                          ? null
                          : `${Math.floor(bests.data.best1kSec / 60)}:${String(Math.round(bests.data.best1kSec % 60)).padStart(2, '0')}`,
                      ],
                      [
                        'Best 5K',
                        bests.data.best5kSec == null
                          ? null
                          : `${Math.floor(bests.data.best5kSec / 60)}:${String(Math.round(bests.data.best5kSec % 60)).padStart(2, '0')}`,
                      ],
                      [
                        'Best pace',
                        bests.data.bestAvgPaceSecPerKm == null
                          ? null
                          : formatPace(bests.data.bestAvgPaceSecPerKm),
                      ],
                      [
                        'Longest run',
                        bests.data.longestDistanceKm == null
                          ? null
                          : `${bests.data.longestDistanceKm.toFixed(1)} km`,
                      ],
                    ] as const
                  )
                    .filter(([, value]) => value !== null)
                    .map(([name, value]) => (
                      <MetricTile key={name} label={name} value={value} compact />
                    ))}
                </Grid>
              </Card>
            )}
            {stats.data && Object.values(stats.data).some((row) => row.count > 0) && (
              <Card>
                <AppText variant="eyebrow" tone="muted">
                  By run type
                </AppText>
                {RUN_TYPES_FOR_STATS.filter((key) => (stats.data?.[key]?.count ?? 0) > 0).map(
                  (key) => {
                    const row = stats.data![key];
                    return (
                      <Stack key={key} direction="row" justify="space-between">
                        <AppText variant="caption">{label[key]}</AppText>
                        <AppText variant="micro" tone="muted">
                          {row.avgPaceSecPerKm == null ? '—' : formatPace(row.avgPaceSecPerKm)}{' '}
                          · {row.avgDistanceKm?.toFixed(1) ?? '—'} km · {row.avgHr ?? '—'} bpm
                        </AppText>
                      </Stack>
                    );
                  },
                )}
              </Card>
            )}
            {data.run?.status === 'completed' ||
            data.heartHealth?.days.some(
              (day) => day.date.replace(/\//g, '-') === today && day.met,
            ) ||
            activity.runs.some(
              (row) =>
                row.date.replace(/\//g, '-') === today && row.payload.status === 'completed',
            ) ? (
              <Card tone="recovery">
                <AppText>Today’s heart-health activity is done.</AppText>
                <AppButton title="Back to Cardio" variant="surface" onPress={onBack} />
              </Card>
            ) : (
              prescription && (
                <>
                  <Card>
                    <AppText variant="eyebrow" tone="muted">
                      Not feeling it? Swipe to pick something else
                    </AppText>
                    <Stack direction="row" align="center" justify="center">
                      <IconButton
                        icon="lower"
                        label="Remove 10 minutes"
                        disabled={action.busy || minutes <= 10}
                        onPress={() => void override(type, Math.max(10, minutes - 10))}
                      />
                      <AppText variant="heading">{minutes} min</AppText>
                      <IconButton
                        icon="plus"
                        label="Add 10 minutes"
                        disabled={action.busy || minutes >= 120}
                        onPress={() => void override(type, Math.min(120, minutes + 10))}
                      />
                    </Stack>
                    <View style={{ height: theme.sizes.chartHeight }}>
                      <Carousel
                        items={RUN_TYPES_FOR_STATS.map((id) => ({ id }))}
                        selectedId={type}
                        onSelect={(id) => void override(id as RunType, minutes)}
                        label={(item) => label[item.id]}
                        renderItem={(item) => {
                          const targets = fitness ? targetsForRunType(item.id, fitness) : null;
                          return (
                            <Stack align="center" justify="center" style={{ flex: 1 }}>
                              <Badge
                                label={
                                  recommended?.type === item.id ? 'Recommended' : label[item.id]
                                }
                              />
                              <AppText variant="hero">{label[item.id]}</AppText>
                              <AppText tone="muted" variant="caption">
                                {blurb[item.id]}
                              </AppText>
                              <AppText variant="caption">
                                {targets
                                  ? `Zone ${targets.zoneIds.join('–')} · ${targets.hrLowBpm}–${targets.hrHighBpm} bpm`
                                  : 'Heart-rate targets unavailable'}
                              </AppText>
                              <AppText variant="micro" tone="muted">
                                {recommended?.type === item.id ? recommended.reason : ' '}
                              </AppText>
                            </Stack>
                          );
                        }}
                      />
                    </View>
                  </Card>
                  <Card>
                    <AppText variant="heading">{label[prescription.type]}</AppText>
                    {data.isPushSession && <Badge label="Push" tone="activity" />}
                    <AppText variant="caption" tone="muted">
                      {prescription.durationMin ?? '—'} min
                      {prescription.distanceKm != null
                        ? ` · ${prescription.distanceKm.toFixed(2)} km target`
                        : ''}{' '}
                      · Zone {prescription.targets.zoneIds.join('–')} ·{' '}
                      {prescription.targets.hrLowBpm}–{prescription.targets.hrHighBpm} bpm
                    </AppText>
                    <AppText>{prescription.rationale}</AppText>
                    {data.gateAction !== 'proceed' && !!data.gateReasons?.length && (
                      <Card tone="activity">
                        <AppText variant="label">
                          {data.gateAction === 'rest'
                            ? 'Dialed back to recovery'
                            : 'Eased off today'}
                        </AppText>
                        {data.gateReasons.map((reason) => (
                          <AppText key={reason} variant="caption">
                            {reason}
                          </AppText>
                        ))}
                      </Card>
                    )}
                    <AppButton
                      title={activity.session ? 'Resume activity' : 'Start run'}
                      busy={action.busy}
                      disabled={!activity.ready}
                      onPress={() => (activity.session ? openActivity() : void start())}
                    />
                  </Card>
                </>
              )
            )}
            {data.zoneTargets && (
              <Card>
                <AppText variant="heading">Weekly zone targets</AppText>
                <AppText variant="caption" tone="muted">
                  {data.goal?.label} · {data.zoneTargets.totalMinutes} min
                </AppText>
                {data.zoneTargets.perZone.map((zone) => (
                  <Stack key={zone.zoneId} direction="row" justify="space-between">
                    <AppText variant="caption">Zone {zone.zoneId}</AppText>
                    <AppText variant="caption">{zone.minutes} min</AppText>
                  </Stack>
                ))}
                <AppText variant="micro" tone="muted">
                  {data.zoneTargets.guidelineNote}
                </AppText>
              </Card>
            )}
          </>
        )}
      </StableContent>
      <Sheet
        fullHeight
        visible={setup}
        title="Set up your running plan"
        onClose={() => setSetup(false)}
      >
        <StatusIndicator
          label="Plan setup"
          error={action.error ?? draft.error}
          busy={action.busy}
        />
        <AppText variant="caption" tone="muted">
          Pick a goal — the app prescribes each run and adapts to your recovery.
        </AppText>
        <Picker
          label="Goal"
          value={draft.value.goal}
          options={SELECTABLE_CARDIO_GOALS.map((goal) => ({
            value: goal.key,
            label: goal.label,
          }))}
          onChange={(goal) => draft.setValue((value) => ({ ...value, goal }))}
        />
        <AppText tone="muted">{selectedGoal?.blurb}</AppText>
        {selectedGoal?.needsTargetDistance && (
          <ChipPicker
            label="Target distance"
            value={draft.value.distance}
            options={[
              { value: '3', label: '3K' },
              { value: '5', label: '5K' },
              { value: '10', label: '10K' },
              { value: '21.1', label: 'Half' },
              { value: '42.2', label: 'Marathon' },
            ]}
            onChange={(distance) => {
              if (distance) {
                draft.setValue((value) => ({ ...value, distance }));
              }
            }}
          />
        )}
        <Picker
          label="Session length"
          value={draft.value.mode}
          options={[
            { value: 'growing', label: 'Grow session length' },
            { value: 'fixed', label: 'Fixed session time' },
          ]}
          onChange={(mode) =>
            draft.setValue((value) => ({ ...value, mode: mode as 'growing' | 'fixed' }))
          }
        />
        <NumericStepper
          label="Default minutes per session"
          value={draft.value.minutes}
          min={10}
          max={120}
          step={10}
          onChange={(minutes) => draft.setValue((value) => ({ ...value, minutes }))}
        />
        <AppButton
          title="Create running plan"
          busy={action.busy}
          disabled={!draft.ready || !selectedGoal}
          onPress={() =>
            void action.run(async () => {
              const minutes = z
                .number()
                .int()
                .min(10)
                .max(120)
                .parse(Number(draft.value.minutes));
              await draft.resources!.write(
                'POST',
                '/api/running-plan',
                {
                  goalKind: draft.value.goal,
                  timePerSessionMinutes: minutes,
                  ...(selectedGoal?.needsTargetDistance
                    ? { targetDistanceKm: Number(draft.value.distance) }
                    : {}),
                  ...(draft.value.mode === 'fixed'
                    ? { frameworkKey: 'density-progression' }
                    : {}),
                },
                paths,
              );
              await draft.resources!.load(runningPlanSpec(today), true);
              setSetup(false);
            })
          }
        />
      </Sheet>
    </PageLayout>
  );
}
