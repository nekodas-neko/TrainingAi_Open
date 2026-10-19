import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Polygon, Polyline, Rect, Line } from 'react-native-svg';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { ChartGuides, YAxisLabels, yAxisColumnWidth } from './ChartGuides';
import {
  drawableTarget,
  guideSummary,
  includeTarget,
  dotMask,
  lastReadingIndex,
  lineSegments,
  isPointAlignedAxis,
  chartPadY,
  chartViewBoxHeight,
  type GapMode,
  meetBox,
  pointCentreX,
  niceTicks,
  tickLabels,
  type ChartTarget,
} from './chartScale';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/theme';

// Opt-in readability props (all off by default, so existing screens do not change):
//   readable   12 px full-contrast labels instead of 10 px muted ones
//   gridlines  faint horizontal lines at round values of the plotted range
//   yAxis      value labels in a column left of the plot (implies gridlines)
//   target     { value, label } dashed goal line; widens the range, also when `domain` is passed
// Weekday labels: pass `axisLabels` with one label per point and '' for the ones to skip; each
// non-blank label is centred under its own point. Any other length is spread across the row.
const AXIS_LABEL_WIDTH = 40;
export function LineChart({
  points,
  label,
  showLabels = true,
  fill = false,
  height,
  tone = 'brand',
  domain,
  xDomain,
  bands = [],
  series = [],
  markers = [],
  interactive = false,
  axisLabels,
  color: accent,
  fillColor,
  readable = false,
  gridlines = false,
  yAxis = false,
  target: targetProp,
  dots = 'all',
  tickCount,
  dotRadius = 3,
  gaps = 'break',
  compactAxisLabels = false,
}: {
  points: readonly { label: string; value: number | null; x?: number }[];
  label: string;
  showLabels?: boolean;
  fill?: boolean;
  height?: number;
  tone?: Tone;
  domain?: readonly [number, number];
  xDomain?: readonly [number, number];
  bands?: readonly { from: number; to: number; label: string; color: string }[];
  series?: readonly {
    label: string;
    color: string;
    points: readonly { x: number; value: number | null }[];
    domain?: readonly [number, number];
    dashed?: boolean;
  }[];
  markers?: readonly { x: number; label: string; color: string }[];
  interactive?: boolean;
  axisLabels?: readonly string[];
  color?: string;
  fillColor?: string;
  readable?: boolean;
  gridlines?: boolean;
  yAxis?: boolean;
  target?: ChartTarget;
  dots?: 'all' | 'isolated' | 'none';
  /** About how many gridlines / y labels to aim for; 3 unless a chart asks for more. */
  tickCount?: number;
  /** Radius of a reading's dot in viewBox units; the newest reading of a connected line is larger. */
  dotRadius?: number;
  /** 'break' (default) leaves a gap where a day has no reading; 'connect' draws the line across it. */
  gaps?: GapMode;
  compactAxisLabels?: boolean;
}) {
  const { theme } = useTheme();
  const [selection, setSelection] = useState<number | null>(null);
  const [width, setWidth] = useState(1);
  const labelVariant = readable ? 'caption' : 'micro';
  const labelTone = readable ? 'text' : 'muted';
  // Three-letter weekdays do not fit 14 columns at the readable size, so the x axis can drop to 10 px.
  const axisVariant = compactAxisLabels ? 'micro' : labelVariant;
  const plotHeight = height ?? theme.sizes.chartHeight;
  const target = drawableTarget(targetProp);
  const guides = gridlines || yAxis || target !== undefined;
  const valid = points.filter(
    (point): point is typeof point & { value: number } =>
      point.value !== null && Number.isFinite(point.value),
  );
  if (!valid.length) {
    return (
      <View
        style={{
          height:
            (height ?? theme.sizes.chartHeight) +
            (showLabels ? theme.typography[labelVariant].lineHeight! : 0) +
            (interactive ? theme.sizes.touchTarget : 0),
          justifyContent: 'center',
        }}
      >
        <AppText variant="caption" tone="muted">
          No recorded data yet
        </AppText>
      </View>
    );
  }
  const all = [
    ...valid.map((point) => point.value),
    ...series
      .filter((s) => !s.domain)
      .flatMap((s) => s.points.flatMap((p) => (p.value != null ? [p.value] : []))),
  ];
  const [min, max] = includeTarget(
    domain?.[0] ?? Math.min(...all),
    domain?.[1] ?? Math.max(...all),
    target,
  );
  const xs = points.map((point, index) => point.x ?? index);
  const xMin = xDomain?.[0] ?? Math.min(...xs);
  const xMax = xDomain?.[1] ?? Math.max(...xs);
  // The plot sits right of the y-axis column; overlays are absolute so the Svg and the touch
  // responder below keep their existing layout (locationX is relative to the root View).
  const ticksWanted = gridlines || yAxis;
  const ticks0 = ticksWanted ? niceTicks(min, max, tickCount) : [];
  const tickTexts = tickLabels(ticks0);
  const leftInset = yAxis ? yAxisColumnWidth(tickTexts) : 0;
  const plotWidth = Math.max(1, width - leftInset);
  // The viewBox is as tall as the box, so a taller chart fills it instead of being letterboxed.
  const vbHeight = chartViewBoxHeight(plotWidth, plotHeight);
  const padY = chartPadY(vbHeight);
  const xx = (x: number) => (xMin === xMax ? 160 : 12 + ((x - xMin) / (xMax - xMin)) * 296);
  const yy = (v: number, bounds: readonly [number, number] = [min, max]) =>
    bounds[0] === bounds[1]
      ? vbHeight / 2
      : vbHeight - padY - ((v - bounds[0]) / (bounds[1] - bounds[0])) * (vbHeight - 2 * padY);
  const coords = points.map((point, index) =>
    point.value === null || !Number.isFinite(point.value)
      ? null
      : { x: xx(xs[index]), y: yy(point.value) },
  );
  const segments = lineSegments(coords, gaps);
  const color = accent ?? theme.tones[tone].foreground;
  const readings = coords.map((point) => (point ? 1 : null));
  const showDot = dotMask(readings, dots);
  // A connected line has no gaps to explain, so its newest reading is the one dot made larger.
  const endIndex = gaps === 'connect' ? lastReadingIndex(readings) : -1;
  const ticks = ticks0;
  // Pixel y of a value on the main scale, matching how the Svg is fitted into its box.
  const box = meetBox(plotWidth, plotHeight, 320, vbHeight);
  const toY = (v: number) => box.offsetY + box.scale * yy(v);
  return (
    <View
      onStartShouldSetResponder={() => interactive}
      onResponderGrant={(event) => {
        const x =
          xMin +
          Math.max(
            0,
            Math.min(1, (((event.nativeEvent.locationX - leftInset) / plotWidth) * 320 - 12) / 296),
          ) *
            (xMax - xMin);
        setSelection(
          valid.reduce(
            (closest, p) =>
              Math.abs((p.x ?? points.indexOf(p)) - x) <
              Math.abs((closest.x ?? points.indexOf(closest)) - x)
                ? p
                : closest,
            valid[0],
          ).x ?? Math.round(x),
        );
      }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityLabel={`${label}: ${valid.map((point) => `${point.label}: ${point.value}`).join('; ')}${guides ? guideSummary(min, max, target) : ''}`}
    >
      {yAxis && width <= 1 ? (
        // Held until measured: before layout the plot would be 1 px wide.
        <View style={{ height: plotHeight }} />
      ) : (
        <Svg
          viewBox={`0 0 320 ${vbHeight}`}
          width={yAxis ? plotWidth : '100%'}
          height={plotHeight}
          style={leftInset ? { marginLeft: leftInset } : undefined}
          pointerEvents="none"
        >
          {bands.map((band, index) => (
            <Rect
              key={`band${index}`}
              x={xx(Math.max(xMin, band.from))}
              y={0}
              width={Math.max(0, xx(Math.min(xMax, band.to)) - xx(Math.max(xMin, band.from)))}
              height={vbHeight}
              fill={band.color}
              opacity={0.15}
            />
          ))}
          {markers.map((marker, index) => (
            <Line
              key={`marker${index}`}
              x1={xx(marker.x)}
              x2={xx(marker.x)}
              y1={0}
              y2={vbHeight}
              stroke={marker.color}
              strokeDasharray="3 3"
            />
          ))}
          {series.flatMap((s, index) => {
            const segments: { x: number; y: number }[][] = [[]];
            for (const p of s.points) {
              if (p.value != null && Number.isFinite(p.value)) {
                segments.at(-1)!.push({ x: xx(p.x), y: yy(p.value, s.domain) });
              } else if (segments.at(-1)!.length) {
                segments.push([]);
              }
            }
            return segments
              .filter((segment) => segment.length > 1)
              .map((segment, j) => (
                <Polyline
                  key={`series${index}-${j}`}
                  points={segment.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.5}
                  strokeDasharray={s.dashed ? '4 3' : undefined}
                />
              ));
          })}
          {segments
            .filter((segment) => segment.length > 1)
            .map((segment, index) =>
              fill ? (
                <Polygon
                  key={'fill' + index}
                  points={`${segment[0].x},${vbHeight} ${segment.map((point) => `${point.x},${point.y}`).join(' ')} ${segment.at(-1)!.x},${vbHeight}`}
                  fill={fillColor ?? theme.tones[tone].background}
                />
              ) : null,
            )}
          {segments
            .filter((segment) => segment.length > 1)
            .map((segment, index) => (
              <Polyline
                key={index}
                points={segment.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke={color}
                strokeWidth={2}
              />
            ))}
          {coords.map(
            (point, index) =>
              point &&
              showDot[index] && <Circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r={index === endIndex ? dotRadius * 1.5 : dotRadius}
                  fill={color}
                />,
          )}
        </Svg>
      )}
      {guides && width > 1 && (
        <>
          <ChartGuides
            height={plotHeight}
            left={leftInset}
            gridYs={ticks.map(toY)}
            target={target ? { y: toY(target.value), label: target.label } : undefined}
          />
          {yAxis && (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0 }}>
              <YAxisLabels
                height={plotHeight}
                items={ticks.map((t, i) => ({ y: toY(t), text: tickTexts[i] }))}
              />
            </View>
          )}
        </>
      )}
      {interactive && (
        <View style={{ height: theme.sizes.touchTarget, justifyContent: 'center' }}>
          <AppText variant={labelVariant} tone={labelTone}>
            {selection === null
              ? 'Tap the chart to inspect a reading'
              : (() => {
                  const p = valid.find((p) => (p.x ?? points.indexOf(p)) === selection) ?? valid[0];
                  return `${p.label}: ${p.value} · ${bands
                    .filter((b) => selection >= b.from && selection <= b.to)
                    .map((b) => b.label)
                    .join(' · ')}`;
                })()}
          </AppText>
        </View>
      )}
      {showLabels &&
        (axisLabels && isPointAlignedAxis(axisLabels.length, points.length, axisLabels) ? (
          <View style={{ height: theme.typography[axisVariant].lineHeight, width: '100%' }}>
            {axisLabels.map((text, index) =>
              text === '' ? null : (
                <View
                  key={index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    width: AXIS_LABEL_WIDTH,
                    alignItems: 'center',
                    left:
                      pointCentreX(xs[index], xMin, xMax, plotWidth, plotHeight, leftInset) -
                      AXIS_LABEL_WIDTH / 2,
                  }}
                >
                  <AppText variant={axisVariant} tone={labelTone} numberOfLines={1}>
                    {text}
                  </AppText>
                </View>
              ),
            )}
          </View>
        ) : (
          <Stack
            direction="row"
            justify="space-between"
            style={leftInset ? { paddingLeft: leftInset } : undefined}
          >
            {(axisLabels ?? [valid[0].label, valid.at(-1)!.label]).map((label, index) => (
              <AppText key={index} variant={axisVariant} tone={labelTone}>
                {label}
              </AppText>
            ))}
          </Stack>
        ))}
    </View>
  );
}
