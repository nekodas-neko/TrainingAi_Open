/**
 * Whether a tab tap can navigate at all (Q-555).
 *
 * Offline, the tab bar's tap is `router.push`, whose RSC fetch has to come from somewhere. The
 * service worker is that somewhere — and there is a window on the **first-ever load** where it is
 * not yet in control, because it registers *during* that navigation and claims only afterwards. In
 * that window the push aborts and nothing happens: measured with Playwright, the URL does not
 * change, no offline page appears, and there is no feedback of any kind. A tap that does nothing
 * silently is indistinguishable from a frozen app, and on the APK the worker IS the offline
 * cold-start mechanism, so install day is exactly when a user is most likely to be moving between
 * networks.
 *
 * **Both halves are required, and neither alone is the bug.** With a controller, offline navigation
 * works — the review measured a tab tap painting ~101% of the online content from cache. Online with
 * no controller is a normal first load. Only the pair fails.
 *
 * **Why not just let the browser navigate.** The obvious fix is to stop suppressing the click, but
 * these are `next/link` anchors: Next's own handler intercepts and calls `router.push` regardless, so
 * there is no native navigation to restore. Forcing one (`location.assign`) does work — measured, it
 * lands on Chrome's own error page — but that throws away the cached screen the user is looking at,
 * which offline is the one thing that still works. Staying put and saying why is strictly better.
 */
export function navigationWouldBeSilent(nav: {
  onLine: boolean
  serviceWorker?: { controller: unknown } | undefined
}): boolean {
  return !nav.onLine && !nav.serviceWorker?.controller
}

/** Reads the live browser state; `false` anywhere `navigator` is absent (SSR). */
export function tabTapWouldBeSilent(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigationWouldBeSilent(navigator)
}
