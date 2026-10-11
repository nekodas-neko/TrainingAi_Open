import type { z } from 'zod';
import { todayInTz } from '@trainingai/shared/date-utils';
import { AppText, Badge, BarChart, Card, Stack } from '../../shared/ui';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { weeklySpec } from '../workouts/data/models';

export function WeeklyTrainingCard({ data }: { data: z.infer<typeof weeklySpec.schema> }) {
  const { theme } = useTheme();
  const { timezone, catalog } = useWorkoutContext();
  const sessions = catalog?.program?.sessions ?? [];
  function color(name: string) {
    const position =
      sessions.find((session) => session.name.toLowerCase() === name.toLowerCase())?.position ??
      [...name].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
    return theme.sessions[position % theme.sessions.length].foreground;
  }
  const today = todayInTz(timezone).replace(/-/g, '/');
  const stats = [
    { label: 'Sessions', value: String(data.totalSessions), unit: 'this week' },
    { label: 'Sets', value: String(data.totalSets), unit: 'logged' },
    {
      label: 'Volume',
      value: data.totalVolumeKg > 0 ? Math.round(data.totalVolumeKg).toLocaleString() : '—',
      unit: 'kg lifted',
    },
    {
      label: 'Avg Duration',
      value: data.avgDurationMin === null ? '—' : String(Math.round(data.avgDurationMin)),
      unit: 'min per session',
    },
  ];
  return (
    <Card>
      <AppText variant="eyebrow" tone="muted">
        Training Load
      </AppText>
      <BarChart
        label="This week's training load"
        bars={data.days.map((day) => ({
          label: day.label,
          value: day.volume > 0 ? day.volume : day.deloadVolume,
          colors: day.sessions.map(color),
          reduced: day.volume === 0 && day.deloadVolume > 0,
          annotation: [day.isDeload ? 'D' : '', day.isTesting ? 'T' : ''].filter(Boolean).join('·'),
          selected: day.dateKey.replace(/-/g, '/') === today,
        }))}
      />
      {!!sessions.length && (
        <Stack direction="row" wrap>
          {sessions.map((session) => (
            <Badge
              key={session.id}
              label={session.name}
              style={{ borderColor: color(session.name) }}
            />
          ))}
        </Stack>
      )}
      <Stack
        direction="row"
        gap="sm"
        style={{
          paddingTop: theme.spacing.md,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        }}
      >
        {stats.map((stat) => (
          <Stack key={stat.label} gap="xxs" align="center" style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="heading" tone="brand">
              {stat.value}
            </AppText>
            <AppText variant="micro" tone="muted" style={{ textAlign: 'center' }}>
              {stat.label}
            </AppText>
            <AppText variant="micro" tone="muted" style={{ textAlign: 'center' }}>
              {stat.unit}
            </AppText>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}
