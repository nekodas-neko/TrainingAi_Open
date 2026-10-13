import { Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { feedback } from '../../integrations/feedback/haptics';
import { AppText } from './AppText';
import { Stack } from './Stack';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function WeekdayPicker({
  value,
  onToggle,
  disabled = false,
}: {
  value: readonly number[];
  onToggle: (day: number) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Stack direction="row" gap="xs">
      {weekdays.map((label, day) => {
        const selected = value.includes(day);
        return (
          <Pressable
            key={label}
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            hitSlop={{ left: theme.spacing.xs, right: theme.spacing.xs }}
            onPress={() => {
              feedback();
              onToggle(day);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              minHeight: theme.sizes.touchTarget,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radii.control,
              borderWidth: 1,
              borderColor: selected ? theme.colors.brand : theme.colors.border,
              backgroundColor: selected ? theme.colors.brand : theme.colors.surface,
              opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
            })}
          >
            <AppText
              variant="label"
              numberOfLines={1}
              style={{ color: selected ? theme.colors.onBrand : theme.colors.text }}
            >
              {label[0]}
            </AppText>
          </Pressable>
        );
      })}
    </Stack>
  );
}
