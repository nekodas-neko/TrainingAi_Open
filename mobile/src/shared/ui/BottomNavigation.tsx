import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { AttentionDot } from './AttentionDot';
import { useTheme } from '../theme/ThemeProvider';

export function BottomNavigation<T extends string>({
  items,
  selected,
  onSelect,
}: {
  items: readonly {
    key: T;
    label: string;
    emphasized?: boolean;
    /** A small red dot on the icon, for something waiting on that tab. */
    badge?: boolean;
    renderIcon: (color: string, size: number) => ReactNode;
  }[];
  selected: T;
  onSelect: (key: T) => void;
}) {
  const { theme } = useTheme();
  return (
    <SafeAreaView edges={['bottom']} style={{ marginTop: -theme.sizes.workoutLift }}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: theme.sizes.workoutLift,
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: theme.colors.surface,
          borderTopWidth: 1,
          borderColor: theme.colors.border,
        }}
      />
      <View style={{ flexDirection: 'row', height: theme.sizes.navigation }}>
        {items.map((item) => {
          const active = selected === item.key;
          const color = active ? theme.colors.brandText : theme.colors.muted;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityLabel={item.badge ? `${item.label}, needs attention` : item.label}
              accessibilityState={{ selected: active }}
              aria-selected={active}
              onPress={() => onSelect(item.key)}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingBottom: theme.spacing.sm,
                gap: theme.spacing.xs,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              {item.emphasized ? (
                <View
                  style={{
                    width: theme.sizes.workoutButton,
                    height: theme.sizes.workoutButton,
                    borderRadius: theme.radii.card,
                    backgroundColor: theme.colors.brand,
                    justifyContent: 'center',
                    alignItems: 'center',
                    boxShadow: [
                      { offsetX: 0, offsetY: 4, blurRadius: 12, color: theme.colors.brandBorder },
                    ],
                  }}
                >
                  {item.renderIcon(theme.colors.onBrand, theme.sizes.emphasizedIcon)}
                </View>
              ) : (
                <View>
                  {item.renderIcon(color, theme.sizes.iconSmall)}
                  {item.badge && <AttentionDot />}
                </View>
              )}
              <AppText variant="tab" style={{ color }}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
