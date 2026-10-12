import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

export function BarChart({
  label,
  bars,
  height,
}: {
  label: string;
  height?: number;
  bars: readonly {
    label: string;
    value: number;
    colors: string[];
    reduced?: boolean;
    annotation?: string;
    selected?: boolean;
  }[];
}) {
  const { theme } = useTheme();
  const id = useId().replace(/:/g, '');
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <Stack direction="row" gap="xs" align="flex-start" accessibilityLabel={label}>
      {bars.map((bar, index) => {
        const height = bar.value > 0 ? Math.max(16, (bar.value / max) * 52) : 6;
        const colors = bar.colors.length ? bar.colors : [theme.colors.brand];
        return (
          <View
            key={index}
            style={{ flex: 1, minWidth: 0 }}
            accessibilityLabel={`${bar.label}: ${Math.round(bar.value)} kg${bar.annotation ? ', ' + bar.annotation : ''}`}
          >
            <Svg
              viewBox="0 0 40 64"
              width="100%"
              height={height ?? 64}
              preserveAspectRatio={height ? 'none' : 'xMidYMid meet'}
            >
              <Defs>
                <Pattern
                  id={`${id}-${index}`}
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <Rect width="3" height="6" fill={theme.colors.surface} />
                </Pattern>
              </Defs>
              {bar.value > 0 ? (
                colors.map((color, at) => (
                  <Rect
                    key={at}
                    x="0"
                    y={64 - height + (at * height) / colors.length}
                    width="40"
                    height={height / colors.length}
                    fill={color}
                  />
                ))
              ) : (
                <Rect x="0" y="58" width="40" height="6" fill={theme.colors.border} />
              )}
              {bar.reduced && (
                <Rect
                  x="0"
                  y={64 - height}
                  width="40"
                  height={height}
                  fill={`url(#${id}-${index})`}
                />
              )}
            </Svg>
            <AppText
              variant="micro"
              tone={bar.selected ? 'brand' : 'muted'}
              style={{ textAlign: 'center' }}
            >
              {bar.label}
              {bar.annotation ? ` (${bar.annotation})` : ''}
            </AppText>
          </View>
        );
      })}
    </Stack>
  );
}
