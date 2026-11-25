import { feedback } from '../../integrations/feedback/haptics';
import { Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';
export function MultiChoice({
  label,
  value,
  options,
  flagLabel,
  onChange,
}: {
  label: string;
  value: string[];
  /**
   * `marked` draws the refresh icon after the label and says "suggested" to a screen reader.
   * `flagged` draws a small dot and says `flagLabel` (what the dot means, kept in the caller's
   * words, e.g. "in today's session"); the screen that uses it prints the same words as a caption.
   */
  options: readonly {
    value: string;
    label: string;
    marked?: boolean;
    flagged?: boolean;
  }[];
  flagLabel?: string;
  onChange: (value: string[]) => void;
}) {
  const { theme } = useTheme();
  return (
    <Stack>
      <AppText variant="label">{label}</AppText>
      <Stack direction="row" wrap>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: value.includes(option.value) }}
            aria-checked={value.includes(option.value)}
            accessibilityLabel={
              option.marked || option.flagged
                ? [
                    option.label,
                    ...(option.flagged && flagLabel ? [flagLabel] : []),
                    ...(option.marked ? ['suggested'] : []),
                  ].join(', ')
                : undefined
            }
            onPress={() => {
              feedback();
              onChange(
                value.includes(option.value)
                  ? value.filter((v) => v !== option.value)
                  : [...value, option.value],
              );
            }}
            style={{
              minHeight: theme.sizes.touchTarget,
              paddingHorizontal: theme.spacing.md,
              justifyContent: 'center',
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              borderWidth: 1,
              borderRadius: theme.radii.pill,
              borderColor: value.includes(option.value)
                ? theme.colors.brand
                : theme.colors.border,
              backgroundColor: value.includes(option.value)
                ? theme.colors.brandSurface
                : theme.colors.surface,
            }}
          >
            <AppText variant="caption" tone={value.includes(option.value) ? 'brand' : 'muted'}>
              {option.label}
            </AppText>
            {option.flagged && (
              <View
                style={{
                  width: theme.spacing.sm,
                  height: theme.spacing.sm,
                  borderRadius: theme.radii.pill,
                  backgroundColor: value.includes(option.value)
                    ? theme.colors.brand
                    : theme.colors.muted,
                }}
              />
            )}
            {option.marked && (
              <Icon
                name="refresh"
                size={theme.sizes.iconSmall}
                tone={value.includes(option.value) ? 'brand' : 'muted'}
              />
            )}
          </Pressable>
        ))}
      </Stack>
    </Stack>
  );
}
