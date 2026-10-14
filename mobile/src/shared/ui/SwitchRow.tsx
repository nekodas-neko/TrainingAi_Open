import { Switch } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';
import { Stack } from './Stack';

export function SwitchRow({
  label,
  value,
  onValueChange,
  disabled,
  compact = false,
  inline = false,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
  inline?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Stack
      direction="row"
      align="center"
      justify="space-between"
      gap={compact ? 'xs' : 'lg'}
      style={inline ? { flexShrink: 1, minWidth: 0 } : undefined}
    >
      <AppText
        variant={compact ? 'caption' : 'body'}
        tone={compact ? 'muted' : 'text'}
        style={inline ? { flexShrink: 1 } : { flex: 1 }}
      >
        {label}
      </AppText>
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
