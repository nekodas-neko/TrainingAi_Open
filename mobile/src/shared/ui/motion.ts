/**
 * Every duration, easing and spring speed the app's own motion uses (#3758). A component reads its
 * value from here and never writes a number of its own, so a change of pace is made in one place
 * (tests/motion-one-home.test.ts holds the line). Motion that is paced by content, such as a row
 * that scrolls itself at a speed, is not in this file.
 * No React Native import: this file is read by plain tests.
 */
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export const MOTION = {
  /** A screen opening slides in from the right; Back slides it out the same way. */
  screen: { duration: 220, easing: easeOutCubic },
  /** Switching tabs: a short cross-fade, no slide. */
  tabFade: { duration: 120 },
  /** A moving screen or tab that nothing reported finished (a lost callback) is released after this. */
  navGuard: { duration: 800 },
  sheet: {
    open: { duration: 240, easing: easeOutCubic },
    close: { duration: 180 },
  },
  undoNotice: { duration: 180 },
  /** LayoutAnimation for a row or card that opens, closes or reorders. */
  layout: { duration: 180 },
  disclosureIcon: { duration: 180 },
  progressFill: { duration: 240 },
  /** The weather background changing scene. */
  backdropFade: { duration: 800 },
  /** Animated.spring `speed`, by what is being settled. */
  springs: {
    sheetRelease: 25,
    swipeReveal: 25,
    segmentedControl: 25,
    pageDots: 25,
    sortableStack: 32,
    press: 35,
  },
} as const;
