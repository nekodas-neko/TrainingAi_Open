import { View } from "react-native";
import Svg, { Line } from "react-native-svg";
import { AppText } from "./AppText";
import { useTheme } from "../theme/ThemeProvider";

// Overlay pieces shared by the chart components' opt-in axes, gridlines and target line. They take
// pixel y positions (0 = top of the plot), so each chart maps its own scale and these stay dumb.

/** Width reserved left of the plot when a chart shows y-axis labels. */
export const Y_AXIS_WIDTH = 32;

/** Faint horizontal gridlines and a dashed target line with its label, drawn over the plot. */
export function ChartGuides({
  height,
  gridYs = [],
  target,
}: {
  height: number;
  gridYs?: readonly number[];
  target?: { y: number; label: string };
}) {
  const { theme } = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", left: 0, right: 0, top: 0, height }}
    >
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
            position: "absolute",
            right: 0,
            top: Math.max(0, target.y - theme.typography.caption.lineHeight!),
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
    <View style={{ width: Y_AXIS_WIDTH, height }}>
      {items.map((item) => (
        <AppText
          key={item.text}
          variant="caption"
          numberOfLines={1}
          style={{
            position: "absolute",
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
