import { View } from 'react-native';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { Grid, MetricTile, type IconName } from '../../../shared/ui';

function volume(kg: number | undefined) {
  if (kg == null) return '—';
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(1)} kt`;
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${Math.round(kg).toLocaleString()} kg`;
}

export function ProfileStats({
  lifetime,
  program,
}: {
  lifetime?: {
    sessions: number;
    totalSets: number;
    totalVolumeKg: number;
    bestStreak: number;
    totalDistanceKm: number;
  };
  program?: {
    mode: 'cycle' | 'tenure' | null;
    weeksRunning?: number;
    cycleCurrent?: number;
    cycleTotal?: number;
    phaseName?: string | null;
    blockComplete?: boolean;
  } | null;
}) {
  const { theme } = useTheme();
  const distance = lifetime?.totalDistanceKm;
  const items: { label: string; value: string; icon: IconName; color: string }[] = [
    {
      label: 'Sessions',
      value: lifetime?.sessions.toLocaleString() ?? '—',
      icon: 'workout',
      color: theme.colors.brandText,
    },
    {
      label: 'Sets',
      value: lifetime?.totalSets.toLocaleString() ?? '—',
      icon: 'sets',
      color: theme.tones.activity.foreground,
    },
    {
      label: 'Volume',
      value: volume(lifetime?.totalVolumeKg),
      icon: 'weight',
      color: theme.scores.activity,
    },
    {
      label: 'Best streak',
      value: lifetime?.bestStreak.toLocaleString() ?? '—',
      icon: 'flame',
      color: theme.tones.checkin.foreground,
    },
    {
      label: 'Distance',
      value:
        distance == null || distance <= 0
          ? '—'
          : `${distance >= 100 ? Math.round(distance).toLocaleString() : distance.toFixed(1)} km`,
      icon: 'pin',
      color: theme.tones.recovery.foreground,
    },
    {
      label:
        program?.mode === 'cycle'
          ? program.blockComplete
            ? 'New block?'
            : (program.phaseName ?? 'Cycle')
          : 'Weeks running',
      value:
        program?.mode === 'cycle'
          ? `${program.cycleCurrent ?? '—'}/${program.cycleTotal ?? '—'}`
          : (program?.weeksRunning?.toLocaleString() ?? '—'),
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
