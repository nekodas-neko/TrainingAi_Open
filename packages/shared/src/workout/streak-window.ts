/**
 * BF-176. How far back the streak surfaces look, in calendar days.
 *
 * This number is a CONTRACT between two files that used to disagree silently:
 * `app/api/streak-data/route.ts` decides how many days of `trainedDays` to send, and the loop in
 * `app/session-select/session-select-content.tsx` decides how far back to walk. The route sent
 * **90** and the loop walked **365**, so past day 90 every lookup returned `undefined` — which the
 * loop reads as a rest day, not as missing data.
 *
 * **The failure is worse than a clipped number, and it is why this constant exists rather than a
 * larger literal in one file.** Once the real streak exceeds the window, the count stops describing
 * the lifter and starts describing *where the window edge lands*. The owner's streak went 90 → 89
 * **on a day he trained**: the edge slid off a rest day onto a trained one, and the day that fell
 * out of the payload was the trained one. It would have oscillated between ~88 and 90 for as long
 * as he kept training.
 *
 * So a supplier that sends less than the consumer walks does not under-report by the difference —
 * it reports a property of the window. Any new streak surface reads this constant.
 */
export const STREAK_LOOKBACK_DAYS = 365
