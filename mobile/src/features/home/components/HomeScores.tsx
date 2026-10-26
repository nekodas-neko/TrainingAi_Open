import { View } from 'react-native';
import { ScoreChip, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { readinessSpec } from '../../health/data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import type { HealthDetail } from '../../health/screens/HealthDetailScreen';
import { useHome } from '../data/HomeProvider';
import { chipFigure, homePillars } from '../data/score-chips';
/**
 * The three pillars beside Energy (#2989), in the user's ring style. Readiness no longer has a
 * chip: Energy opens at the readiness score and the hero is where it is read. A ScoreChip shrinks
 * itself to the width it is given, so Compact's narrower column needs no second layout.
 */
export function HomeScores({
  onOpen,
  grid = false,
}: {
  onOpen: (detail: HealthDetail) => void;
  /** Compact's right column (R4): two chips to a row, wrapping, instead of one row of three. */
  grid?: boolean;
}) {
  const { theme } = useTheme();
  const health = useHealthData();
  const home = useHome();
  const { data } = useWorkoutResource(readinessSpec(health.today));
  const [sleep, heart, activity] = homePillars(data, health.sleep, health.today);
  const style = home.preferences.scoreRingStyle;
  const pillars = [
    { chip: sleep, icon: 'moon', tone: 'sleep', color: theme.scores.sleep, detail: 'sleep' },
    { chip: heart, icon: 'cardio', tone: 'heart', color: theme.scores.heart, detail: 'heart-rate' },
    { chip: activity, icon: 'flame', tone: 'activity', color: theme.scores.activity, detail: 'activity' },
  ] as const;
  // `first` marks the chip with no hairline on its left: the first of a row, or of each grid row.
  const chips = pillars.map(({ chip, icon, tone, color, detail }, index) => (
    <ScoreChip
      key={chip.key}
      label={chip.label}
      shortLabel={chip.shortLabel}
      first={grid ? index % 2 === 0 : index === 0}
      value={chip.value}
      display={chip.display}
      unit={chipFigure(chip).unit}
      icon={icon}
      tone={tone}
      color={color}
      style={style}
      qualified={chip.qualified}
      diameter={grid ? theme.sizes.scoreChipCompact : undefined}
      onPress={() => onOpen(detail)}
    />
  ));
  if (grid) {
    // The fourth cell stays empty until a fourth score exists.
    const rows = [chips.slice(0, 2), chips.slice(2)];
    return (
      <Stack gap="xs">
        {rows.map((row, index) => (
          <Stack key={index} direction="row" gap="xs">
            {row}
            {row.length < 2 && <View style={{ flex: 1 }} />}
          </Stack>
        ))}
      </Stack>
    );
  }
  return (
    <Stack
      direction="row"
      gap={['rail', 'duorail'].includes(home.preferences.scoreRingStyle ?? '') ? 'none' : 'xs'}
      style={
        ['rail', 'duorail'].includes(home.preferences.scoreRingStyle ?? '')
          ? {
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.card,
              backgroundColor: theme.colors.raised,
              overflow: 'hidden',
            }
          : undefined
      }
    >
      {chips}
    </Stack>
  );
}
