import { View } from 'react-native';
import { useTheme } from '../../../shared/theme/ThemeProvider';

/**
 * `●●●●○` as elements rather than text, so a screen reader gets the count once instead of five
 * bullet characters. `shown` is capped by the caller so a seven-cost ladder still fits beside the label.
 */
export function Pips({
  have,
  need,
  shown,
}: {
  have: number;
  need: number;
  shown: number;
}) {
  const { theme } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${have} of ${need}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xxs }}
    >
      {Array.from({ length: shown }, (_, i) => (
        <View
          key={i}
          style={{
            width: theme.spacing.xs + theme.spacing.xxs,
            height: theme.spacing.xs + theme.spacing.xxs,
            borderRadius: theme.radii.pill,
            backgroundColor: i < have ? theme.colors.brand : theme.colors.track,
          }}
        />
      ))}
    </View>
  );
}
