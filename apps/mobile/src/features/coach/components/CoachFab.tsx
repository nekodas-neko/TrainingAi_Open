import { Pressable } from 'react-native';
import { Icon } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
export function CoachFab({ onPress }: { onPress: () => void }) {
  const { theme } = useTheme(),
    size = theme.sizes.touchTarget + theme.spacing.sm;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open AI Coach"
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.colors.text,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Icon name="coach" color={theme.colors.background} />
    </Pressable>
  );
}
