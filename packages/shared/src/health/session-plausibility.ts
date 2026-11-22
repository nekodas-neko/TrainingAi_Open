// Leaf module (no imports) so `running/heart-health.ts` and the phone can share the one bound.

/**
 * The longest a single workout session can plausibly be (LA-21).
 *
 * **Owner-decided 2026-08-24: sessions above this are the app having been left running, and they are
 * to be culled from statistics** — not clamped to the bound, which would keep a number that is partly
 * fiction. Their exercise and set logs are untouched and their VOLUME is real; it is the clock that
 * is wrong, so only the duration-derived figures go.
 *
 * **Measured in production, and the data is unusually clean about it.** Of 81 completed sessions, 11
 * span **534–845 minutes** and **nothing at all sits between 92 and 534** — p50 is 56 minutes. A gap
 * that wide is not the tail of a distribution, so the bound does not have to be a judgement call
 * about how long a hard session might run.
 *
 * **240 is not a fresh number.** `lib/stores/workout-store.ts` already treats a session whose start
 * anchor is over four hours old as abandoned and drops its identity on rehydrate. A *completed*
 * session claiming more than four hours is therefore one the app itself would have refused to resume
 * — reusing that threshold keeps one definition of "too long to be one session" rather than two.
 */
export const MAX_PLAUSIBLE_SESSION_MIN = 4 * 60

/** Whether a session's duration can support a duration-derived number at all. */
export function isPlausibleSessionDuration(durationMin: number | null | undefined): boolean {
  return typeof durationMin === 'number' && Number.isFinite(durationMin)
    && durationMin > 0 && durationMin <= MAX_PLAUSIBLE_SESSION_MIN
}
