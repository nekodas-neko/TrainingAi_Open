import { Pressable } from '../../../shared/ui/Pressable';
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
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.coachFab.background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="coach" color={theme.coachFab.foreground} />
    </Pressable>
  );
}
