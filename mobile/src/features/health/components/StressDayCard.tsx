import { HealthResourceHeader } from './HealthResourceHeader';
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import {
  elevatedAreas,
  stressBridges,
  stressRuns,
  STILL_HR_RUN_GAP_MS,
  STRESS_ELEVATED_LEVEL,
} from '@trainingai/shared/health/stress-day-line';
import { AppText, Card, Legend, LineChart } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { scaleAlpha } from '../../../shared/theme/alpha';
import { useHealthData } from '../data/HealthDataProvider';
import { stressSpec } from '../data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';

// What the line under the title says the levels are made from (#3939, owner 20 Nov: wording A).
const METHOD_LINE = {
  still_hr: 'Estimated from heart rate while still',
  ring_dhrv: 'From the ring’s stress estimate',
} as const;

export function StressDayCard({ date, enabled = true }: { date: string; enabled?: boolean }) {
  const { timezone, today } = useHealthData();
  const { theme } = useTheme();
  const state = useWorkoutResource(stressSpec(date), enabled);
  const method = state.data?.method ?? null;
  const stillHr = method === 'still_hr';
  // Plotted negated, so stress points up. x is the bucket's instant. A heart-rate day splits at every
  // missing half hour, so movement is always bridged.
  const runs = stressRuns(state.data?.series ?? [], stillHr ? STILL_HR_RUN_GAP_MS : undefined).map((run) =>
    run.map((p) => ({ x: p.t, level: p.level })),
  );
  const points = runs.flatMap((run, index) => [
    ...(index ? [{ label: 'No reading', x: run[0].x - 1, value: null }] : []),
    ...run.map((p) => ({ label: formatTimeOfDay(p.x, timezone), x: p.x, value: -p.level })),
  ]);
  if (!enabled || (state.data && !points.length)) {
    return null;
  }
  const amber = theme.status.warning;
  const movingColor = theme.tones.activity.foreground;
  const asleepColor = theme.tones.sleep.foreground;
  // #3939: on a heart-rate day the runs are joined by dotted, fainter bridges. A bridge is never a
  // reading: it is a separate series, so the chart's own label lists measured points only. A ring
  // day keeps its gaps, which were hours the ring did not record.
  const bridges = stillHr
    ? stressBridges(runs).flatMap(([a, b]) => [
        { x: a.x, value: -a.level },
        { x: b.x, value: -b.level },
        { x: b.x, value: null },
      ])
    : [];
  const areas = runs.flatMap((run) =>
    elevatedAreas(run).map((poly) => ({
      color: scaleAlpha(amber, 0.35),
      points: poly.map((v) => ({ x: v.x, value: -v.level })),
    })),
  );
  const strip = [
    ...(state.data?.asleep ?? []).map((s) => ({ from: s.startMs, to: s.endMs, color: asleepColor })),
    ...(state.data?.moving ?? []).map((s) => ({ from: s.startMs, to: s.endMs, color: movingColor })),
  ];
  const first = points[0]?.x ?? 0;
  const last = points.at(-1)?.x ?? 0;
  const shown = strip.filter((s) => s.to > first && s.from < last);
  const key = [
    ...(areas.length ? [{ label: 'Elevated', color: amber, shape: 'square' as const }] : []),
    ...(shown.some((s) => s.color === movingColor)
      ? [{ label: 'Moving', color: movingColor, shape: 'square' as const }]
      : []),
    ...(shown.some((s) => s.color === asleepColor)
      ? [{ label: 'Asleep', color: asleepColor, shape: 'square' as const }]
      : []),
  ];
  const through =
    state.data?.throughMs != null ? formatTimeOfDay(state.data.throughMs, timezone) : null;
  return (
    <Card>
      <HealthResourceHeader
        title={date === today ? 'When today ran stressed' : 'When the day ran stressed'}
        state={state}
        refresh={state.refresh}
      />
      {method && (
        <AppText variant="caption" tone="muted">
          {METHOD_LINE[method]}
        </AppText>
      )}

      {!!points.length && (
        <LineChart
          points={points}
          label={`Estimated stress, ${date}`}
          tone="heart"
          color={amber}
          domain={[-1, 1]}
          target={{ value: -STRESS_ELEVATED_LEVEL, label: 'Elevated' }}
          areas={areas}
          series={
            bridges.length
              ? [
                  {
                    label: 'Joined, no reading',
                    color: scaleAlpha(amber, 0.5),
                    dashed: true,
                    domain: [-1, 1],
                    points: bridges,
                  },
                ]
              : []
          }
          strip={shown}
        />
      )}
      {key.length > 0 && <Legend items={key} />}
      {!!points.length && (
        <AppText variant="caption" tone="muted">
          {stillHr
            ? 'Higher means your heart rate sat above your usual while still. The dotted stretches join the readings either side, where you were moving.'
            : 'Higher means more stress. Blank stretches are hours the ring did not record.'}
          {through ? (stillHr ? ` Through ${through}.` : ` Recorded through ${through}.`) : ''}
        </AppText>
      )}
    </Card>
  );
}
