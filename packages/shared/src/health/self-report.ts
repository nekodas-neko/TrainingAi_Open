/**
 * An untouched scale is not an answer (TN-57).
 *
 * The morning check-in sheet seeds `perceivedRecovery` and `sleepQualityFeel` from a neutral
 * constant and tracks whether the lifter actually moved each one. Both the value and the flag are
 * posted, and both are stored — the row has always been honest. What was not honest was every
 * reader: each took the seeded 3 as a self-report.
 *
 * The schema said so when the columns were added (Q-113): *"a calibration query must filter on
 * these before trusting perceivedRecovery/sleepQualityFeel as real self-report."* Nothing did.
 *
 * Measured on production 2026-09-22, over 97 morning check-ins since 2026-07-02: **78 carry a
 * `perceived_recovery` and 0 of them were touched**, across 2 distinct values with a standard
 * deviation of 0.286. `sleep_quality_feel` was touched 3 times. These are the owner's rows only —
 * `claude_ro` is row-scoped — and he said as much unprompted: *"I dont really choose them; I let it
 * auto select."*
 *
 * So a calibration route was calibrating against 78 values nobody gave, a user-facing correlation
 * was plotting them, the score audit was displaying them, and the periodization prompt was telling
 * the model the lifter had reported them.
 */

/** The two morning scales that carry a touched flag. Nothing else on the check-in has one. */
export interface MorningSelfReport {
  perceivedRecovery: number | null
  sleepQualityFeel: number | null
  perceivedRecoveryTouched: boolean
  sleepQualityFeelTouched: boolean
}

/**
 * The scales as the lifter actually answered them: a value, or null where the seed was left alone.
 *
 * Every reader of these two columns goes through this rather than reading the column directly, so
 * "did they answer?" is decided in one place and a new reader inherits it. The return type omits
 * the flags deliberately — a caller that has already resolved the answer has no further use for
 * them, and passing them on invites a second, divergent check.
 *
 * **On the two write paths, ORDER matters, and getting it wrong drops the check-in.** Both call
 * this AFTER `dayCheckinHasAnswers` (Q-465), never before. The morning sheet posts only these two
 * scales, `illnessContext`, an empty `soreMuscles` and a null journal — so nulling first would make
 * an untouched morning save carry no answers at all. On the web route that is a 400; in
 * `pushMutations` the same guard rejects the mutation as a poison pill with no retry, dropping it
 * permanently. And the sheet re-prompts until a row exists for the day, so the owner's daily
 * check-in would have stopped reaching the server entirely. Submitting the sheet IS an act worth
 * recording; what it is not is a self-report.
 */
export function answeredMorningScales(
  c: MorningSelfReport,
): { perceivedRecovery: number | null; sleepQualityFeel: number | null } {
  return {
    perceivedRecovery: c.perceivedRecoveryTouched ? c.perceivedRecovery : null,
    sleepQualityFeel: c.sleepQualityFeelTouched ? c.sleepQualityFeel : null,
  }
}
