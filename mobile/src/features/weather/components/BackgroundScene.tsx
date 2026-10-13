import { useId } from 'react';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Rect,
  Circle,
} from 'react-native-svg';
import type { DayPhaseResult } from '@trainingai/shared/background/day-phase';
import type { Theme } from '../../../shared/theme/theme';
import type { StaticScene } from '../../../shared/theme/backgrounds';
import type { WeatherSnapshot } from '../data/models';
import { tintWeather } from '../data/background';

export function BackgroundScene({
  width,
  height,
  scene,
  phase,
  condition,
  theme,
  scrimOnly = false,
}: {
  width: number;
  height: number;
  scene: StaticScene | 'sky';
  phase: DayPhaseResult;
  condition: WeatherSnapshot['condition'];
  theme: Theme;
  scrimOnly?: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const palette = scene === 'sky' ? null : theme.backgrounds.scenes[scene];
  const sky = scene === 'sky';
  const top = palette?.stops[0] ?? tintWeather(phase.skyTop, condition);
  const bottom = palette?.stops[2] ?? tintWeather(phase.skyBottom, condition);
  const stops = palette?.stops ?? [top, bottom];
  const scrim = theme.backgrounds.scrim;
  const scrimTop = sky ? scrim.top : theme.mode === 'dark' ? 0.2 : 0.1;
  const scrimBottom = sky ? scrim.bottom : theme.mode === 'dark' ? 0.6 : 0.4;
  const scrimColor = sky ? scrim.color : '#000000';
  const rgb = (color: readonly number[]) => `rgb(${color.map(Math.round).join(',')})`;
  const celestialOpacity = condition === 'clear' ? 0.55 : condition === 'cloudy' ? 0.15 : 0;
  const radius = Math.min(64, width * 0.18);
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id={id + 'sky'} x1="0" y1="0" x2="0" y2="1">
          {stops.map((color, index) => (
            <Stop
              key={index}
              offset={index === 0 ? 0 : index === stops.length - 1 ? 1 : 0.55}
              stopColor={color}
            />
          ))}
        </LinearGradient>
        <LinearGradient id={id + 'scrim'} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={scrimColor} stopOpacity={scrimTop} />
          <Stop offset=".5" stopColor={scrimColor} stopOpacity={scrimTop} />
          <Stop offset="1" stopColor={scrimColor} stopOpacity={scrimBottom} />
        </LinearGradient>
        <RadialGradient id={id + 'celestial'}>
          <Stop offset="0" stopColor={rgb(phase.celestialGlow)} stopOpacity=".55" />
          <Stop offset=".35" stopColor={rgb(phase.celestialColor)} stopOpacity=".3" />
          <Stop offset=".7" stopColor={rgb(phase.celestialColor)} stopOpacity="0" />
        </RadialGradient>
        {palette &&
          palette.glow.map((color, index) => (
            <RadialGradient
              key={index}
              id={id + 'glow' + index}
              cx={index === 0 ? palette.origin[0] : scene === 'more' ? 0 : 1}
              cy={index === 0 ? palette.origin[1] : 1}
              r={index === 0 ? 0.55 : 0.6}
            >
              <Stop offset="0" stopColor={color} stopOpacity={palette.glowAlpha[index]} />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </RadialGradient>
          ))}
      </Defs>
      {scrimOnly ? (
        <Rect width={width} height={height} fill={`url(#${id}scrim)`} />
      ) : (
        <>
          <Rect width={width} height={height} fill={`url(#${id}sky)`} />
          {palette &&
            palette.glow.map((_, index) => (
              <Rect
                key={index}
                width={width}
                height={height}
                fill={`url(#${id}glow${index})`}
              />
            ))}
          {sky && celestialOpacity > 0 && (
            <Circle
              cx={(phase.celestialX * width) / 100}
              cy={(phase.celestialY * height) / 100}
              r={radius}
              fill={`url(#${id}celestial)`}
              opacity={celestialOpacity}
            />
          )}
        </>
      )}
    </Svg>
  );
}
