import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { ChartGuides, YAxisLabels, yAxisColumnWidth } from './ChartGuides';
import {
  drawableTarget,
  guideSummary,
  includeTarget,
  meetBox,
  niceTicks,
  tickLabels,
  type ChartTarget,
} from './chartScale';
import { useTheme } from '../theme/ThemeProvider';
// Opt-in readability props (all off by default, so existing screens do not change):
//   allLabels  a label under every group (e.g. weekdays) instead of only the first and last
//   readable   12 px full-contrast labels (the default label is already 12 px, but muted)
//   gridlines  faint horizontal lines at round values
//   yAxis      value labels in a column left of the plot (implies gridlines)
//   target     { value, label } dashed goal line; the scale grows to include it
// Weekday labels: pass `labels` as weekdays, e.g. formatDateDisplay(date, 'weekday'), with allLabels.
export function GroupedBarChart({
  labels,
  series,
  allLabels = false,
  readable = false,
  gridlines = false,
  yAxis = false,
  target: targetProp,
}: {
  allLabels?: boolean;
  readable?: boolean;
  gridlines?: boolean;
  yAxis?: boolean;
  target?: ChartTarget;
  labels: string[];
  series: { label: string; values: number[]; color: string }[];
}) {
  const { theme } = useTheme();
  const [boxWidth, setBoxWidth] = useState(1);
  const target = drawableTarget(targetProp);
  const values = series.flatMap((s) => s.values),
    [min, max] = includeTarget(Math.min(0, ...values), Math.max(0, ...values), target);
  const guides = gridlines || yAxis || target !== undefined;
  const ticks = gridlines || yAxis ? niceTicks(min, max) : [];
  const tickTexts = tickLabels(ticks);
  const leftInset = yAxis ? yAxisColumnWidth(tickTexts) : 0;
  const box = meetBox(Math.max(1, boxWidth - leftInset), theme.sizes.weekVolumeChart, 320, 108);
  const toY = (v: number) => box.offsetY + box.scale * y(v);
  const y = (value: number) => 100 - ((value - min) / (max - min || 1)) * 92;
  const slot = 320 / labels.length,
    width = slot / (series.length + 1);
  const labelTone = readable ? 'text' : 'muted';
  const svg = (
    <Svg width="100%" height={theme.sizes.weekVolumeChart} viewBox="0 0 320 108">
      <Line x1="0" x2="320" y1={y(0)} y2={y(0)} stroke={theme.colors.border} />
      {series.flatMap((s, si) =>
        s.values.map((value, i) => (
          <Rect
            key={`${si}:${i}`}
            x={i * slot + width * (si + 0.5)}
            y={Math.min(y(value), y(0))}
            width={width * 0.85}
            height={Math.max(1, Math.abs(y(value) - y(0)))}
            fill={s.color}
          />
        )),
      )}
    </Svg>
  );
  return (
    <Stack>
      <View
        onLayout={(event) => setBoxWidth(event.nativeEvent.layout.width)}
        accessibilityLabel={
          series
            .map((s) => `${s.label}: ${labels.map((l, i) => `${l} ${s.values[i]}`).join(', ')}`)
            .join('; ') + (guides ? guideSummary(min, max, target) : '')
        }
      >
        {guides ? (
          <View style={{ flexDirection: 'row' }}>
            {yAxis && (
              <YAxisLabels
                height={theme.sizes.weekVolumeChart}
                items={ticks.map((t, i) => ({ y: toY(t), text: tickTexts[i] }))}
              />
            )}
            <View style={{ flex: 1, height: theme.sizes.weekVolumeChart }}>
              {svg}
              {boxWidth > 1 && (
                <ChartGuides
                  height={theme.sizes.weekVolumeChart}
                  gridYs={gridlines || yAxis ? ticks.map(toY) : []}
                  target={target ? { y: toY(target.value), label: target.label } : undefined}
                />
              )}
            </View>
          </View>
        ) : (
          svg
        )}
      </View>
      {allLabels ? (
        <Stack
          direction="row"
          gap="none"
          style={leftInset ? { paddingLeft: leftInset } : undefined}
        >
          {labels.map((l, i) => (
            <AppText
              key={i}
              variant="caption"
              tone={labelTone}
              numberOfLines={1}
              style={{ flex: 1, textAlign: 'center' }}
            >
              {l}
            </AppText>
          ))}
        </Stack>
      ) : (
        <Stack
          direction="row"
          justify="space-between"
          style={leftInset ? { paddingLeft: leftInset } : undefined}
        >
          {[labels[0], labels.at(-1)].map((l, i) => (
            <AppText key={i} variant="caption" tone={labelTone}>
              {l}
            </AppText>
          ))}
        </Stack>
      )}
      {series.map((s) => (
        <AppText key={s.label} variant="caption" style={{ color: s.color }}>
          {s.label}
        </AppText>
      ))}
    </Stack>
  );
}
