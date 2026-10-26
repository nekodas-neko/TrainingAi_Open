import { View } from 'react-native';
import { ScoreChip, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { readinessSpec } from '../../health/data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import type { HealthDetail } from '../../health/screens/HealthDetailScreen';
import { useHome } from '../data/HomeProvider';
import { homeScoreChips } from '../data/score-chips';
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
  const [, heart, sleep, activity] = homeScoreChips(data, health.sleep, health.today);
  const chips = [
    <ScoreChip
      key="0"
      label={heart.label}
      shortLabel={heart.shortLabel}
      first
      value={heart.value}
      icon="cardio"
      tone="heart"
      color={theme.scores.heart}
      style={home.preferences.scoreRingStyle}
      onPress={() => onOpen('heart-rate')}
    />,
    <ScoreChip
      key="1"
      label={sleep.label}
      shortLabel={sleep.shortLabel}
      value={sleep.value}
      display={sleep.display}
      icon="moon"
      tone="sleep"
      color={theme.scores.sleep}
      style={home.preferences.scoreRingStyle}
      qualified={sleep.qualified}
      onPress={() => onOpen('sleep')}
    />,
    <ScoreChip
      key="2"
      label={activity.label}
      shortLabel={activity.shortLabel}
      value={activity.value}
      icon="flame"
      tone="activity"
      color={theme.scores.activity}
      style={home.preferences.scoreRingStyle}
      onPress={() => onOpen('activity')}
    />,
  ];
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
