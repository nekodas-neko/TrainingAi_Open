import { Pressable, View } from 'react-native';
import { feedback } from '../../integrations/feedback/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

// The small two-way toggle at the right of a card's title row (strength-progress-card.tsx and
// goals-progress-card.tsx). It is drawn small and keeps a full 48 px touch target through hitSlop.
//   tint  the active option is washed in `accent`, as the Estimated 1RM card's Sets | 1RM toggle is
//   pill  the active option is a raised pill on a bordered track, as the Goals card's Today | This Week is
export function CompactToggle<T extends string>({
  label,
  options,
  value,
  onChange,
  appearance,
  accent,
}: {
  label: string;
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  appearance: 'tint' | 'pill';
  accent?: string;
}) {
  const { theme } = useTheme();
  const pill = appearance === 'pill';
  const hit = Math.max(0, (theme.sizes.touchTarget - theme.sizes.compactToggle) / 2);
  return (
    <View
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.raised,
        borderRadius: pill ? theme.radii.control : theme.radii.small,
        overflow: 'hidden',
        padding: pill ? theme.spacing.xxs : 0,
        borderWidth: pill ? 1 : 0,
        borderColor: theme.colors.border,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: active }}
            aria-checked={active}
            hitSlop={{ top: hit, bottom: hit }}
            onPress={() => {
              if (!active) feedback();
              onChange(option.value);
            }}
            style={{
              paddingHorizontal: theme.spacing.snug,
              minHeight: theme.sizes.compactToggle,
              justifyContent: 'center',
              borderRadius: pill ? theme.radii.small : 0,
              backgroundColor: !active
                ? 'transparent'
                : pill
                  ? theme.colors.background
                  : `${accent ?? theme.colors.brand}40`,
            }}
          >
            <AppText
              variant={pill ? 'caption' : 'micro'}
              style={{
                fontWeight: '600',
                color: !active
                  ? theme.colors.muted
                  : pill
                    ? theme.colors.text
                    : (accent ?? theme.colors.brandText),
              }}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
