import { createContext, useContext, useEffect, useRef, type RefObject } from 'react';
import type { ScrollView } from 'react-native';

/** A count the app raises when the tab already showing is tapped; its page scrolls to the top. */
export const ScrollToTop = createContext(0);

export function useScrollToTop(view: RefObject<ScrollView | null>) {
  const tick = useContext(ScrollToTop);
  // Compared with the last one seen, because a hidden screen's effects run again when it returns.
  const seen = useRef(tick);
  useEffect(() => {
    if (seen.current === tick) return;
    seen.current = tick;
    view.current?.scrollTo({ y: 0, animated: true });
  }, [tick, view]);
}
