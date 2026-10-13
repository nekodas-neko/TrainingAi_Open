import { Switch } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';
import { Stack } from './Stack';

export function SwitchRow({
  label,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Stack direction="row" align="center" justify="space-between" gap="lg">
      <AppText style={{ flex: 1 }}>{label}</AppText>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: theme.colors.raised, true: theme.colors.brand }}
      />
    </Stack>
  );
}
