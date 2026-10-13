import { View } from 'react-native';
import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { TextField } from './TextField';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

export function RepCounter({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  function adjust(direction: number) {
    const number = Number(value);
    onChange(
      String(Math.min(100, Math.max(1, (Number.isFinite(number) ? number : 1) + direction))),
    );
  }
  return (
    <Stack direction="row" align="center" gap="sm" style={{ flex: 1, minWidth: 0 }}>
      <AppButton
        title="−"
        variant="secondary"
        accessibilityLabel={`Decrease ${label}`}
        disabled={disabled || Number(value) <= 1}
        onPress={() => adjust(-1)}
        style={{ paddingHorizontal: 0, width: theme.sizes.touchTarget }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <TextField
          label="reps"
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          selectTextOnFocus
          editable={!disabled}
          style={{
            ...theme.typography.display,
            paddingHorizontal: 0,
            paddingVertical: 0,
            borderWidth: 0,
            backgroundColor: 'transparent',
            textAlign: 'center',
            color: theme.colors.brandText,
          }}
        />
      </View>
      <AppButton
        title="+"
        variant="secondary"
        accessibilityLabel={`Increase ${label}`}
        disabled={disabled || Number(value) >= 100}
        onPress={() => adjust(1)}
        style={{ paddingHorizontal: 0, width: theme.sizes.touchTarget }}
      />
    </Stack>
  );
}
