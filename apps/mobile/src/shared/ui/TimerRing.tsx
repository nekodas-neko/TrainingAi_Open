import { Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';

export function TimerRing({
  value,
  caption,
  progress = 0,
  compact = false,
  overtime = false,
  onPress,
}: {
  value: string;
  caption?: string;
  progress?: number;
  compact?: boolean;
  overtime?: boolean;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  const size = compact ? theme.sizes.button : theme.sizes.timerRing;
  const stroke = compact ? 3 : 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = overtime ? theme.anatomy.injured : theme.colors.brandText;
  const ring = (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={theme.colors.border}
          strokeWidth={stroke}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * Math.min(1, Math.max(0, progress))} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <AppText variant={compact ? 'micro' : 'display'} style={{ color, textAlign: 'center' }}>
        {value}
      </AppText>
      {!compact && caption && (
        <AppText variant="caption" tone="muted">
          {caption}
        </AppText>
      )}
    </View>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Start next set, skipping remaining rest"
      onPress={onPress}
    >
      {ring}
    </Pressable>
  ) : (
    ring
  );
}
