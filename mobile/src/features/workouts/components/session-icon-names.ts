import { SESSION_ICON_CHOICES } from '@trainingai/shared/session-icons';
import type { IconName } from '../../../shared/ui/Icon';

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
export function storedIconName(icon: string): IconName | undefined {
  return storedIcons[icon];
}

export function sessionIconOptions() {
  return SESSION_ICON_CHOICES.map(({ emoji, label }) => ({
    id: emoji,
    label,
    icon: storedIconName(emoji) ?? 'workout',
  }));
}
