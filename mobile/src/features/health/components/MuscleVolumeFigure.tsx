import { capitalize } from '@trainingai/shared/format/capitalize';
import {
  GENERIC_BARS_CAPTION,
  GENERIC_TARGET,
  MAX_TARGET,
  TARGET_BARS_CAPTION,
  muscleVolumeColor,
} from '@trainingai/shared/health/volume-band';
import { AppText, Legend, MuscleMap, ProgressBar, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { muscleLegendItems, muscleSetsLabel } from '../data/training-view';

// The week's muscle volume as the current app draws it: a front and back body map and one bar per
// muscle, both coloured by the same rule (shared `muscleVolumeColor`) so the map cannot disagree
// with the bars. Used by Health Training's Muscle Volume card and by Week in review (#2935).
export function MuscleVolumeFigure({
  muscles,
}: {
  muscles: readonly { muscle: string; sets: number; target: number | null }[];
}) {
  const { theme } = useTheme();
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
  return (
    <>
      <Legend
        centered
        items={muscleLegendItems(hasTargets, {
          bad: palette.bad,
          warn: palette.warn,
          good: palette.good,
          untrained: theme.anatomy.untrained,
        })}
      />
      <MuscleMap assignments={assignments} />
      {/* weekly-muscle-sets-card.tsx: space-y-2 rows, each a text-xs label, mb-0.5, then an h-2 bar. */}
      <Stack gap="sm">
        {rows.map((row) => (
          <Stack key={row.muscle} gap="xxs">
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
          </Stack>
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
