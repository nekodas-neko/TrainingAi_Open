import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

export const ENERGY_LEVELS = { drained: 1, low: 2, ok: 3, good: 4, pumped: 5 } as const;

/** The five-step energy scale as a battery that fills (#3773, owner's pick A). `level` is 1–5. */
export function EnergyBattery({
  level,
  size,
  color,
}: {
  level: 1 | 2 | 3 | 4 | 5;
  size?: number;
  color?: string;
}) {
  const { theme } = useTheme();
  const px = size ?? theme.sizes.icon;
  const ink = color ?? theme.colors.text;
  return (
    <Svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={ink}
      strokeWidth={theme.icons.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Rect x={2} y={7} width={18} height={10} rx={2.5} />
      <Path d="M22 11v2" />
      {Array.from({ length: level }, (_, i) => (
        // Five bars inside the 18-wide body (x 2 to 20): 2 wide, 2.8 apart, so the fifth ends at 17.2
        // and clears the right wall as the first clears the left.
        <Rect key={i} x={4 + i * 2.8} y={9} width={2} height={6} rx={0.8} fill={ink} stroke="none" />
      ))}
    </Svg>
  );
}
