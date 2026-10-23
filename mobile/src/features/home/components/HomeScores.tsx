import { ScoreChip, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { readinessSpec } from '../../health/data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import type { HealthDetail } from '../../health/screens/HealthDetailScreen';
import { useHome } from '../data/HomeProvider';
import { homeScoreChips } from '../data/score-chips';
import { useTodayWidgetSnapshot } from '../../widgets/useTodayWidgetSnapshot';
export function HomeScores({ onOpen }: { onOpen: (detail: HealthDetail) => void }) {
  const { theme } = useTheme();
  const health = useHealthData();
  const home = useHome();
  const { data } = useWorkoutResource(readinessSpec(health.today));
  const [readiness, heart, sleep, activity] = homeScoreChips(data, health.sleep, health.today);
  useTodayWidgetSnapshot(health.today, data == null ? null : [readiness, heart, sleep, activity]);
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
      <ScoreChip
        label={readiness.label}
        first
        value={readiness.value}
        icon="power"
        tone="recovery"
        color={theme.scores.readiness}
        qualified={readiness.qualified}
        style={home.preferences.scoreRingStyle}
        onPress={() => onOpen('readiness')}
      />
      <ScoreChip
        label={heart.label}
        value={heart.value}
        icon="cardio"
        tone="heart"
        color={theme.scores.heart}
        style={home.preferences.scoreRingStyle}
        onPress={() => onOpen('heart-rate')}
      />
      <ScoreChip
        label={sleep.label}
        value={sleep.value}
        display={sleep.display}
        icon="moon"
        tone="sleep"
        color={theme.scores.sleep}
        style={home.preferences.scoreRingStyle}
        qualified={sleep.qualified}
        onPress={() => onOpen('sleep')}
      />
      <ScoreChip
        label={activity.label}
        value={activity.value}
        icon="flame"
        tone="activity"
        color={theme.scores.activity}
        style={home.preferences.scoreRingStyle}
        onPress={() => onOpen('activity')}
      />
    </Stack>
  );
}
