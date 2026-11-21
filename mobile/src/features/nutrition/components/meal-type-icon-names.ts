import type { IconName } from '../../../shared/ui/Icon';

// A meal type stores its emoji (`meal_types.emoji`, shared with the current app). Preview draws an
// icon for it instead, the way `session-icon-names.ts` does for sessions. Anything not listed,
// such as an emoji the person typed in the current app, falls back to the plate.
const mealIcons: Record<string, IconName> = {
  '🍳': 'egg',
  '🍎': 'apple',
  '🥗': 'salad',
  '🍪': 'cookie',
  '🍽️': 'nutrition',
  '🌙': 'moon',
};

export const MEAL_TYPE_ICON_CHOICES: ReadonlyArray<{ emoji: string; label: string; icon: IconName }> = [
  { emoji: '🍳', label: 'Breakfast', icon: 'egg' },
  { emoji: '🍎', label: 'Fruit', icon: 'apple' },
  { emoji: '🥗', label: 'Salad', icon: 'salad' },
  { emoji: '🍪', label: 'Snack', icon: 'cookie' },
  { emoji: '🍽️', label: 'Plate', icon: 'nutrition' },
  { emoji: '🌙', label: 'Evening', icon: 'moon' },
];

export function mealTypeIconName(emoji: string | null | undefined): IconName {
  return (emoji && mealIcons[emoji.trim()]) || 'nutrition';
}

/** The leading emoji of a server-built meal title ("🍳 Breakfast"), or undefined. */
export function leadingEmoji(title: string): string | undefined {
  return /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u.exec(title)?.[0];
}
