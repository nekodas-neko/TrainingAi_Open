import Svg, { Rect } from 'react-native-svg';
import { View } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';
export function StackedBarChart({
  label,
  unit,
  bars,
}: {
  label: string;
  unit: string;
  bars: readonly {
    label: string;
    segments: readonly { label: string; value: number; color: string }[];
  }[];
}) {
  const { theme } = useTheme();
  const maximum = Math.max(
    1,
    ...bars.map((bar) => bar.segments.reduce((sum, part) => sum + part.value, 0)),
  );
  return (
    <Stack direction="row" gap="xxs" align="flex-start" accessibilityLabel={label}>
      {bars.map((bar) => {
        let y = 90;
        return (
          <View
            key={bar.label}
            accessibilityLabel={`${bar.label}: ${bar.segments.length ? bar.segments.map((part) => `${part.label} ${part.value.toFixed(1)} ${unit}`).join('; ') : 'not recorded'}`}
            style={{ flex: 1, minWidth: 0 }}
          >
            <Svg viewBox="0 0 20 96" width="100%" height={theme.sizes.chartHeight}>
              {bar.segments.map((part) => {
                const height = (part.value / maximum) * 84;
                y -= height;
                return (
                  <Rect
                    key={part.label}
                    x={2}
                    y={y}
                    width={16}
                    height={height}
                    fill={part.color}
                  />
                );
              })}
            </Svg>
            <AppText
              variant="micro"
              tone="muted"
              numberOfLines={1}
              style={{ textAlign: 'center' }}
            >
              {bar.label}
            </AppText>
          </View>
        );
      })}
    </Stack>
  );
}
