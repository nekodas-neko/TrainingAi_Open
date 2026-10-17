import { View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { ChartGuides, YAxisLabels, yAxisColumnWidth } from './ChartGuides';
import { niceTicks, tickLabels, yPixel } from './chartScale';
import { useTheme } from '../theme/ThemeProvider';

// One bar per reading for a series too long for BarChart's labelled columns (dozens of sessions).
// Bars fill the width evenly on a linear scale from zero; only the first and last label print.
export function SeriesBarChart({
  label,
  bars,
  height,
  color: accent,
}: {
  label: string;
  bars: readonly { label: string; value: number; description?: string }[];
  height?: number;
  color?: string;
}) {
  const { theme } = useTheme();
  const plotHeight = height ?? theme.sizes.chartHeight;
  const color = accent ?? theme.colors.brand;
  const top = Math.max(1, ...bars.map((bar) => bar.value));
  const ticks = niceTicks(0, top);
  const tickTexts = tickLabels(ticks);
  const toY = (v: number) => yPixel(v, 0, top, plotHeight);
  // Ten units a bar, eight of them filled, so the gap scales with the bar however many there are.
  const slot = 10;
  return (
    <View
      accessibilityLabel={`${label}: ${bars.map((bar) => bar.description ?? `${bar.label}: ${bar.value}`).join('; ')}`}
    >
      <View style={{ flexDirection: 'row' }}>
        <YAxisLabels height={plotHeight} items={ticks.map((t, i) => ({ y: toY(t), text: tickTexts[i] }))} />
        <View style={{ flex: 1 }}>
          <Svg
            viewBox={`0 0 ${bars.length * slot} ${plotHeight}`}
            width="100%"
            height={plotHeight}
            preserveAspectRatio="none"
          >
            {bars.map((bar, index) => {
              const barHeight = bar.value > 0 ? Math.max(2, (bar.value / top) * plotHeight) : 0;
              return (
                <Rect
                  key={index}
                  x={index * slot + 1}
                  y={plotHeight - barHeight}
                  width={slot - 2}
                  height={barHeight}
                  fill={color}
                />
              );
            })}
          </Svg>
          <ChartGuides height={plotHeight} gridYs={ticks.map(toY)} />
        </View>
      </View>
      <Stack
        direction="row"
        justify="space-between"
        style={{ paddingLeft: yAxisColumnWidth(tickTexts) }}
      >
        {[bars[0], bars[bars.length - 1]].map((bar, index) => (
          <AppText key={index} variant="caption">
            {bar.label}
          </AppText>
        ))}
      </Stack>
    </View>
  );
}
