import { Pressable, Text, View, type ColorValue } from 'react-native';
import type { AppStyles } from '../../shared/theme/useAppTheme';
import { tabs, type Tab } from './tabs';

export function TabBar({
  selected,
  onSelect,
  styles: s,
  tint,
}: {
  selected: Tab;
  onSelect: (tab: Tab) => void;
  styles: AppStyles;
  tint: ColorValue;
}) {
  return (
    <View style={s.tabs}>
      {tabs.map((tab) => (
        <Pressable
          key={tab}
          accessibilityRole="tab"
          accessibilityState={{ selected: selected === tab }}
          onPress={() => onSelect(tab)}
          style={s.tab}
        >
          <Text style={[s.tabText, selected === tab && { color: tint }]}>{tab}</Text>
        </Pressable>
      ))}
    </View>
  );
}
