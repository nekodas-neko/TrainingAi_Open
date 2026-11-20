// How text follows the system font size, matched to the current app (#3912).
//
// The current app is an Android WebView, and WebView scales all text by the system font scale,
// smaller as well as larger: Capacitor never calls setTextZoom, so AwSettings starts the text
// zoom at fontScale × 100 and aw_settings.cc applies it with SetTextZoomFactor. On the owner's
// phone (font scale 0.9) the current app draws every label at 90% of its CSS size. Preview's
// tokens equal those CSS sizes, so Preview follows the same factor and the two apps match at any
// setting. Above MAX_TEXT_SCALE Preview stops growing, because fixed-height rows, tiles and chart
// axes clip their text past it.
//
// Before #3912 (from #3002), text never drew below its token size, on the belief that WebView
// only enlarges text. That made Preview about 11% larger than the current app at 0.9. To go back,
// restore these two bodies:
//   textScale:  return Math.min(MAX_TEXT_SCALE, Math.max(1, fontScale));
//   scalesText: return fontScale >= 1;

/** The largest factor any text is drawn at, whatever the system font size. */
export const MAX_TEXT_SCALE = 1.3;

/** The factor text is actually drawn at for a system font scale. */
export function textScale(fontScale: number): number {
  if (!Number.isFinite(fontScale) || fontScale <= 0) return 1;
  return Math.min(MAX_TEXT_SCALE, fontScale);
}

/** Whether a Text should apply the system font scale itself: always, as the WebView does. */
export function scalesText(fontScale: number): boolean {
  return Number.isFinite(fontScale) && fontScale > 0;
}
