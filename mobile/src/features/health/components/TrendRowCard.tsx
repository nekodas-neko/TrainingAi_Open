import { useState } from 'react';
import { View } from 'react-native';
import { deltaSentence, type TrendRow } from '@trainingai/shared/nutrition/day-trends';
import { AppText, Card, LineChart, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';

const ARROW = { up: '↑', down: '↓', level: '→' } as const;

/**
 * One compact comparison row: the stat's name, today's (or this week's) value in its own colour, a
 * 110 x 30 sparkline at the right and the change underneath. day-trends-section.tsx's
 * `TrendRowCard`, used by the day review and by Week in review.
 */
export function TrendRowCard({
  row,
  timeDomain,
  comparison,
  absentLabel,
}: {
  row: TrendRow;
  timeDomain: readonly [number, number];
  comparison?: string;
  absentLabel: string;
}) {
  const { theme } = useTheme();
  const { spec, today, delta, series } = row;
  // The web's dots are 2.5 px (4 px on the newest); the chart draws in a 320-unit box scaled to its width.
  const [width, setWidth] = useState(0);
  const dotRadius = (2.5 * 320) / (width || theme.sizes.weightSparkline);
  return (
    <Card style={{ padding: theme.spacing.md, gap: theme.spacing.xs }}>
      <Stack direction="row" justify="space-between" align="center">
        <Stack gap="xxs" style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="caption" tone="muted">
            {spec.label}
          </AppText>
          {today == null ? (
            <AppText variant="caption" tone="muted">
              {absentLabel}
            </AppText>
          ) : (
            <AppText variant="subheading" style={{ color: spec.color }}>
              {spec.format(today)}
            </AppText>
          )}
        </Stack>
        {series && (
          <View
            style={{ width: theme.sizes.weightSparkline }}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          >
            {/* Only the periods with a reading are drawn, joined, at their own position in the window. */}
            <LineChart
              label={spec.label + ' over the window'}
              height={theme.sizes.trendSparkline}
              showLabels={false}
              color={spec.color}
              xDomain={timeDomain}
              dots="all"
              dotRadius={dotRadius}
              gaps="connect"
              points={series.times.map((time, i) => ({
                label: String(time),
                x: time,
                value: series.values[i],
              }))}
            />
          </View>
        )}
      </Stack>
      {delta && (
        <AppText variant="weekTileDelta" tone="muted">
          {ARROW[delta.direction]} {deltaSentence(spec, delta, comparison)}
        </AppText>
      )}
    </Card>
  );
}
