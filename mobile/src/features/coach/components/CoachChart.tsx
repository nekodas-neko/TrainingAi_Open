import { useEffect, useRef } from 'react';
import {
  AppText,
  Card,
  GroupedBarChart,
  LineChart,
  SegmentRing,
  Stack,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { ChartArgs, WidgetResult } from '../data/widgets';
export function ChartCard({
  args,
  onResult,
}: {
  args: ChartArgs;
  onResult?: (result: WidgetResult) => void;
}) {
  const { theme } = useTheme(),
    sent = useRef(false);
  useEffect(() => {
    if (onResult && !sent.current) {
      sent.current = true;
      onResult({ status: 'shown' });
    }
  }, [onResult]);
  const palette = [
    theme.colors.brand,
    theme.tones.sleep.foreground,
    theme.tones.activity.foreground,
    theme.tones.recovery.foreground,
  ];
  const color = (key: string | undefined, index: number) =>
    key === 'destructive'
      ? theme.colors.danger
      : key === 'purple'
        ? theme.tones.sleep.foreground
        : key === 'amber'
          ? theme.tones.activity.foreground
          : key === 'green'
            ? theme.tones.recovery.foreground
            : key === 'cyan'
              ? theme.colors.brand
              : palette[index % palette.length];
  const count = Math.min(args.labels.length, ...args.datasets.map((d) => d.data.length));
  const labels = args.labels.slice(0, count),
    series = args.datasets.map((d, i) => ({
      label: d.label,
      values: d.data.slice(0, count),
      color: color(d.colorKey, i),
    }));
  return (
    <Card>
      {args.title && <AppText variant="label">{args.title}</AppText>}
      {args.chartType === 'line' ? (
        <LineChart
          label={args.title ?? 'Coach chart'}
          points={series[0].values.map((value, i) => ({ label: labels[i], value }))}
          color={series[0].color}
          series={series.slice(1).map((s) => ({
            label: s.label,
            color: s.color,
            points: s.values.map((value, x) => ({ x, value })),
          }))}
        />
      ) : args.chartType === 'bar' ? (
        <GroupedBarChart labels={labels} series={series} />
      ) : (
        series.map((s) => {
          const total = s.values.reduce((sum, value) => sum + Math.max(0, value), 0);
          return (
            <Stack key={s.label} align="center">
              <SegmentRing
                label={s.label}
                value={1}
                segments={s.values.map((v, i) => ({
                  share: total ? Math.max(0, v) / total : 0,
                  color: palette[i % palette.length],
                }))}
              >
                <AppText variant="label">{s.label}</AppText>
              </SegmentRing>
              {labels.map((label, i) => (
                <AppText
                  key={i}
                  variant="caption"
                  style={{ color: palette[i % palette.length] }}
                >
                  {label}: {s.values[i]}
                </AppText>
              ))}
            </Stack>
          );
        })
      )}
      {args.chartType === 'line' &&
        series.map((s) => (
          <AppText key={s.label} variant="caption" style={{ color: s.color }}>
            {s.label}
          </AppText>
        ))}
    </Card>
  );
}
