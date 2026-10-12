import { View } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';
export function Legend({ items }: { items: readonly { label: string; color: string }[] }) {
  const { theme } = useTheme();
  return (
    <Stack direction="row" wrap gap="md">
      {items.map((item) => (
        <Stack key={item.label} direction="row" align="center" gap="xs">
          <View
            style={{
              width: theme.spacing.sm,
              height: theme.spacing.sm,
              borderRadius: theme.radii.pill,
              backgroundColor: item.color,
            }}
          />
          <AppText variant="micro" tone="muted">
            {item.label}
          </AppText>
        </Stack>
      ))}
    </Stack>
  );
}
