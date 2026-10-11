import { View } from 'react-native';
import Svg, { Circle, Polygon, Polyline } from 'react-native-svg';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

export function LineChart({
  points,
  label,
  showLabels = true,
  fill = false,
  height,
}: {
  points: readonly { label: string; value: number }[];
  label: string;
  showLabels?: boolean;
  fill?: boolean;
  height?: number;
}) {
  const { theme } = useTheme();
  const valid = points.filter((point) => Number.isFinite(point.value));
  if (!valid.length) {
    return (
      <AppText variant="caption" tone="muted">
        No recorded data yet
      </AppText>
    );
  }
  const min = Math.min(...valid.map((point) => point.value));
  const max = Math.max(...valid.map((point) => point.value));
  const coords = valid.map((point, index) => ({
    x: valid.length === 1 ? 160 : 12 + (index / (valid.length - 1)) * 296,
    y: max === min ? 45 : 78 - ((point.value - min) / (max - min)) * 66,
  }));
  return (
    <View
      accessibilityLabel={`${label}: ${valid.map((point) => `${point.label}: ${point.value}`).join('; ')}`}
    >
      <Svg viewBox="0 0 320 90" width="100%" height={height ?? theme.sizes.chartHeight}>
        {fill && valid.length > 1 && (
          <Polygon
            points={`${coords[0].x},90 ${coords.map((point) => `${point.x},${point.y}`).join(' ')} ${coords.at(-1)!.x},90`}
            fill={theme.colors.brandSurface}
          />
        )}
        {valid.length > 1 && (
          <Polyline
            points={coords.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke={theme.colors.brandText}
            strokeWidth={2}
          />
        )}
        {coords.map((point, index) => (
          <Circle key={index} cx={point.x} cy={point.y} r={3} fill={theme.colors.brandText} />
        ))}
      </Svg>
      {showLabels && (
        <Stack direction="row" justify="space-between">
          <AppText variant="micro" tone="muted">
            {valid[0].label}
          </AppText>
          <AppText variant="micro" tone="muted">
            {valid.at(-1)!.label}
          </AppText>
        </Stack>
      )}
    </View>
  );
}
