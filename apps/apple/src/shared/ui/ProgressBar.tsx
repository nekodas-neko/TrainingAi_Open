import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function ProgressBar({ value, complete = false }: { value: number; complete?: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(Math.min(1, Math.max(0, value)) * 100),
      }}
      style={{
        height: theme.spacing.sm,
        borderRadius: theme.radii.pill,
        backgroundColor: theme.colors.brandSurface,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          height: '100%',
          width: `${Math.min(1, Math.max(0, value)) * 100}%`,
          backgroundColor: complete ? theme.anatomy.main : theme.colors.brand,
        }}
      />
    </View>
  );
}
