import { View } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';
import { Stack } from './Stack';
export function ZoneGauge({ value, centered = false }: { value: number; centered?: boolean }) {
  const { theme } = useTheme();
  const colors = centered
    ? [theme.anatomy.secondary, theme.anatomy.main, theme.anatomy.secondary]
    : [theme.anatomy.injured, theme.anatomy.secondary, theme.anatomy.main];
  return (
    <View
      accessibilityLabel={`Position ${Math.round(value)} of 100; ${centered ? 'aim for the middle' : 'higher score is better'}`}
    >
      <Svg width="100%" height={theme.spacing.xl} viewBox="0 0 300 20">
        {colors.map((color, i) => (
          <Rect key={i} x={i * 100} width={100} y={7} height={6} fill={color} opacity={0.4} />
        ))}
        <Line
          x1={Math.max(0, Math.min(100, value)) * 3}
          x2={Math.max(0, Math.min(100, value)) * 3}
          y1={0}
          y2={20}
          stroke={theme.colors.text}
          strokeWidth={3}
        />
      </Svg>
      <Stack direction="row" justify="space-between">
        <AppText variant="micro" tone="muted">
          {centered ? 'Below' : 'Low'}
        </AppText>
        {centered && (
          <AppText variant="micro" tone="muted">
            Baseline
          </AppText>
        )}
        <AppText variant="micro" tone="muted">
          {centered ? 'Elevated' : 'High'}
        </AppText>
      </Stack>
    </View>
  );
}
