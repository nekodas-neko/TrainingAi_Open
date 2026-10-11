import { Icon, type IconName } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';

const storedIcons: Record<string, IconName> = {
  '💪': 'workout',
  '🏋️': 'workout',
  '🦵': 'legs',
  '🏃': 'activity',
  '🤸': 'activity',
  '⚡': 'power',
  '🔥': 'flame',
  '🎯': 'target',
  '🏅': 'award',
  '🧘': 'mind',
  '🚴': 'bike',
  '🏊': 'waves',
  '🤼': 'users',
  '🥊': 'swords',
  '🧗': 'mountain',
  '⛹️': 'workout',
  '🤾': 'workout',
  '🎽': 'workout',
  '🦾': 'workout',
  '🏇': 'wind',
  '🔺': 'upper',
  '🔻': 'lower',
  '❤️': 'health',
  '⏱️': 'timer',
  '🏆': 'award',
  '🎖️': 'award',
  '🩺': 'health',
};
const positions: IconName[] = ['workout', 'workout', 'legs', 'activity', 'mind', 'power'];

export function SessionGlyph({ icon, position }: { icon?: string | null; position: number }) {
  const { theme } = useTheme();
  return (
    <Icon
      name={(icon && storedIcons[icon]) || positions[position % positions.length] || 'workout'}
      size={theme.spacing.xxxl}
    />
  );
}
