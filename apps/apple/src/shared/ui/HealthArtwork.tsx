import Svg, {
  Defs,
  Rect,
  Circle,
  Ellipse,
  Path,
  Polyline,
  LinearGradient,
  RadialGradient,
  Stop,
  Mask,
} from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

function SleepDecoration({
  scheme,
  colors,
}: {
  scheme: 'dark' | 'light';
  colors: Record<string, string>;
}) {
  const stars = [
    [40, 28, 1.4],
    [100, 18, 1.0],
    [155, 44, 1.6],
    [200, 12, 1.1],
    [255, 48, 1.3],
    [60, 80, 1.0],
    [130, 95, 1.5],
    [230, 75, 1.2],
    [320, 22, 1.4],
    [360, 60, 1.0],
    [180, 90, 1.3],
    [290, 82, 1.6],
    [340, 38, 1.1],
    [80, 120, 1.0],
    [210, 130, 1.4],
  ];
  return (
    <Svg width="100%" height="100%" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <Mask id="moonCrescentMask">
          <Rect width="400" height="260" fill="black" />
          <Circle cx="330" cy="54" r="26" fill="white" />
          <Circle cx="340" cy="46" r="21" fill="black" />
        </Mask>
      </Defs>
      <Circle cx="330" cy="54" r="26" fill={colors['e4defb']} mask="url(#moonCrescentMask)" />
      <Circle
        cx="330"
        cy="54"
        r="26"
        fill="none"
        stroke={colors['c4b5fd']}
        strokeWidth="1.5"
        opacity="0.5"
        mask="url(#moonCrescentMask)"
      />
      {stars.map(([cx, cy, r], i) => (
        <Circle key={i} cx={cx} cy={cy} r={r} fill="white" opacity={0.4 + (i % 3) * 0.2} />
      ))}
    </Svg>
  );
}

('use strict');
function ReadinessDecoration({
  scheme,
  colors,
}: {
  scheme: 'dark' | 'light';
  colors: Record<string, string>;
}) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <RadialGradient id="sunriseGlow" cx="50%" cy="100%" r="70%">
          <Stop offset="0%" stopColor={colors['ffd080']} stopOpacity="0.95" />
          <Stop offset="28%" stopColor={colors['f5a040']} stopOpacity="0.55" />
          <Stop offset="62%" stopColor={colors['e87030']} stopOpacity="0.18" />
          <Stop offset="100%" stopColor={colors['e87030']} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="sunCore" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={colors['fff8e0']} />
          <Stop offset="55%" stopColor={colors['ffd060']} />
          <Stop offset="100%" stopColor={colors['f5a040']} />
        </RadialGradient>
      </Defs>

      <Rect width="400" height="260" fill="url(#sunriseGlow)" />

      {[
        [42, 20],
        [132, 13],
        [308, 26],
        [358, 16],
      ].map(([x, y], i) => (
        <Circle key={i} cx={x} cy={y} r="0.9" fill="white" opacity="0.38" />
      ))}

      <Circle cx="200" cy="266" r="64" fill="url(#sunCore)" />
      <Circle cx="200" cy="266" r="50" fill={colors['fff8e0']} opacity="0.9" />

      <Rect x="0" y="249" width="400" height="2.5" fill={colors['f5a040']} opacity="0.65" />

      <Ellipse cx="72" cy="90" rx="62" ry="16" fill="white" opacity="0.26" />
      <Ellipse cx="50" cy="82" rx="38" ry="11" fill="white" opacity="0.20" />
      <Ellipse cx="95" cy="80" rx="28" ry="10" fill="white" opacity="0.18" />
      <Ellipse cx="320" cy="108" rx="68" ry="18" fill="white" opacity="0.24" />
      <Ellipse cx="348" cy="100" rx="44" ry="13" fill="white" opacity="0.19" />
      <Ellipse cx="298" cy="100" rx="32" ry="11" fill="white" opacity="0.17" />
      <Ellipse cx="188" cy="63" rx="52" ry="13" fill="white" opacity="0.17" />
      <Ellipse cx="158" cy="142" rx="40" ry="10" fill={colors['cce4f5']} opacity="0.13" />
      <Ellipse cx="285" cy="150" rx="36" ry="9" fill={colors['cce4f5']} opacity="0.11" />
    </Svg>
  );
}

('use strict');
function ActivityDecoration({
  scheme,
  colors,
}: {
  scheme: 'dark' | 'light';
  colors: Record<string, string>;
}) {
  const mtnNear =
    scheme === 'light'
      ? { top: colors.mountainLightTop, bottom: colors.mountainLightBottom }
      : { top: colors.mountainDarkTop, bottom: colors.mountainDarkBottom };
  return (
    <Svg width="100%" height="100%" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id="mtnFar" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={colors['1e1260']} />
          <Stop offset="100%" stopColor={colors['0d0a2e']} />
        </LinearGradient>
        <LinearGradient id="mtnNear" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={mtnNear.top} />
          <Stop offset="100%" stopColor={mtnNear.bottom} />
        </LinearGradient>
      </Defs>

      {[
        [40, 30],
        [120, 18],
        [280, 24],
        [360, 42],
        [195, 14],
      ].map(([x, y], i) => (
        <Circle key={i} cx={x} cy={y} r="1.2" fill="white" opacity="0.55" />
      ))}

      <Path
        d="M-10 215 L32 145 L68 172 L106 116 L148 156 L192 104 L238 144 L276 110 L318 138 L365 106 L420 134 L420 270 L-10 270 Z"
        fill="url(#mtnFar)"
        opacity="0.6"
      />

      <Path
        d="M-10 250 L26 182 L62 208 L98 158 L138 187 L182 136 L222 168 L264 142 L306 172 L348 146 L395 172 L420 270 L-10 270 Z"
        fill="url(#mtnNear)"
        opacity="0.92"
      />

      <Path d="M98  158 L114 176 L82  176 Z" fill="white" opacity="0.5" />
      <Path d="M182 136 L200 156 L164 156 Z" fill="white" opacity="0.6" />
      <Path d="M264 142 L282 161 L246 161 Z" fill="white" opacity="0.5" />
      <Path d="M348 146 L364 163 L332 163 Z" fill="white" opacity="0.4" />

      <Rect x="0" y="244" width="400" height="3" fill={colors['f97316']} opacity="0.35" />
    </Svg>
  );
}

('use strict');
function HeartRateDecoration({
  scheme,
  colors,
}: {
  scheme: 'dark' | 'light';
  colors: Record<string, string>;
}) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice">
      <Polyline
        points="0,140 80,140 100,140 115,80 130,195 145,55 165,165 185,140 400,140"
        fill="none"
        stroke={colors['ef4444']}
        strokeWidth="2"
        opacity="0.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const decorations = {
  sleep: SleepDecoration,
  readiness: ReadinessDecoration,
  activity: ActivityDecoration,
  'heart-rate': HeartRateDecoration,
};
export function HealthArtwork({ kind }: { kind: keyof typeof decorations }) {
  const { theme } = useTheme();
  const Decoration = decorations[kind];
  return <Decoration scheme={theme.mode} colors={theme.healthArtColors} />;
}
