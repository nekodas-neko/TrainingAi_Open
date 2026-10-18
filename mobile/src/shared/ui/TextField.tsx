import { useId } from 'react';
import { TextInput, View, type TextInputProps, type ViewStyle, type StyleProp } from 'react-native';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';
import { MAX_TEXT_SCALE } from '../theme/text-scale';
import type { TextVariant } from '../theme/tokens';

export function TextField({
  label,
  hint,
  error,
  style,
  containerStyle,
  hideLabel = false,
  leadingIcon,
  variant = 'input',
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  hideLabel?: boolean;
  /** A glyph inside the field's left edge, e.g. 'search'. */
  leadingIcon?: IconName;
  /** The type token for the entered text, so it scales like every other text (text-scale.ts). */
  variant?: TextVariant;
}) {
  const { theme, allowFontScaling } = useTheme();
  const id = useId();
  return (
    <Stack gap="xs" style={[{ flex: 1 }, containerStyle]}>
      {!hideLabel && (
        <AppText nativeID={id} variant="caption" tone="muted">
          {label}
        </AppText>
      )}
      <View>
        <TextInput
          allowFontScaling={allowFontScaling}
          maxFontSizeMultiplier={MAX_TEXT_SCALE}
          {...props}
          accessibilityLabel={props.accessibilityLabel ?? label}
          accessibilityLabelledBy={hideLabel || props.accessibilityLabel ? undefined : id}
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
              ...theme.typography[variant],
              ...(leadingIcon ? { paddingLeft: theme.spacing.md + theme.sizes.iconSmall + theme.spacing.sm } : {}),
            },
            style,
          ]}
        />
        {leadingIcon && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: theme.spacing.md,
              top: 0,
              bottom: 0,
              justifyContent: 'center',
            }}
          >
            <Icon name={leadingIcon} tone="muted" size={theme.sizes.iconSmall} />
          </View>
        )}
      </View>
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
