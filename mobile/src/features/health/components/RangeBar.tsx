import { View } from 'react-native';
import {
  rangePositions,
  rangeZones,
  type RangeOptimal,
  type RangeZoneBand,
} from '@trainingai/shared/health/range-stats';
import { AppText, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { Cue } from '../data/body-view';

/** Theme colour for a good / watch / bad cue. One mapping so every Body card agrees. */
export function useCueColor() {
  const { theme } = useTheme();
  return (cue: Cue) =>
    cue === 'good'
      ? theme.anatomy.main
      : cue === 'watch'
        ? theme.anatomy.secondary
        : theme.anatomy.injured;
}

const bandCue: Record<RangeZoneBand, Cue> = { bad: 'bad', warn: 'watch', good: 'good' };

/**
 * Where one reading sits against the recent range (min to max) with the average marked. The
 * coloured zones show which end is healthy. Native counterpart of the current app's `MetricScale`;
 * the positions and zone widths come from the shared `range-stats` module.
 */
export function RangeBar({
  label,
  value,
  min,
  max,
  avg,
  format = (v) => `${Math.round(v)}`,
  accent,
  optimal,
}: {
  label: string;
  value: number | null;
  min: number | null;
  max: number | null;
  avg?: number | null;
  format?: (v: number) => string;
  accent: string;
  optimal?: RangeOptimal;
}) {
  const { theme } = useTheme();
  const cueColor = useCueColor();
  const placed = rangePositions(value, min, max, avg);
  if (!placed || value === null || min === null || max === null) return null;
  const track = theme.spacing.sm;
  const marker = theme.spacing.lg;
  return (
    <View
      accessible
      accessibilityLabel={`${label} ${format(value)}, recent range ${format(min)} to ${format(max)}${
        avg != null ? `, average ${format(avg)}` : ''
      }`}
      style={{ gap: theme.spacing.xs }}
    >
      <Stack direction="row" justify="space-between" align="baseline">
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
        <AppText variant="label" style={{ color: accent, fontVariant: ['tabular-nums'] }}>
          {format(value)}
        </AppText>
      </Stack>
      <View style={{ height: marker, justifyContent: 'center' }}>
        <View
          style={{
            height: track,
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.raised,
            overflow: 'hidden',
            flexDirection: 'row',
          }}
        >
          {optimal &&
            rangeZones(optimal).map((zone, index) => (
              <View
                key={index}
                style={{
                  width: `${zone.widthPct}%`,
                  backgroundColor: cueColor(bandCue[zone.band]),
                  opacity: 0.35,
                }}
              />
            ))}
        </View>
        {placed.avgPos !== null && (
          <View
            style={{
              position: 'absolute',
              left: `${placed.avgPos}%`,
              width: 1,
              height: marker - theme.spacing.xs,
              backgroundColor: theme.colors.muted,
            }}
          />
        )}
        <View
          style={{
            position: 'absolute',
            left: `${placed.pos}%`,
            marginLeft: -marker / 2,
            width: marker,
            height: marker,
            borderRadius: theme.radii.pill,
            backgroundColor: accent,
            borderWidth: 2,
            borderColor: theme.colors.background,
          }}
        />
      </View>
      <Stack direction="row" justify="space-between">
        <AppText variant="micro" tone="muted">
          {format(min)}
        </AppText>
        {avg != null && (
          <AppText variant="micro" tone="muted">
            avg {format(avg)}
          </AppText>
        )}
        <AppText variant="micro" tone="muted">
          {format(max)}
        </AppText>
      </Stack>
    </View>
  );
}
