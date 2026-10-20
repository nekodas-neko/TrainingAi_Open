import { View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { AppText } from '../../../shared/ui/AppText';
import { useTheme } from '../../../shared/theme/ThemeProvider';

// The current app's RestRing (components/workout/rest-ring.tsx), drawn the same way on every rest
// screen (#3142): a 180 px ring that fills as the rest runs, then a red arc that grows over it at
// 35% for the overtime. CSS blur and drop-shadow have no react-native-svg equivalent, so the glow
// is a radial gradient behind the ring; the arcs' own drop-shadow is left out.
const SIZE = 180;
const RADIUS = 78;
const STROKE = 13;
const HALO = 48;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function RestRing({ elapsedSec, targetSec }: { elapsedSec: number; targetSec: number }) {
  const { theme } = useTheme();
  const overtime = elapsedSec > targetSec;
  const progress = targetSec > 0 ? Math.min(1, elapsedSec / targetSec) : 0;
  const remaining = Math.max(0, targetSec - elapsedSec);
  const overtimeSec = overtime ? elapsedSec - targetSec : 0;
  const red = theme.anatomy.injured;
  const color = overtime ? red : theme.colors.brand;
  const centre = SIZE / 2;
  const arc = (length: number, stroke: string, opacity = 1) => (
    <Circle
      cx={centre}
      cy={centre}
      r={RADIUS}
      fill="none"
      stroke={stroke}
      strokeWidth={STROKE}
      strokeOpacity={opacity}
      strokeLinecap="round"
      strokeDasharray={`${length} ${CIRCUMFERENCE}`}
      transform={`rotate(-90 ${centre} ${centre})`}
    />
  );
  const overtimeArc = Math.min(CIRCUMFERENCE, CIRCUMFERENCE * (overtimeSec / (targetSec || 1)));
  return (
    <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={SIZE + HALO * 2}
        height={SIZE + HALO * 2}
        style={{ position: 'absolute', left: -HALO, top: -HALO }}
      >
        <Defs>
          <RadialGradient id="rest-halo" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={0.2} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={centre + HALO} cy={centre + HALO} r={centre + HALO} fill="url(#rest-halo)" />
      </Svg>
      <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
        <Circle
          cx={centre}
          cy={centre}
          r={RADIUS}
          fill="none"
          stroke={theme.colors.text}
          strokeOpacity={0.08}
          strokeWidth={STROKE}
        />
        {progress > 0 && arc(CIRCUMFERENCE * progress, color)}
        {overtime && arc(overtimeArc, red, 0.35)}
      </Svg>
      <AppText
        variant={overtime ? 'restOvertime' : 'restCountdown'}
        style={{ color, fontVariant: ['tabular-nums'], textAlign: 'center' }}
      >
        {overtime ? `+${overtimeSec}` : remaining}
      </AppText>
      <AppText variant="caption" tone="muted" style={{ marginTop: 4 }}>
        {overtime ? `target ${targetSec}s` : `of ${targetSec}s`}
      </AppText>
    </View>
  );
}
