import { capitalize } from '@trainingai/shared/format/capitalize';
import {
  GENERIC_BARS_CAPTION,
  GENERIC_TARGET,
  MAX_TARGET,
  TARGET_BARS_CAPTION,
  muscleVolumeColor,
} from '@trainingai/shared/health/volume-band';
import { useState } from 'react';
import { View } from 'react-native';
import {
  AppText,
  Legend,
  LineChart,
  MuscleMap,
  ProgressBar,
  Stack,
  TouchSurface,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { muscleTonnageTrendSpec } from '../data/models';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  TONNAGE_TREND_CAPTION,
  muscleLegendItems,
  muscleSetsLabel,
  muscleTonnageValues,
} from '../data/training-view';

// The week's muscle volume as the current app draws it: a front and back body map and one bar per
// muscle, both coloured by the same rule (shared `muscleVolumeColor`) so the map cannot disagree
// with the bars. Used by Health Training's Muscle Volume card and by Week in review (#2935).
export function MuscleVolumeFigure({
  muscles,
}: {
  muscles: readonly { muscle: string; sets: number; target: number | null }[];
}) {
  const { theme } = useTheme();
  // One row open at a time, as on the web card; the trend is fetched on the first open.
  const [expanded, setExpanded] = useState<string | null>(null);
  const trend = useWorkoutResource(muscleTonnageTrendSpec, expanded !== null);
  const palette = {
    good: theme.anatomy.main,
    warn: theme.anatomy.secondary,
    bad: theme.anatomy.injured,
    none: theme.colors.muted,
    brand: theme.anatomy.high,
  };
  const hasTargets = muscles.some((row) => row.target !== null);
  const scale = Math.max(...muscles.map((row) => Math.max(row.sets, row.target ?? 0)), MAX_TARGET);
  const rows = muscles.map((row) => ({
    ...row,
    color: muscleVolumeColor(row.sets, row.target, null, palette),
  }));
  // MuscleMap compares its assignments by content, so a fresh array does not repaint the figure.
  const assignments = rows
    .filter((row) => row.sets > 0)
    .map((row) => ({ muscle: row.muscle, color: row.color }));
  const legend = muscleLegendItems(hasTargets, {
    bad: palette.bad,
    warn: palette.warn,
    good: palette.good,
    untrained: theme.anatomy.untrained,
  });
  return (
    <>
      {/* The "colours match the bars" note is a caption of its own, not another legend item. */}
      {legend.some((item) => item.shape === 'text') && (
        <AppText variant="micro" tone="muted" style={{ textAlign: 'center' }}>
          {legend.find((item) => item.shape === 'text')?.label}
        </AppText>
      )}
      <Legend centered items={legend.filter((item) => item.shape !== 'text')} />
      <MuscleMap assignments={assignments} />
      {/* weekly-muscle-sets-card.tsx: space-y-2 rows, each a text-xs label, mb-0.5, then an h-2 bar. */}
      <Stack gap="sm">
        {rows.map((row) => (
          <TouchSurface
            key={row.muscle}
            accessibilityRole="button"
            accessibilityState={{ expanded: expanded === row.muscle }}
            accessibilityLabel={`${capitalize(row.muscle)}, ${muscleSetsLabel(row.sets, row.target)}`}
            onPress={() => setExpanded(expanded === row.muscle ? null : row.muscle)}
          >
          <Stack gap="xxs" style={{ minHeight: theme.sizes.touchTarget }}>
            <Stack direction="row" justify="space-between" align="center">
              <AppText variant="calendarDay" style={{ flex: 1 }}>
                {capitalize(row.muscle)}
              </AppText>
              <AppText
                variant="caption"
                style={{ color: row.color, fontWeight: '600', fontVariant: ['tabular-nums'] }}
              >
                {muscleSetsLabel(row.sets, row.target)}
              </AppText>
            </Stack>
            <ProgressBar
              value={row.sets / scale}
              color={row.color}
              target={(row.target ?? GENERIC_TARGET) / scale}
            />
            {expanded === row.muscle && (
              <Stack direction="row" align="center" gap="sm">
                {muscleTonnageValues(trend.data, row.muscle) ? (
                  <>
                    <View style={{ width: theme.sizes.weightSparkline }}>
                      <LineChart
                        label={`${capitalize(row.muscle)} tonnage`}
                        height={theme.sizes.trendSparkline}
                        showLabels={false}
                        stretch
                        dots="none"
                        color={row.color}
                        points={muscleTonnageValues(trend.data, row.muscle)!.map((value, index) => ({
                          label: String(index + 1),
                          value,
                        }))}
                      />
                    </View>
                    <AppText variant="micro" tone="muted">
                      {TONNAGE_TREND_CAPTION}
                    </AppText>
                  </>
                ) : (
                  <AppText variant="micro" tone="muted">
                    {trend.data ? 'Not enough weeks yet' : 'Loading trend…'}
                  </AppText>
                )}
              </Stack>
            )}
          </Stack>
          </TouchSurface>
        ))}
      </Stack>
      <AppText variant="micro" tone="muted">
        {hasTargets
          ? TARGET_BARS_CAPTION
          : GENERIC_BARS_CAPTION}
      </AppText>
    </>
  );
}
