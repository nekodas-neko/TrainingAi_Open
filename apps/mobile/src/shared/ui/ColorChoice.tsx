import { Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

export function ColorChoice({
  label,
  color,
  selected,
  onPress,
}: {
  label: string;
  color: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      onPress={onPress}
      style={{
        minHeight: theme.sizes.touchTarget,
        padding: theme.spacing.sm,
        borderWidth: 1,
        borderColor: selected ? theme.colors.brand : theme.colors.border,
        borderRadius: theme.radii.control,
        backgroundColor: selected ? theme.colors.brandSurface : theme.colors.surface,
      }}
    >
      <Stack direction="row" align="center">
        <View
          accessible={false}
          style={{
            width: theme.sizes.icon,
            height: theme.sizes.icon,
            borderRadius: theme.radii.pill,
            backgroundColor: color,
          }}
        />
        <AppText variant="caption">{label}</AppText>
      </Stack>
    </Pressable>
  );
}
