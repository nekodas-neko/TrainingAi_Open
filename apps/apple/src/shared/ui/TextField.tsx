import { useId } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

export function TextField({
  label,
  hint,
  error,
  style,
  ...props
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  const { theme } = useTheme();
  const id = useId();
  return (
    <Stack gap="xs" style={{ flex: 1 }}>
      <AppText nativeID={id} variant="caption" tone="muted">
        {label}
      </AppText>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityLabelledBy={props.accessibilityLabel ? undefined : id}
        placeholderTextColor={theme.colors.muted}
        selectionColor={theme.colors.brand}
        style={[
          {
            minHeight: theme.sizes.touchTarget,
            borderRadius: theme.radii.control,
            borderWidth: 1,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            color: theme.colors.text,
            backgroundColor: theme.colors.raised,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            ...theme.typography.body,
          },
          style,
        ]}
      />
      {(error || hint) && (
        <AppText
          variant="caption"
          style={error ? { color: theme.colors.danger } : undefined}
          tone="muted"
        >
          {error ?? hint}
        </AppText>
      )}
    </Stack>
  );
}
