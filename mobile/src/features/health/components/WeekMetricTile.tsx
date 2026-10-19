import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { AppText, Card, LineChart } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';

/**
 * One Recovery tile of Week in review: label, value, delta, and a sparkline with a dot on every
 * day. The current app's week-metric-card.tsx is p-3, with the sparkline h-10 under a mt-2; the
 * shared metric card's 48 px header and value rows made these tiles about twice as tall.
 */
export function WeekMetricTile({
  label,
  valueText,
  unit,
  delta,
  deltaColor,
  note,
  days,
}: {
  label: string;
  valueText: string;
  unit?: string;
  delta: string;
  deltaColor?: string;
  note?: string;
  days: readonly { date: string; value: number | null }[];
}) {
  const { theme } = useTheme();
  // The web's dot is 2 CSS px; the chart draws in a 320-unit box scaled to the tile's width.
  const [width, setWidth] = useState(0);
  const dotRadius = width > 0 ? (2 * 320) / width : 2;
  const hasAny = days.some((d) => d.value !== null);
  const tail: ReactNode = hasAny && (
    <View
      style={{ marginTop: theme.spacing.sm }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <LineChart
        points={days.map((d) => ({ label: d.date, value: d.value }))}
        label={label}
        height={theme.sizes.weekTileChart}
        showLabels={false}
        color={theme.colors.brand}
        dots="all"
        dotRadius={dotRadius}
        gaps="connect"
      />
    </View>
  );
  return (
    <Card style={{ flex: 1, padding: theme.spacing.md, gap: 0 }}>
      <AppText variant="calendarDay" tone="muted">
        {label}
      </AppText>
      {note && (
        <AppText variant="tab" tone="muted">
          {note}
        </AppText>
      )}
      <AppText variant="weekTileValue" style={{ fontVariant: ['tabular-nums'] }}>
        {valueText}
        {valueText !== '—' && !!unit && (
          <AppText variant="caption" tone="muted">
            {/* ml-0.5: a hair of space, not a word space */}
            {'\u200a'}
            {unit}
          </AppText>
        )}
      </AppText>
      <AppText
        variant="weekTileDelta"
        tone={deltaColor ? undefined : 'muted'}
        style={[{ fontVariant: ['tabular-nums'] }, deltaColor ? { color: deltaColor } : null]}
      >
        {delta}
      </AppText>
      {tail}
    </Card>
  );
}
