import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function PageDots({
  labels,
  selectedIndex,
  onSelect,
  variant = 'vertical',
}: {
  labels: readonly string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  variant?: 'vertical' | 'horizontal';
}) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' }}>
      {labels.map((label, index) => (
        <Pressable
          key={index}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: index === selectedIndex }}
          onPress={() => onSelect(index)}
          style={{
            minWidth: theme.spacing.xxl,
            minHeight: theme.sizes.touchTarget,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width:
                variant === 'horizontal' && index === selectedIndex
                  ? theme.spacing.lg
                  : theme.spacing.sm,
              height:
                variant === 'vertical' && index === selectedIndex
                  ? theme.spacing.xl
                  : theme.spacing.sm,
              borderRadius: theme.radii.pill,
              backgroundColor: index === selectedIndex ? theme.colors.brand : theme.colors.border,
            }}
          />
        </Pressable>
      ))}
    </View>
  );
}
