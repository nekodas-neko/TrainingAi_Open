// How text follows the system font size, matched to the current app (#2994).
//
// The current app is an Android WebView, and Chromium applies the system font scale only through
// its text autosizer, which enlarges text and never shrinks it. So below 1.0 the WebView draws
// text at its CSS size, while React Native shrank every Preview label with the setting: on the
// owner's phone (font scale 0.9) Preview's text was 10% smaller than the current app's on every
// screen. Below 1.0 Preview now draws text at its token size; above 1.0 it still grows with the
// setting, so a larger system font keeps working as an accessibility setting.

/** The factor text is actually drawn at for a system font scale. */
export function textScale(fontScale: number): number {
  return Math.max(1, fontScale);
}

/** Whether a Text should apply the system font scale itself: only when that enlarges it. */
export function scalesText(fontScale: number): boolean {
  return fontScale >= 1;
}
