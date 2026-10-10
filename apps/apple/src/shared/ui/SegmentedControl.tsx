import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { theme } = useTheme();
  return (
    <View
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.raised,
        borderRadius: theme.radii.control,
        padding: theme.spacing.xs,
      }}
    >
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{ checked: value === option.value }}
          aria-checked={value === option.value}
          onPress={() => onChange(option.value)}
          style={{
            flex: 1,
            minHeight: theme.sizes.touchTarget,
            padding: theme.spacing.sm,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radii.small,
            backgroundColor: value === option.value ? theme.colors.brandSurface : 'transparent',
          }}
        >
          <AppText variant="label" tone={value === option.value ? 'brand' : 'muted'}>
            {option.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}
