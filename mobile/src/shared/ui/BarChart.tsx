import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { ChartGuides, YAxisLabels } from './ChartGuides';
import {
  drawableTarget,
  guideSummary,
  includeTarget,
  coverTicks,
  niceTicks,
  tickLabels,
  yPixel,
  type ChartTarget,
} from './chartScale';
import { useTheme } from '../theme/ThemeProvider';

// Opt-in readability props (all off by default, so existing screens do not change):
//   readable   12 px full-contrast bar labels instead of 10 px muted ones
//   gridlines  faint horizontal lines at round values
//   yAxis      value labels in a column left of the bars (implies gridlines)
//   target     { value, label } dashed goal line; the bar scale grows to include it
// Any of gridlines / yAxis / target also switches the bars to one exact linear scale (bar height
// is value / top of scale * `height`, default 64) so the lines sit true against the bars.
// Weekday labels: set each bar's `label`, e.g. formatDateDisplay(date, 'weekday').
export function BarChart({
  label,
  bars,
  height,
  unit = 'kg',
  readable = false,
  gridlines = false,
  yAxis = false,
  target: targetProp,
  tickCount,
  formatTick,
}: {
  label: string;
  height?: number;
  unit?: string;
  readable?: boolean;
  gridlines?: boolean;
  yAxis?: boolean;
  target?: ChartTarget;
  /**
   * About how many gridlines / y labels to aim for. A chart that passes it (the web's
   * `maxTicksLimit`) also gets its axis rounded up to the next label, as chart.js does; one that
   * does not keeps about three labels and the top at its tallest bar.
   */
  tickCount?: number;
  /** Writes a y label; the default is `tickLabels`' full numbers. */
  formatTick?: (value: number) => string;
  bars: readonly {
    label: string;
    /** What a screen reader says for this bar when the visible label is not enough ("M" → "Monday"). */
    accessibleLabel?: string;
    value: number;
    colors: string[];
    reduced?: boolean;
    annotation?: string;
    selected?: boolean;
  }[];
}) {
  const { theme } = useTheme();
  const id = useId().replace(/:/g, '');
  const target = drawableTarget(targetProp);
  const guides = gridlines || yAxis || target !== undefined;
  const plotHeight = height ?? 64;
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  const wanted = guides ? includeTarget(0, max, target)[1] : max;
  const ticks = gridlines || yAxis ? tickCount === undefined
      ? niceTicks(0, wanted)
      : coverTicks(niceTicks(0, wanted, tickCount), wanted) : [];
  const top = ticks.length ? Math.max(wanted, ticks[ticks.length - 1]) : wanted;
  const tickTexts = formatTick ? ticks.map(formatTick) : tickLabels(ticks);
  const toY = (v: number) => yPixel(v, 0, top, plotHeight);
  const row = (
    <Stack
      direction="row"
      gap="xs"
      align="flex-start"
      accessibilityLabel={guides ? label + guideSummary(0, top, target) : label}
      style={guides ? { flex: 1 } : undefined}
    >
      {bars.map((bar, index) => {
        const barHeight = guides
          ? bar.value > 0
            ? Math.max(theme.spacing.xs, (bar.value / top) * plotHeight)
            : 6
          : bar.value > 0
            ? Math.max(theme.spacing.md, (bar.value / max) * (height ?? 52))
            : 6;
        const drawn = guides ? plotHeight : 64;
        const colors = bar.colors.length ? bar.colors : [theme.colors.brand];
        return (
          <View
            key={index}
            style={{ flex: 1, minWidth: 0 }}
            accessibilityLabel={`${bar.accessibleLabel ?? bar.label}: ${Math.round(bar.value)} ${unit}${bar.annotation ? ', ' + bar.annotation : ''}`}
          >
            <Svg
              viewBox={`0 0 40 ${drawn}`}
              width="100%"
              height={height ?? 64}
              preserveAspectRatio={height || guides ? 'none' : 'xMidYMid meet'}
            >
              <Defs>
                <Pattern
                  id={`${id}-${index}`}
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <Rect width="3" height="6" fill={theme.colors.surface} />
                </Pattern>
              </Defs>
              {bar.value > 0 ? (
                colors.map((color, at) => (
                  <Rect
                    key={at}
                    x="0"
                    y={drawn - barHeight + (at * barHeight) / colors.length}
                    width="40"
                    height={barHeight / colors.length}
                    fill={color}
                  />
                ))
              ) : (
                <Rect x="0" y={drawn - 6} width="40" height="6" fill={theme.colors.border} />
              )}
              {bar.reduced && (
                <Rect
                  x="0"
                  y={drawn - barHeight}
                  width="40"
                  height={barHeight}
                  fill={`url(#${id}-${index})`}
                />
              )}
            </Svg>
            <AppText
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              variant={readable ? 'caption' : 'micro'}
              tone={bar.selected ? 'brand' : readable ? 'text' : 'muted'}
              style={{ textAlign: 'center' }}
            >
              {bar.label}
              {bar.annotation ? ` (${bar.annotation})` : ''}
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
