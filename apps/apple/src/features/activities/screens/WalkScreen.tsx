import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { z } from 'zod';
import { recommendWalkPattern } from '@trainingai/shared/walking/recommend-walk-pattern';
import {
  AppButton,
  AppText,
  Card,
  Carousel,
  Grid,
  KeyValueGrid,
  NumericStepper,
  PageLayout,
  StableContent,
  Stack,
  StatusIndicator,
  SwitchRow,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
import { useActivities } from '../data/ActivityProvider';
import { defaultWalk, walkConfigSchema, walkPlan } from '../data/guidance';
import { cardioWeekSpec } from '../data/models';
const schema = z.object({
  config: walkConfigSchema,
  custom: walkConfigSchema.nullable(),
  selected: z.string(),
});
const initial = { config: defaultWalk, custom: null, selected: 'Long' };
const aggregate = z
  .object({
    count: z.number(),
    avgHr: z.number().nullish(),
    avgPaceSecPerKm: z.number().nullish(),
    avgCadenceSpm: z.number().nullish(),
    avgDistanceKm: z.number().nullish(),
  })
  .passthrough();
export function WalkScreen({
  onBack,
  openActivity,
}: {
  onBack: () => void;
  openActivity: () => void;
}) {
  const { today } = useHealthData(),
    { theme } = useTheme();
  const week = useWorkoutResource(cardioWeekSpec(today));
  const stats = useWorkoutResource({
    path: '/api/guided-walk/segment-stats',
    ttl: 900000,
    schema: z.object({ fast: aggregate, slow: aggregate }),
  });
  const draft = useWorkoutDraft('walk-config', schema, initial),
    action = useWorkoutAction(),
    activity = useActivities();
  const touched = useRef(false),
    applied = useRef(false);
  const config = draft.value.config,
    plan = walkPlan(config);
  const rec = week.data
    ? recommendWalkPattern({
        ...week.data.quota,
        zones: week.data.quota.zones.map((row) => ({
          ...row,
          zoneId: row.zoneId as 1 | 2 | 3 | 4 | 5,
        })),
      })
    : null;
  function select(id: string) {
    touched.current = true;
    draft.setValue((value) => {
      let next = value.config;
      if (id === 'Long') {
        next = { ...next, sets: 5, fastSec: 180, slowSec: 180 };
      }
      if (id === 'Short') {
        next = { ...next, sets: 3, fastSec: 180, slowSec: 180 };
      }
      if (id === 'Custom') {
        next = value.custom ?? defaultWalk;
      }
      if (id === 'Today' && rec) {
        const p = rec.pattern,
          cycle = p.fastMin + p.slowMin;
        next = {
          ...next,
          sets: cycle > 0 ? Math.max(1, Math.round(30 / cycle)) : 1,
          fastSec: cycle > 0 ? p.fastMin * 60 : p.id === 'easy_steps' ? 0 : 1800,
          slowSec: cycle > 0 ? p.slowMin * 60 : p.id === 'easy_steps' ? 1800 : 0,
        };
      }
      return { ...value, config: next, selected: id };
    });
  }
  useEffect(() => {
    if (draft.ready && rec && !applied.current && !touched.current) {
      applied.current = true;
      select('Today');
    }
  }, [draft.ready, week.data]);
  function edit(key: keyof typeof config, value: number | boolean) {
    touched.current = true;
    draft.setValue((old) => {
      const next = { ...old.config, [key]: value };
      return { config: next, custom: next, selected: 'Custom' };
    });
  }
  return (
    <PageLayout
      title="Interval walk"
      onBack={onBack}
      scroll
      actions={
        <StatusIndicator
          label="Walk setup"
          error={action.error ?? draft.error ?? week.error}
          busy={action.busy}
          onRetry={week.refresh}
        />
      }
    >
      <AppText variant="caption" tone="muted">
        Alternate fast and slow blocks. The classic method is 3 min fast / 3 min slow, repeated.
      </AppText>
      <StableContent minHeight={200} loading={!draft.ready}>
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Today’s walk · swipe to override
          </AppText>
          <View style={{ height: theme.sizes.recommendationCard + theme.spacing.xl }}>
            <Carousel
              items={['Today', 'Long', 'Short', 'Custom'].map((id) => ({ id }))}
              selectedId={draft.value.selected}
              onSelect={select}
              label={(item) => item.id}
              renderItem={(item) => (
                <Stack align="center" justify="center" style={{ flex: 1 }}>
                  <AppText variant="hero">
                    {item.id === 'Today' ? (rec?.pattern.label ?? 'Today') : item.id}
                  </AppText>
                  <AppText tone="muted" variant="caption">
                    {item.id === 'Today'
                      ? (rec?.reason ?? 'Choose a preset while your week loads.')
                      : item.id === 'Custom'
                        ? 'Your saved setup'
                        : item.id === 'Long'
                          ? 'The classic method, repeated'
                          : 'Shorter session, same rhythm'}
                  </AppText>
                  <AppText variant="caption">
                    {config.sets} × {config.fastSec / 60}/{config.slowSec / 60} min · ~
                    {Math.round(plan.totalSec / 60)} min total
                  </AppText>
                </Stack>
              )}
            />
          </View>
        </Card>
      </StableContent>
      <Grid>
        {(
          [
            ['sets', 'Sets', 1, 12, 1],
            ['fastSec', 'Fast (min)', 0, 10, 60],
            ['slowSec', 'Slow (min)', 0, 10, 60],
            ['warmupSec', 'Warm-up (min)', 0, 10, 60],
            ['cooldownSec', 'Cool-down (min)', 0, 10, 60],
          ] as const
        ).map(([key, label, min, max, divisor]) => (
          <NumericStepper
            key={key}
            label={label}
            value={String(Number(config[key]) / divisor)}
            min={min}
            max={max}
            disabled={!draft.ready || action.busy}
            onChange={(value) => {
              const n = Number(value);
              if (Number.isFinite(n) && n >= min && n <= max) {
                edit(key, n * divisor);
              }
            }}
          />
        ))}
      </Grid>
      <Card>
        <AppText variant="eyebrow" tone="muted">
          Step-rate targets
        </AppText>
        <Grid>
          <NumericStepper
            label="Fast spm ≥"
            value={String(config.fastCadenceSpm)}
            min={60}
            max={200}
            step={5}
            onChange={(value) => edit('fastCadenceSpm', Number(value))}
          />
          <NumericStepper
            label="Slow spm ≤"
            value={String(config.slowCadenceSpm)}
            min={40}
            max={160}
            step={5}
            onChange={(value) => edit('slowCadenceSpm', Number(value))}
          />
        </Grid>
        <AppText variant="micro" tone="muted">
          Targets guide the intervals. Live step-rate, speed and heart-rate pacing need the
          deferred device integrations.
        </AppText>
      </Card>
      <SwitchRow
        label="Treadmill · no GPS distance or pace"
        value={config.treadmill}
        onValueChange={(value) => edit('treadmill', value)}
      />
      <AppText variant="label">Total: ~{Math.round(plan.totalSec / 60)} min</AppText>
      <AppButton
        title={activity.session ? 'Resume activity' : 'Start walk'}
        disabled={!draft.ready || !activity.ready}
        busy={action.busy}
        onPress={() =>
          activity.session
            ? openActivity()
            : void action.run(async () => {
                const valid = walkConfigSchema.parse(config);
                await activity.store!.start(
                  {
                    id: valid.treadmill ? 'treadmill' : 'walk',
                    label: 'Interval walk',
                    icon: 'PersonSimpleWalk',
                    isDistanceBased: !valid.treadmill,
                  },
                  { kind: 'walk', config: valid, saved: false },
                );
                await activity.store!.begin();
                openActivity();
              })
        }
      />
      {stats.data && (
        <Card>
          <AppText variant="heading">Your interval history</AppText>
          <Grid>
            {(['fast', 'slow'] as const).map((kind) => (
              <Card key={kind}>
                <AppText variant="label">{kind === 'fast' ? 'Fast avg' : 'Slow avg'}</AppText>
                <KeyValueGrid
                  rows={[
                    { label: 'Blocks', value: String(stats.data![kind].count) },
                    {
                      label: 'HR',
                      value:
                        stats.data![kind].avgHr == null
                          ? '—'
                          : `${stats.data![kind].avgHr} bpm`,
                    },
                    {
                      label: 'Cadence',
                      value:
                        stats.data![kind].avgCadenceSpm == null
                          ? '—'
                          : `${stats.data![kind].avgCadenceSpm} spm`,
                    },
                  ]}
                />
              </Card>
            ))}
          </Grid>
        </Card>
      )}
    </PageLayout>
  );
}
