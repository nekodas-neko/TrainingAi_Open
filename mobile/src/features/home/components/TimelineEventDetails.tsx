import { formatDateDisplay, formatTimeOfDay, toAestDay } from '@trainingai/shared/date-utils';
import { AppText, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { TimelineEvent } from '../data/timeline';
import type { SleepRow } from '../../health/data/models';
import { timelineMetrics } from '../data/timeline-presentation';

export function TimelineEventDetails({
  event,
  date,
  night,
  timezone,
}: {
  event: TimelineEvent;
  date: string;
  night?: SleepRow;
  timezone: string;
}) {
  const { theme } = useTheme();
  const source = event.subtitle || night?.sourceLabel;
  const rows = [
    {
      label: 'When',
      value: `${formatDateDisplay(date, 'short')} · ${formatTimeOfDay(event.timeMs, timezone)}`,
    },
    ...timelineMetrics(event),
    ...(night?.sleepStart
      ? [
          {
            label: 'Fell asleep',
            value: `${formatDateDisplay(toAestDay(new Date(night.sleepStart), timezone), 'short')} · ${formatTimeOfDay(night.sleepStart, timezone)}`,
          },
        ]
      : []),
    ...(night?.sleepEnd
      ? [
          {
            label: 'Woke up',
            value: `${formatDateDisplay(night.date, 'short')} · ${formatTimeOfDay(night.sleepEnd, timezone)}`,
          },
        ]
      : []),
    ...(event.endTime ? [{ label: 'Finished', value: event.endTime }] : []),
    ...(source
      ? [
          {
            label: event.subtitle === 'Saved on this phone' ? 'Storage' : 'Source',
            value: source,
          },
        ]
      : []),
  ];
  return (
    <Stack gap="none">
      {rows.map((row, index) => (
        <Stack
          key={row.label}
          direction="row"
          justify="space-between"
          gap="lg"
          style={{
            paddingVertical: theme.spacing.md,
            borderTopWidth: index ? 1 : 0,
            borderTopColor: theme.colors.border,
          }}
        >
          <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
            {row.label}
          </AppText>
          <AppText variant="label" style={{ flex: 2, textAlign: 'right' }}>
            {row.value}
          </AppText>
        </Stack>
      ))}
    </Stack>
  );
}
