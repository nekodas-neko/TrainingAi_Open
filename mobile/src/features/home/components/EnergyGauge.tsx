import { useId, type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  DIAL,
  TIDE,
  arcPath,
  gaugeMargin,
  notch,
  waterPath,
} from '../data/energy-hero';

/**
 * Energy's gauge (#2989): the dial (D1) over the wallpaper, the tide (R1) when the wallpaper is
 * off. Same arc in both: the live level in the theme accent, the stretch it has fallen since the
 * morning dashed, and a notch where the day opened. Water in the tide is still and just lowers.
 * `level` is null when there is no data: an empty track, never a made-up number.
 */
export function EnergyGauge({
  shape,
  size,
  stroke,
  level,
  morning,
  children,
}: {
  shape: 'dial' | 'tide';
  size: number;
  stroke: number;
  level: number | null;
  morning: number | null;
  children: ReactNode;
}) {
  const { theme } = useTheme();
  const id = useId().replace(/:/g, '');
  const arc = shape === 'dial' ? DIAL : TIDE;
  const center = size / 2;
  const radius = center - stroke / 2 - gaugeMargin(size);
  const brand = theme.colors.brand;
  // The dark mockups draw the track as white at 11%; light uses the theme's own track.
  const trackColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.11)' : theme.colors.track;
  const mark = theme.colors.text;
  const track = arcPath(arc, center, radius, 0, 100);
  const fill = level === null ? null : arcPath(arc, center, radius, 0, level);
  const spent =
    level === null || morning === null ? null : arcPath(arc, center, radius, level, morning);
  const bar = morning === null ? null : notch(arc, center, radius, stroke, morning);
  // The tank: a circle just inside the ring, water filling it to the level.
  const tankBorder = radius - stroke / 2 - Math.max(4, size / 36);
  const tankClip = tankBorder - 2;
  const tankTop = center - tankClip;
  const levelY = (value: number) => tankTop + (1 - value / 100) * tankClip * 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} pointerEvents="none">
        <Defs>
          <ClipPath id={`${id}clip`}>
            <Circle cx={center} cy={center} r={tankClip} />
          </ClipPath>
          <LinearGradient id={`${id}water`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={brand} stopOpacity="0.62" />
            <Stop offset="1" stopColor={brand} stopOpacity="0.22" />
          </LinearGradient>
        </Defs>
        {track && (
          <Path
            d={track}
            stroke={trackColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
        )}
        {spent && (
          <Path
            d={spent}
            stroke={brand}
            strokeOpacity={0.5}
            strokeWidth={stroke}
            strokeDasharray="2.4 2.6"
            fill="none"
          />
        )}
        {fill && (
          <Path d={fill} stroke={brand} strokeWidth={stroke} strokeLinecap="round" fill="none" />
        )}
        {bar && (
          <Line
            x1={bar.from.x}
            y1={bar.from.y}
            x2={bar.to.x}
            y2={bar.to.y}
            stroke={mark}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        )}
        {shape === 'tide' && (
          <>
            <Circle
              cx={center}
              cy={center}
              r={tankBorder}
              stroke={theme.colors.brandBorder}
              strokeWidth={3}
              fill="none"
            />
            <G clipPath={`url(#${id}clip)`}>
              <Rect
                x={0}
                y={0}
                width={size}
                height={size}
                fill={theme.colors.brandSurface}
                opacity={0.5}
              />
              {level !== null && (
                <>
                  <Path
                    d={waterPath(size, levelY(level) - 3, size, 2.5)}
                    fill={brand}
                    opacity={0.34}
                  />
                  <Path
                    d={waterPath(size, levelY(level), size, 2.5)}
                    fill={`url(#${id}water)`}
                  />
                </>
              )}
              {morning !== null && (
                <Line
                  x1={0}
                  y1={levelY(morning)}
                  x2={size}
                  y2={levelY(morning)}
                  stroke={mark}
                  strokeWidth={2}
                  strokeDasharray="3 4"
                  strokeLinecap="round"
                  opacity={0.85}
                />
              )}
            </G>
          </>
        )}
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: shape === 'dial' ? size * 0.04 : 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </View>
  );
}
