import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/theme';

export function ScoreRing({
  value,
  label,
  caption,
  tone = 'recovery',
  signal,
}: {
  value: number | null;
  label: string;
  caption?: string;
  tone?: Tone;
  signal?: 'main' | 'secondary' | 'injured';
}) {
  const { theme } = useTheme();
  const size = theme.sizes.scoreRing;
  const radius = (size - theme.spacing.md) / 2;
  const length = 2 * Math.PI * radius;
  const color = signal ? theme.anatomy[signal] : theme.tones[tone].foreground;
  return (
    <View
      accessibilityLabel={`${label}: ${value ?? 'unavailable'}`}
      style={{
        alignItems: 'center',
        alignSelf: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
      }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={theme.colors.border}
          strokeWidth={theme.spacing.sm}
        />
        {value !== null && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={theme.spacing.sm}
            strokeLinecap="round"
            strokeDasharray={`${length * Math.max(0, Math.min(1, value / 100))} ${length}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <AppText variant="display" style={{ color }}>
        {value === null ? '—' : Math.round(value)}
      </AppText>
      {caption && (
        <AppText variant="caption" tone="muted">
          {caption}
        </AppText>
      )}
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}
