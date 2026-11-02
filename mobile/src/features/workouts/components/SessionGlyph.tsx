import { Icon, type IconName } from '../../../shared/ui';
import { storedIconName } from './session-icon-names';
import { useTheme } from '../../../shared/theme/ThemeProvider';

const positions: IconName[] = ['workout', 'workout', 'legs', 'activity', 'mind', 'power'];

export function SessionGlyph({
  icon,
  position,
  size,
  color,
}: {
  icon?: string | null;
  position: number;
  size?: number;
  color?: string;
}) {
  const { theme } = useTheme();
  return (
    <Icon
      name={(icon && storedIconName(icon)) || positions[position % positions.length] || 'workout'}
      size={size ?? theme.spacing.xxxl}
      color={color}
    />
  );
}
