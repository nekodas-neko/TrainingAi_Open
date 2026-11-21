import { formatCount, formatLifetimeDistance, formatLifetimeVolume } from '@trainingai/shared/format/number';
import { View } from 'react-native';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { Grid, MetricTile, type IconName } from '../../../shared/ui';
import { programTile, type ProgramWeekSummary } from '../data/profile';

export function ProfileStats({
  lifetime,
  program,
  memberSince,
}: {
  lifetime?: {
    sessions: number;
    totalSets: number;
    totalVolumeKg: number;
    bestStreak: number;
    totalDistanceKm: number;
  };
  program?: ProgramWeekSummary;
  /** `memberSinceLabel(user.createdAt, tz)`; shown when there is no programme to count. */
  memberSince: string | null;
}) {
  const { theme } = useTheme();
  const distance = lifetime?.totalDistanceKm;
  const sixth = programTile(program, memberSince);
  const items: { label: string; value: string; icon: IconName; color: string }[] = [
    {
      label: 'Sessions',
      value: formatCount(lifetime?.sessions),
      icon: 'workout',
      color: theme.colors.brandText,
    },
    {
      label: 'Sets',
      value: formatCount(lifetime?.totalSets),
      icon: 'sets',
      color: theme.tones.activity.foreground,
    },
    {
      label: 'Volume',
      value: formatLifetimeVolume(lifetime?.totalVolumeKg),
      icon: 'weight',
      color: theme.scores.activity,
    },
    {
      label: 'Best streak',
      value: formatCount(lifetime?.bestStreak),
      icon: 'flame',
      color: theme.tones.checkin.foreground,
    },
    {
      label: 'Distance',
      value:
        formatLifetimeDistance(distance),
      icon: 'pin',
      color: theme.tones.recovery.foreground,
    },
    {
      ...sixth,
      icon: 'calendar',
      color: theme.colors.brandText,
    },
  ];
  return (
    <View style={{ width: '100%', maxWidth: theme.sizes.summaryWidth, alignSelf: 'center' }}>
      <Grid columns={3} gap="sm">
        {items.map((item) => (
          <MetricTile key={item.label} {...item} compact tone="neutral" />
        ))}
      </Grid>
    </View>
  );
}
