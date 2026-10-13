import { feedback } from '../../integrations/feedback/haptics';
import { BottomNavigation, Icon, type IconName } from '../../shared/ui';
import { tabs, type Tab } from './tabs';

const tabIcons: Record<Tab, IconName> = {
  Home: 'home',
  Health: 'health',
  Workout: 'workout',
  Nutrition: 'nutrition',
  More: 'more',
};

export function TabBar({
  selected,
  onSelect,
}: {
  selected: Tab;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <BottomNavigation
      selected={selected}
      onSelect={(tab) => {
        if (tab !== selected) feedback();
        onSelect(tab as Tab);
      }}
      items={tabs.map((tab) => ({
        key: tab,
        label: tab,
        emphasized: tab === 'Workout',
        renderIcon: (color: string, size: number) => (
          <Icon name={tabIcons[tab]} color={color} size={size} />
        ),
      }))}
    />
  );
}
