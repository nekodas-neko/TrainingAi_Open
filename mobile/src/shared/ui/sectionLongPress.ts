import { createContext } from 'react';

/**
 * A long press that belongs to a whole section, such as a Home card's widget menu (#3704).
 *
 * React Native gives a touch to the innermost Pressable. A card that is tappable itself takes the
 * touch from the section around it, and with no `onLongPress` of its own it fires `onPress` on
 * release however long the hold, so the section's long press never runs. A Pressable inside a
 * section reads this context and adopts the section's long press when it has none, so a hold opens
 * the section's menu and a tap still does what the card does.
 */
export type SectionLongPress = { onLongPress: () => void; delayLongPress: number };

export const SectionLongPressContext = createContext<SectionLongPress | null>(null);

/** A Pressable's own long press always wins; the section's fills in only where it has none. */
export function withSectionLongPress<P extends object>(props: P, section: SectionLongPress | null): P {
  if (!section || (props as { onLongPress?: unknown }).onLongPress != null) return props;
  return { ...props, onLongPress: section.onLongPress, delayLongPress: section.delayLongPress };
}
