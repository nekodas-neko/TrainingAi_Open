import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Dumbbell from 'lucide-react-native/icons/dumbbell';
import Heart from 'lucide-react-native/icons/heart';
import Home from 'lucide-react-native/icons/house';
import MoreHorizontal from 'lucide-react-native/icons/ellipsis';
import Utensils from 'lucide-react-native/icons/utensils';
import type { LucideProps } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';

const icons = {
  home: Home,
  health: Heart,
  workout: Dumbbell,
  nutrition: Utensils,
  more: MoreHorizontal,
  back: ChevronLeft,
  forward: ChevronRight,
};

export type IconName = keyof typeof icons;

export function Icon({
  name,
  size,
  color,
  tone = 'text',
  strokeWidth,
  style,
}: {
  name: IconName;
  size?: number;
  color?: LucideProps['color'];
  tone?: 'text' | 'muted' | 'brand' | 'danger';
  strokeWidth?: number;
  style?: LucideProps['style'];
}) {
  const { theme } = useTheme();
  const Glyph = icons[name];
  return (
    <Glyph
      size={size ?? theme.sizes.icon}
      color={color ?? theme.colors[tone === 'brand' ? 'brandText' : tone]}
      strokeWidth={strokeWidth ?? theme.icons.strokeWidth}
      style={style}
      accessible={false}
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      focusable={false}
      pointerEvents="none"
    />
  );
}
