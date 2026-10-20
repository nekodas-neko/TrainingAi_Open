import type { ComponentProps, ReactNode } from 'react';
import { MetricCard, LineChart } from '../../../shared/ui';
import type { Tone } from '../../../shared/theme/theme';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { metricValue } from '../data/models';

// The chart options a card may switch on (the opt-in readability props, weekday labels, a goal
// line). Everything is off unless a card asks, so the other screens keep their charts unchanged.
export type CardChartOptions = Pick<
  ComponentProps<typeof LineChart>,
  'readable' | 'gridlines' | 'yAxis' | 'target' | 'axisLabels' | 'fill' | 'domain' | 'color' | 'dots' | 'gaps' | 'tickCount' | 'height' | 'smooth'
>;
export function HealthMetricCard({
  title,
  value,
  valueText,
  unit,
  decimals,
  tone = 'neutral',
  accent,
  caption,
  points,
  chart,
  onOpen,
  onLog,
  children,
  status,
  compactChart = false,
}: {
  title: string;
  value?: number | null;
  /** Pre-formatted value, for a figure with its own sign or wording. Wins over `value`. */
  valueText?: string;
  unit?: string;
  decimals?: number;
  tone?: Tone;
  accent?: string;
  caption?: string;
  points?: readonly { label: string; value: number | null; x?: number }[];
  chart?: CardChartOptions;
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
      value={valueText ?? (value === undefined ? undefined : metricValue(value, '', decimals))}
      unit={unit}
      tone={tone}
      accent={accent}
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
          {...chart}
        />
      )}
      {children}
    </MetricCard>
  );
}
