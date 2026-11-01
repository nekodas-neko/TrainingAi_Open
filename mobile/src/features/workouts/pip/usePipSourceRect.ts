import { useCallback, useEffect, useRef } from 'react';
import type { View } from 'react-native';
import { pictureInPicture } from '../../../integrations/pip/platform';

/**
 * Where the picture-in-picture window shrinks out of (#3266): the on-screen rest ring or set card.
 * Put `ref` and `onLayout` on that view. It reports its place in the window on layout, and takes it
 * back when it goes, so a screen with no such view lets the system use its own animation.
 */
export function usePipSourceRect() {
  const ref = useRef<View>(null);
  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) pictureInPicture?.setSourceRect(x, y, x + width, y + height);
    });
  }, []);
  useEffect(
    () => () => {
      pictureInPicture?.setSourceRect(null, null, null, null);
    },
    [],
  );
  return { ref, onLayout };
}
