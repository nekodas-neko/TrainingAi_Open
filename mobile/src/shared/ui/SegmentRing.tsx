import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
export function SegmentRing({
  segments,
  value,
  label,
  size: requestedSize,
  thickness,
  children,
}: PropsWithChildren<{
  segments: { share: number; color: string }[];
  value: number;
  label: string;
  /** Outer diameter; the Nutrition tab's ring when omitted. */
  size?: number;
  /** Stroke width of a ring that is not the Nutrition tab's; the arc then fills the whole box. */
  thickness?: number;
}>) {
  const { theme } = useTheme();
  const size = requestedSize ?? theme.sizes.nutritionRing;
  const stroke = thickness ?? theme.spacing.sm + theme.spacing.xxs;
  const radius = thickness === undefined ? (size - theme.spacing.xl) / 2 : (size - thickness) / 2;
  const length = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <View
      accessibilityLabel={label}
      style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={theme.colors.border}
          strokeWidth={stroke}
        />
        {segments.map((s, index) => {
          const start = offset;
          const share = Math.max(0, s.share) * Math.max(0, Math.min(1, value));
          offset += share;
          return (
            <Circle
              key={index}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${share * length} ${length}`}
              strokeDashoffset={-start * length}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
        })}
      </Svg>
      {children}
    </View>
  );
}
