import { View } from 'react-native';
import { AppText } from './AppText';
import { AppButton } from './AppButton';
import { TextField } from './TextField';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

export function RepCounter({
  value,
  onChange,
  label,
  disabled = false,
  rowHeight,
  caption = 'Reps',
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  rowHeight?: number;
  caption?: string;
}) {
  const { theme } = useTheme();
  const row = rowHeight ?? theme.sizes.wheelRow;
  function adjust(direction: number) {
    const number = Number(value);
    onChange(
      String(
        Math.min(100, Math.max(0, (Number.isInteger(number) ? number : 0) + direction)),
      ),
    );
  }
  return (
    <View style={{ height: row * 3 + theme.spacing.sm, width: '100%' }}>
      <View style={{ height: row, justifyContent: 'center', alignItems: 'center' }}>
        <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {caption}
        </AppText>
      </View>
      <View style={{ height: row, width: '100%', flexShrink: 0 }}>
        <TextField
          hideLabel
          label={caption}
          accessibilityLabel={label}
          value={value}
          onChangeText={(text) => {
            if (/^\d{0,3}$/.test(text) && Number(text) <= 100) {
              onChange(text);
            }
          }}
          keyboardType="number-pad"
          selectTextOnFocus
          editable={!disabled}
          containerStyle={{ width: '100%' }}
          style={{
            ...theme.typography.display,
            height: row,
            minHeight: row,
            padding: 0,
            borderWidth: 2,
            borderColor: theme.colors.brandBorder,
            backgroundColor: theme.colors.brandSurface,
            textAlign: 'center',
            textAlignVertical: 'center',
            includeFontPadding: false,
            color: theme.colors.brandText,
          }}
        />
      </View>
      <Stack
        direction="row"
        align="center"
        justify="center"
        gap="sm"
        style={{ height: row + theme.spacing.sm, paddingTop: theme.spacing.sm }}
      >
        <AppButton
          title=""
          icon="minus"
          iconSize={theme.sizes.emphasizedIcon}
          variant="surface"
          accessibilityLabel={`Decrease ${label}`}
          disabled={disabled || Number(value) <= 0}
          onPress={() => adjust(-1)}
          style={{
            padding: 0,
            flex: 1,
            minWidth: 0,
            height: theme.sizes.loggingControl,
          }}
        />
        <AppButton
          title=""
          icon="plus"
          iconSize={theme.sizes.emphasizedIcon}
          variant="surface"
          accessibilityLabel={`Increase ${label}`}
          disabled={disabled || Number(value) >= 100}
          onPress={() => adjust(1)}
          style={{
            padding: 0,
            flex: 1,
            minWidth: 0,
            height: theme.sizes.loggingControl,
          }}
        />
      </Stack>
    </View>
  );
}
