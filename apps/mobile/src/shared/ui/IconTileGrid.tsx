import { Pressable } from 'react-native';
import { Grid } from './Grid';
import { Stack } from './Stack';
import { Icon, type IconName } from './Icon';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';

export function IconTileGrid<T extends string>({
  options,
  onSelect,
  disabled = false,
}: {
  options: readonly { id: T; label: string; icon: IconName }[];
  onSelect: (id: T) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Grid columns={5} gap="xs">
      {options.map((option) => (
        <Pressable
          key={option.id}
          disabled={disabled}
          onPress={() => onSelect(option.id)}
          accessibilityRole="button"
          accessibilityLabel={option.label}
          accessibilityState={{ disabled }}
          style={{
            minHeight: theme.sizes.button + theme.spacing.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radii.control,
            padding: theme.spacing.xs,
            justifyContent: 'center',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Stack align="center" gap="xs">
            <Icon name={option.icon} />
            <AppText variant="micro" style={{ textAlign: 'center' }}>
              {option.label}
            </AppText>
          </Stack>
        </Pressable>
      ))}
    </Grid>
  );
}
