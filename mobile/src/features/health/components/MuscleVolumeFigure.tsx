import { GENERIC_TARGET, muscleVolumeColor } from '@trainingai/shared/health/volume-band';
import { AppText, Legend, MuscleMap, ProgressBar, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { capitalize, muscleSetsLabel } from '../data/training-view';

const MAX_TARGET = 20;

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
    brand: theme.colors.brand,
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
      <AppText variant="caption" tone="muted" style={{ textAlign: 'right' }}>
        {hasTargets ? 'vs your program target' : `Target: ${GENERIC_TARGET}–${MAX_TARGET} sets`}
      </AppText>
      <MuscleMap assignments={assignments} />
      {rows.map((row) => (
        <Stack key={row.muscle} gap="xs">
          <Stack direction="row" justify="space-between" align="center">
            <AppText variant="label" style={{ flex: 1 }}>
              {capitalize(row.muscle)}
            </AppText>
            <AppText variant="caption" style={{ color: row.color, fontVariant: ['tabular-nums'] }}>
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
      <Legend
        items={
          hasTargets
            ? [
                { label: 'At or above target', color: palette.good },
                { label: '60% or more', color: palette.warn },
                { label: 'Under 60%', color: palette.bad },
              ]
            : [
                { label: '15+ sets', color: palette.brand },
                { label: '10–14 sets', color: palette.good },
                { label: '6–9 sets', color: palette.warn },
                { label: 'Under 6', color: palette.bad },
              ]
        }
      />
      <AppText variant="caption" tone="muted">
        {hasTargets
          ? 'Vertical line = your weekly target'
          : `Vertical line = ${GENERIC_TARGET}-set minimum`}
      </AppText>
    </>
  );
}
