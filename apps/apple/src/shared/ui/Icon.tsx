import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Dumbbell from 'lucide-react-native/icons/dumbbell';
import Heart from 'lucide-react-native/icons/heart';
import Home from 'lucide-react-native/icons/house';
import MoreHorizontal from 'lucide-react-native/icons/ellipsis';
import Utensils from 'lucide-react-native/icons/utensils';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import HeartPulse from 'lucide-react-native/icons/heart-pulse';
import Footprints from 'lucide-react-native/icons/footprints';
import Activity from 'lucide-react-native/icons/activity';
import Zap from 'lucide-react-native/icons/zap';
import Brain from 'lucide-react-native/icons/brain';
import Flame from 'lucide-react-native/icons/flame';
import Target from 'lucide-react-native/icons/target';
import Award from 'lucide-react-native/icons/award';
import Bike from 'lucide-react-native/icons/bike';
import Waves from 'lucide-react-native/icons/waves-horizontal';
import Users from 'lucide-react-native/icons/users';
import Mountain from 'lucide-react-native/icons/mountain';
import Swords from 'lucide-react-native/icons/swords';
import Wind from 'lucide-react-native/icons/wind';
import Timer from 'lucide-react-native/icons/timer';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import TrendingDown from 'lucide-react-native/icons/trending-down';
import X from 'lucide-react-native/icons/x';
import Calculator from 'lucide-react-native/icons/calculator';
import SkipForward from 'lucide-react-native/icons/skip-forward';
import Check from 'lucide-react-native/icons/check';
import Share from 'lucide-react-native/icons/share';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import ArrowDown from 'lucide-react-native/icons/arrow-down';
import Pencil from 'lucide-react-native/icons/pencil';
import Trash from 'lucide-react-native/icons/trash';
import Plus from 'lucide-react-native/icons/plus';
import Settings from 'lucide-react-native/icons/settings';
import Info from 'lucide-react-native/icons/info';
import Droplets from 'lucide-react-native/icons/droplets';
import UtensilsCrossed from 'lucide-react-native/icons/utensils-crossed';
import type { LucideProps } from 'lucide-react-native';
import { Platform } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

const icons = {
  home: Home,
  health: Heart,
  workout: Dumbbell,
  nutrition: Utensils,
  more: MoreHorizontal,
  back: ChevronLeft,
  forward: ChevronRight,
  program: SlidersHorizontal,
  refresh: RefreshCw,
  cardio: HeartPulse,
  legs: Footprints,
  activity: Activity,
  power: Zap,
  mind: Brain,
  flame: Flame,
  target: Target,
  award: Award,
  bike: Bike,
  waves: Waves,
  users: Users,
  mountain: Mountain,
  swords: Swords,
  wind: Wind,
  timer: Timer,
  upper: TrendingUp,
  lower: TrendingDown,
  close: X,
  calculator: Calculator,
  skip: SkipForward,
  check: Check,
  share: Share,
  up: ArrowUp,
  down: ArrowDown,
  edit: Pencil,
  delete: Trash,
  plus: Plus,
  settings: Settings,
  info: Info,
  water: Droplets,
  foods: UtensilsCrossed,
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
      aria-hidden
      {...(Platform.OS === 'web'
        ? {}
        : {
            accessible: false,
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants' as const,
          })}
      focusable={false}
      pointerEvents="none"
    />
  );
}
