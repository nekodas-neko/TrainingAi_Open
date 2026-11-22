import { sizes, spacing } from '../theme/tokens';

// #3760. Every page header, a plain bar or a health hero, takes its size, padding and Back
// control from here, so the title and the Back icon sit in the same place on every screen.
// The page sits under the status bar's inset; these offsets start below it.
export const headerMetrics = {
  /** Every tab's title, and every other page's: 20 bold. One constant, so no tab picks its own. */
  titleVariant: 'pageTitle' as const,
  sidePadding: spacing.lg,
  barPaddingVertical: spacing.md,
  /** A tab's header has no rule under it and sits a little lower. */
  landingPaddingVertical: spacing.lg,
  gap: spacing.sm,
  /** The Back control: its left inset and its distance from the top of the page, plain bar or hero. */
  back: {
    left: spacing.lg,
    top: spacing.md,
    /** The control's height: IconButton draws exactly the touch target, so this is that token. */
    height: sizes.touchTarget,
  },
};

/** The default spoken label for Back. A screen overrides it only where Back goes somewhere named. */
export const BACK_LABEL = 'Back';
