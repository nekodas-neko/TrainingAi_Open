import type { ReactNode } from 'react';
import { Pressable } from 'react-native';
import { AppButton, AppText, Card, LineChart, Stack } from '../../../shared/ui';
import type { Tone } from '../../../shared/theme/theme';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { metricValue } from '../data/models';

export function HealthMetricCard({
  title,
  value,
  unit,
  decimals,
  tone = 'neutral',
  caption,
  points,
  onOpen,
  onLog,
  children,
  compact = false,
  status,
  compactChart = false,
}: {
  title: string;
  value?: number | null;
  unit?: string;
  decimals?: number;
  tone?: Tone;
  caption?: string;
  points?: readonly { label: string; value: number | null; x?: number }[];
  onOpen?: () => void;
  onLog?: () => void;
  children?: ReactNode;
  compact?: boolean;
  status?: ReactNode;
  compactChart?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Card tone={tone}>
      <Stack direction="row" align="center" justify="space-between">
        <Pressable
          disabled={!onOpen}
          onPress={onOpen}
          accessibilityRole={onOpen ? 'button' : undefined}
          accessibilityLabel={onOpen ? `View ${title} history` : undefined}
          style={{ flex: 1 }}
        >
          <AppText variant="eyebrow" style={{ color: theme.tones[tone].foreground }}>
            {title}
            {onOpen ? ' ↗' : ''}
          </AppText>
          {!compact && value !== undefined && (
            <AppText variant="title">{metricValue(value, unit, decimals)}</AppText>
          )}
        </Pressable>
        {onLog && <AppButton title="Log" variant="surface" onPress={onLog} />}
        {status}
      </Stack>
      {compact && value !== undefined && (
        <AppText variant="hero">{metricValue(value, '', decimals)}</AppText>
      )}
      {compact && unit && (
        <AppText variant="micro" tone="muted">
          {unit}
        </AppText>
      )}
      {points && (
        <LineChart
          points={points}
          label={title}
          tone={tone}
          height={compactChart ? theme.sizes.miniChart : undefined}
          showLabels={!compactChart}
        />
      )}
      {caption && (
        <AppText variant="micro" tone="muted">
          {caption}
        </AppText>
      )}
      {children}
    </Card>
  );
}
