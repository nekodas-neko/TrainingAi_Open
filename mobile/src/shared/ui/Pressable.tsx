import { useContext, type ComponentProps } from 'react';
import { Pressable as NativePressable, type StyleProp, type ViewStyle } from 'react-native';
import { dimsOnPress, withPressedOpacity, type PressFeedback } from './pressFeedback';
import { SectionLongPressContext, withSectionLongPress } from './sectionLongPress';

/**
 * React Native's Pressable with the app's pressed look and, inside a section that has one, the
 * section's long press (see `sectionLongPress.ts`).
 *
 * It dims while pressed (`pressFeedback.ts`) unless the caller's own style already sets a pressed
 * opacity. `feedback="none"` turns that off for a control whose selected state changes on press
 * and for anything inside a drag. Feature code imports this one, never React Native's
 * (`scripts/check-mobile-shared-pressable.js`).
 */
export function Pressable({
  feedback,
  style,
  ...props
}: ComponentProps<typeof NativePressable> & { feedback?: PressFeedback }) {
  const section = useContext(SectionLongPressContext);
  return (
    <NativePressable
      {...withSectionLongPress(props, section)}
      style={
        dimsOnPress({ ...props, feedback })
          ? (withPressedOpacity(style) as (state: { pressed: boolean }) => StyleProp<ViewStyle>)
          : style
      }
    />
  );
}
