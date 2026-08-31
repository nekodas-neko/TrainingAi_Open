import type { BackgroundSection } from '@/lib/stores/background-settings-store'
import type { ScreenPaletteKey } from '@/lib/background/screen-palettes'

/**
 * Which wallpaper a route gets, and which toggle governs it.
 *
 * **Extracted from `dynamic-background.tsx` by BF-75, where both were private.** A second caller
 * now needs the same answer — a sheet that paints its screen's palette has to agree with the
 * wallpaper behind it about which palette that is, and about whether one is showing at all. Two
 * copies of this routing would disagree the first time a route moved, and the failure would be a
 * sheet in one colour over a page in another.
 *
 * The comments below are the decisions, carried over intact rather than re-derived.
 */

// Decision (Batch L chunk 1): the 4 health detail pages (/health/sleep,
// /health/readiness, /health/activity, /health/heart-rate) keep their own
// bespoke DetailHero/PAGE_GRADIENTS art rather than the dynamic wallpaper —
// they already satisfy the per-screen visual-identity goal, and don't need
// any background layer mounted underneath (their root paints an opaque
// gradient of its own). This returns null for them so DynamicBackground skips
// rendering — and skips the weather fetch — entirely.
export function pathnameToSection(pathname: string): BackgroundSection | null {
  if (/^\/health\/(sleep|readiness|activity|heart-rate)(\/|$)/.test(pathname)) return null
  if (pathname.startsWith('/health')) return 'health'
  if (pathname.startsWith('/workout')) return 'workout'
  if (pathname.startsWith('/nutrition')) return 'nutrition'
  if (pathname.startsWith('/more') || pathname.startsWith('/profile')) return 'more'
  return 'home'
}

// Screens rendering a static per-screen palette (chunk 2/3) instead of the
// shared time-of-day/weather sky system, keyed finer than the 5-key toggle
// bucket above so multiple distinct scenes can share one on/off switch (e.g.
// stats gates off the "home" toggle; workout-select gates off
// the "workout" toggle while the actual in-progress /workout screen — which
// paints its own bg-black during the active phase — keeps the shared sky
// scene unchanged). Returns null for Home and the active workout screen.
export function pathnameToPaletteKey(pathname: string): ScreenPaletteKey | null {
  if (/^\/health\/(sleep|readiness|activity|heart-rate)(\/|$)/.test(pathname)) return null
  if (pathname.startsWith('/health')) return 'health'
  if (pathname.startsWith('/nutrition')) return 'nutrition'
  if (pathname.startsWith('/more') || pathname.startsWith('/profile')) return 'more'
  if (pathname.startsWith('/stats')) return 'stats'
  if (pathname.startsWith('/workout-select')) return 'workoutSelect'
  if (pathname.startsWith('/session-explain')) return 'sessionExplain'
  return null
}
