import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Polygon, Polyline, Rect, Line } from 'react-native-svg';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/theme';

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
}) {
  const { theme } = useTheme();
  const [selection, setSelection] = useState<number | null>(null);
  const [width, setWidth] = useState(1);
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
            (showLabels ? theme.typography.micro.lineHeight! : 0) +
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
  const min = domain?.[0] ?? Math.min(...all);
  const max = domain?.[1] ?? Math.max(...all);
  const xs = points.map((point, index) => point.x ?? index);
  const xMin = xDomain?.[0] ?? Math.min(...xs);
  const xMax = xDomain?.[1] ?? Math.max(...xs);
  const xx = (x: number) => (xMin === xMax ? 160 : 12 + ((x - xMin) / (xMax - xMin)) * 296);
  const yy = (v: number, bounds: readonly [number, number] = [min, max]) =>
    bounds[0] === bounds[1] ? 45 : 78 - ((v - bounds[0]) / (bounds[1] - bounds[0])) * 66;
  const coords = points.map((point, index) =>
    point.value === null || !Number.isFinite(point.value)
      ? null
      : {
          x: xMin === xMax ? 160 : 12 + ((xs[index] - xMin) / (xMax - xMin)) * 296,
          y: max === min ? 45 : 78 - ((point.value - min) / (max - min)) * 66,
        },
  );
  const segments: { x: number; y: number }[][] = [[]];
  for (const point of coords) {
    if (point) {
      segments.at(-1)!.push(point);
    } else if (segments.at(-1)!.length) {
      segments.push([]);
    }
  }
  const color = accent ?? theme.tones[tone].foreground;
  return (
    <View
      onStartShouldSetResponder={() => interactive}
      onResponderGrant={(event) => {
        const x =
          xMin +
          Math.max(0, Math.min(1, ((event.nativeEvent.locationX / width) * 320 - 12) / 296)) *
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
      accessibilityLabel={`${label}: ${valid.map((point) => `${point.label}: ${point.value}`).join('; ')}`}
    >
      <Svg
        viewBox="0 0 320 90"
        width="100%"
        height={height ?? theme.sizes.chartHeight}
        pointerEvents="none"
      >
        {bands.map((band, index) => (
          <Rect
            key={`band${index}`}
            x={xx(Math.max(xMin, band.from))}
            y={0}
            width={Math.max(0, xx(Math.min(xMax, band.to)) - xx(Math.max(xMin, band.from)))}
            height={90}
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
            y2={90}
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
                points={`${segment[0].x},90 ${segment.map((point) => `${point.x},${point.y}`).join(' ')} ${segment.at(-1)!.x},90`}
                fill={theme.tones[tone].background}
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
            point && <Circle key={index} cx={point.x} cy={point.y} r={3} fill={color} />,
        )}
      </Svg>
      {interactive && (
        <View style={{ height: theme.sizes.touchTarget, justifyContent: 'center' }}>
          <AppText variant="micro" tone="muted">
            {selection === null
              ? 'Tap the chart to inspect a reading'
              : (() => {
                  const p =
                    valid.find((p) => (p.x ?? points.indexOf(p)) === selection) ?? valid[0];
                  return `${p.label}: ${p.value} · ${bands
                    .filter((b) => selection >= b.from && selection <= b.to)
                    .map((b) => b.label)
                    .join(' · ')}`;
                })()}
          </AppText>
        </View>
      )}
      {showLabels && (
        <Stack direction="row" justify="space-between">
          {(axisLabels ?? [valid[0].label, valid.at(-1)!.label]).map((label, index) => (
            <AppText key={index} variant="micro" tone="muted">
              {label}
            </AppText>
          ))}
        </Stack>
      )}
    </View>
  );
}
