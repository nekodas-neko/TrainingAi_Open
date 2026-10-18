/**
 * Retry a hit-test until the tap would land, then tap once (issue 2980).
 *
 * `tapHitTested` used to probe once, straight after a 50 ms stability read. That read proves the
 * target's box agreed with itself across two frames, not that nothing else is still moving: a page
 * that mounts content above the target after its first paint (Cardio's cards, a sheet's body) shifts
 * the target between the read and the probe, and the probe then finds a neighbour at the coordinate.
 * `bf165…:69` failed that way on a PR that did not touch Cardio, twice in one attempt, and passed on a
 * plain re-run of the same commit.
 *
 * So the probe retries inside a short budget and throws only if the tap never lands. That keeps the
 * thing the probe exists for (a real occlusion fails, naming what it hit, instead of tapping air)
 * while no longer treating "still settling" as "covered". Pure, with no Playwright import, so it can
 * be unit-tested.
 */
export interface HitAttempt {
  x: number
  y: number
  /** What `document.elementFromPoint` found: inside the target, and a name for it if not. */
  hit: { inside: boolean; tag: string }
}

export const TAP_LANDS_WITHIN_MS = 5_000

export async function tapOnceItLands(opts: {
  /** Scroll, wait for the box, probe. Called again from scratch on every retry. */
  attempt: () => Promise<HitAttempt>
  tap: (x: number, y: number) => Promise<void>
  /** A short pause between attempts (a frame or two). */
  pause: () => Promise<void>
  now?: () => number
  budgetMs?: number
}): Promise<void> {
  const now = opts.now ?? Date.now
  const deadline = now() + (opts.budgetMs ?? TAP_LANDS_WITHIN_MS)
  let last: HitAttempt
  for (;;) {
    last = await opts.attempt()
    if (last.hit.inside) {
      await opts.tap(last.x, last.y)
      return
    }
    if (now() >= deadline) break
    await opts.pause()
  }
  throw new Error(
    `the tap at (${Math.round(last.x)}, ${Math.round(last.y)}) would land on ${last.hit.tag}, not the target ` +
    `(still the case after ${Math.round((opts.budgetMs ?? TAP_LANDS_WITHIN_MS) / 1000)} s)`,
  )
}
