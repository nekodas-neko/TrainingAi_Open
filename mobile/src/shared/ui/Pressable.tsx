import { useContext, type ComponentProps } from 'react';
import { Pressable as NativePressable } from 'react-native';
import { SectionLongPressContext, withSectionLongPress } from './sectionLongPress';

/**
 * React Native's Pressable, plus the long press of the section it sits in when it has none of its
 * own (see `sectionLongPress.ts`). Outside such a section it is exactly React Native's.
 */
export function Pressable(props: ComponentProps<typeof NativePressable>) {
  const section = useContext(SectionLongPressContext);
  return <NativePressable {...withSectionLongPress(props, section)} />;
}
