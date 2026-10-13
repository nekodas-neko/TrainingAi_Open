import { TextInput } from 'react-native';
import { Stack } from './Stack';
import { IconButton } from './IconButton';
import { useTheme } from '../theme/ThemeProvider';
export function ChatComposer({
  value,
  onChange,
  onSend,
  busy,
  onStop,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  onStop: () => void;
  disabled: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Stack direction="row" align="center">
      <TextInput
        accessibilityLabel="Message Coach"
        placeholder="Tell me what you want to change…"
        placeholderTextColor={theme.colors.muted}
        value={value}
        onChangeText={onChange}
        multiline
        maxLength={12000}
        editable={!disabled}
        style={{
          flex: 1,
          minHeight: theme.sizes.touchTarget,
          maxHeight: 130,
          padding: theme.spacing.md,
          borderRadius: theme.radii.control,
          backgroundColor: theme.colors.raised,
          color: theme.colors.text,
          ...theme.typography.body,
        }}
      />
      <IconButton
        icon={busy ? 'close' : 'up'}
        label={busy ? 'Stop reply' : 'Send message'}
        disabled={disabled || (!busy && !value.trim())}
        onPress={busy ? onStop : onSend}
      />
    </Stack>
  );
}
