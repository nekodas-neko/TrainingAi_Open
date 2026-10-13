import { View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';
export function GroupedBarChart({
  labels,
  series,
}: {
  labels: string[];
  series: { label: string; values: number[]; color: string }[];
}) {
  const { theme } = useTheme();
  const values = series.flatMap((s) => s.values),
    min = Math.min(0, ...values),
    max = Math.max(0, ...values);
  const y = (value: number) => 100 - ((value - min) / (max - min || 1)) * 92;
  const slot = 320 / labels.length,
    width = slot / (series.length + 1);
  return (
    <Stack>
      <View
        accessibilityLabel={series
          .map((s) => `${s.label}: ${labels.map((l, i) => `${l} ${s.values[i]}`).join(', ')}`)
          .join('; ')}
      >
        <Svg width="100%" height={theme.sizes.weekVolumeChart} viewBox="0 0 320 108">
          <Line x1="0" x2="320" y1={y(0)} y2={y(0)} stroke={theme.colors.border} />
          {series.flatMap((s, si) =>
            s.values.map((value, i) => (
              <Rect
                key={`${si}:${i}`}
                x={i * slot + width * (si + 0.5)}
                y={Math.min(y(value), y(0))}
                width={width * 0.85}
                height={Math.max(1, Math.abs(y(value) - y(0)))}
                fill={s.color}
              />
            )),
          )}
        </Svg>
      </View>
      <Stack direction="row" justify="space-between">
        {[labels[0], labels.at(-1)].map((l, i) => (
          <AppText key={i} variant="caption" tone="muted">
            {l}
          </AppText>
        ))}
      </Stack>
      {series.map((s) => (
        <AppText key={s.label} variant="caption" style={{ color: s.color }}>
          {s.label}
        </AppText>
      ))}
    </Stack>
  );
}
