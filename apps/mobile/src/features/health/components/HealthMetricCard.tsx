import type { ReactNode } from 'react';
import { MetricCard, LineChart } from '../../../shared/ui';
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
    <MetricCard
      label={title}
      value={value === undefined ? undefined : metricValue(value, '', decimals)}
      unit={unit}
      tone={tone}
      caption={caption}
      onOpen={onOpen}
      onLog={onLog}
      status={status}
    >
      {points && (
        <LineChart
          points={points}
          label={title}
          tone={tone}
          height={compactChart ? theme.sizes.miniChart : undefined}
          showLabels={!compactChart}
        />
      )}
      {children}
    </MetricCard>
  );
}
