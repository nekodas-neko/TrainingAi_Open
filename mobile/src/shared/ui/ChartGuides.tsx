import { PixelRatio, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { AppText } from './AppText';
import { yAxisWidth } from './chartScale';
import { useTheme } from '../theme/ThemeProvider';

// Overlay pieces shared by the chart components' opt-in axes, gridlines and target line. They take
// pixel y positions (0 = top of the plot), so each chart maps its own scale and these stay dumb.
// They are decoration: hidden from screen readers (each chart's own label carries the target and
// range) and transparent to touches.
const decorative = {
  pointerEvents: 'none',
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/** Width of the y-axis column for these labels, grown with the system font scale. */
export function yAxisColumnWidth(texts: readonly string[]): number {
  return yAxisWidth(texts, PixelRatio.getFontScale());
}

/** Faint horizontal gridlines and a dashed target line with its label, drawn over the plot. */
export function ChartGuides({
  height,
  gridYs = [],
  target,
  left = 0,
}: {
  height: number;
  gridYs?: readonly number[];
  target?: { y: number; label: string };
  left?: number;
}) {
  const { theme } = useTheme();
  const lineHeight = theme.typography.caption.lineHeight!;
  // Above the line, unless the line is so near the top that the label would be cut off or struck
  // through; then below it.
  const labelTop = target && target.y < lineHeight ? target.y + 2 : (target?.y ?? 0) - lineHeight;
  return (
    <View style={{ position: 'absolute', left, right: 0, top: 0, height }} {...decorative}>
      <Svg width="100%" height={height}>
        {gridYs.map((y, index) => (
          <Line
            key={index}
            x1="0"
            x2="100%"
            y1={y}
            y2={y}
            stroke={theme.colors.border}
            strokeWidth={1}
          />
        ))}
        {target && (
          <Line
            x1="0"
            x2="100%"
            y1={target.y}
            y2={target.y}
            stroke={theme.colors.brand}
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        )}
      </Svg>
      {target && (
        <AppText
          variant="caption"
          style={{
            position: 'absolute',
            right: 0,
            top: labelTop,
            paddingHorizontal: 2,
            backgroundColor: theme.colors.surface,
            color: theme.colors.brandText,
          }}
        >
          {target.label}
        </AppText>
      )}
    </View>
  );
}

/** A column of y-axis value labels, each centred on its pixel y. */
export function YAxisLabels({
  height,
  items,
}: {
  height: number;
  items: readonly { y: number; text: string }[];
}) {
  const { theme } = useTheme();
  const half = theme.typography.caption.lineHeight! / 2;
  return (
    <View
      style={{ width: yAxisColumnWidth(items.map((item) => item.text)), height }}
      {...decorative}
    >
      {items.map((item, index) => (
        <AppText
          key={index}
          variant="caption"
          numberOfLines={1}
          style={{
            position: 'absolute',
            right: 4,
            top: Math.min(height - 2 * half, Math.max(0, item.y - half)),
          }}
        >
          {item.text}
        </AppText>
      ))}
    </View>
  );
}
