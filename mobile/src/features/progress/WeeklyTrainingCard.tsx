import type { z } from 'zod';
import type { ReactNode } from 'react';
import { todayInTz } from '@trainingai/shared/date-utils';
import { shortSessionName } from '@trainingai/shared/session-palette';
import { AppText, BarChart, Card, Legend, Stack } from '../../shared/ui';
import { useTheme } from '../../shared/theme/ThemeProvider';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import { useSessionColors } from '../workouts/useSessionColors';
import { weeklySpec } from '../workouts/data/models';

export function WeeklyTrainingCard({
  data,
  status,
  readable = false,
}: {
  data: z.infer<typeof weeklySpec.schema>;
  status?: ReactNode;
  // Larger bar labels and a value axis (Health Training).
  readable?: boolean;
}) {
  const { theme } = useTheme();
  const { timezone } = useWorkoutContext();
  const { sessions, color } = useSessionColors();
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
      <Stack direction="row" align="center" justify="space-between">
        <AppText variant="eyebrow" tone="muted" style={{ flex: 1 }}>
          Training Load
        </AppText>
        {status}
      </Stack>
      <BarChart
        label="This week's training load"
        readable={readable}
        yAxis={readable}
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
        <Legend
          items={sessions.map((session) => ({
            label: shortSessionName(session.name),
            color: color(session.name),
          }))}
        />
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
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {stat.unit}
            </AppText>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}
