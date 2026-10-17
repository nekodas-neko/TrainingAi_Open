import Svg, { Rect } from 'react-native-svg';
import { View } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { ChartGuides, YAxisLabels } from './ChartGuides';
import {
  drawableTarget,
  guideSummary,
  includeTarget,
  niceTicks,
  tickLabels,
  yPixel,
  type ChartTarget,
} from './chartScale';
import { useTheme } from '../theme/ThemeProvider';
// Opt-in readability props (all off by default, so existing screens do not change):
//   readable   12 px full-contrast bar labels instead of 10 px muted ones
//   gridlines  faint horizontal lines at round totals
//   yAxis      value labels in a column left of the bars (implies gridlines)
//   target     { value, label } dashed goal line on the stack total; the scale grows to include it
// Any of gridlines / yAxis / target also draws the stacks on one exact linear scale.
// Weekday labels: set each bar's `label`, e.g. formatDateDisplay(date, 'weekday').
export function StackedBarChart({
  label,
  unit,
  bars,
  readable = false,
  gridlines = false,
  yAxis = false,
  target: targetProp,
}: {
  readable?: boolean;
  gridlines?: boolean;
  yAxis?: boolean;
  target?: ChartTarget;
  label: string;
  unit: string;
  bars: readonly {
    label: string;
    segments: readonly { label: string; value: number; color: string }[];
  }[];
}) {
  const { theme } = useTheme();
  const maximum = Math.max(
    1,
    ...bars.map((bar) => bar.segments.reduce((sum, part) => sum + part.value, 0)),
  );
  const target = drawableTarget(targetProp);
  const guides = gridlines || yAxis || target !== undefined;
  const plotHeight = theme.sizes.chartHeight;
  const top = guides ? includeTarget(0, maximum, target)[1] : maximum;
  const ticks = gridlines || yAxis ? niceTicks(0, top) : [];
  const tickTexts = tickLabels(ticks);
  const toY = (v: number) => yPixel(v, 0, top, plotHeight);
  const row = (
    <Stack
      direction="row"
      gap="xxs"
      align="flex-start"
      accessibilityLabel={guides ? label + guideSummary(0, top, target) : label}
      style={guides ? { flex: 1 } : undefined}
    >
      {bars.map((bar) => {
        let y = guides ? plotHeight : 90;
        return (
          <View
            key={bar.label}
            accessibilityLabel={`${bar.label}: ${bar.segments.length ? bar.segments.map((part) => `${part.label} ${part.value.toFixed(1)} ${unit}`).join('; ') : 'not recorded'}`}
            style={{ flex: 1, minWidth: 0 }}
          >
            <Svg
              viewBox={guides ? `0 0 20 ${plotHeight}` : '0 0 20 96'}
              width="100%"
              height={plotHeight}
              preserveAspectRatio={guides ? 'none' : undefined}
            >
              {bar.segments.map((part) => {
                const height = guides
                  ? (part.value / top) * plotHeight
                  : (part.value / maximum) * 84;
                y -= height;
                return (
                  <Rect key={part.label} x={2} y={y} width={16} height={height} fill={part.color} />
                );
              })}
            </Svg>
            <AppText
              variant={readable ? 'caption' : 'micro'}
              tone={readable ? 'text' : 'muted'}
              numberOfLines={1}
              style={{ textAlign: 'center' }}
            >
              {bar.label}
            </AppText>
          </View>
        );
      })}
    </Stack>
  );
  if (!guides) return row;
  return (
    <View style={{ flexDirection: 'row' }}>
      {yAxis && (
        <YAxisLabels
          height={plotHeight}
          items={ticks.map((t, i) => ({ y: toY(t), text: tickTexts[i] }))}
        />
      )}
      <View style={{ flex: 1 }}>
        {row}
        <ChartGuides
          height={plotHeight}
          gridYs={gridlines || yAxis ? ticks.map(toY) : []}
          target={target ? { y: toY(target.value), label: target.label } : undefined}
        />
      </View>
    </View>
  );
}
