/**
 * Q-420 — a session's intensity, derived from the set ratings that already exist.
 *
 * The owner has said twice that they cannot judge a session as one number and can judge a set, and
 * the fill rates agree: **20 of 78 completed sessions carry a session RPE (26%) against 625 of 1,047
 * rated sets (60%)**. Twenty-four completed sessions carry rated sets and no session rating, so
 * deriving takes coverage from 20 to 44 with nobody tapping anything new.
 *
 * **The plain mean, rounded — nothing cleverer, deliberately.** It is a sentence the owner can check
 * against their own memory: *"your sets averaged 7.5, so the session is an 8."* Two alternatives were
 * costed in the entry and rejected: weighting hand-changed sets above prefill-agreeing ones moves the
 * result by ~0.2 of a point and cannot be explained in one sentence, and fitting a curve to the 20
 * paired sessions is fitting to a target the owner has said is unreliable (across all 20 they used
 * only 7, 8 and 9 — range compression is what a scale someone cannot judge looks like from outside).
 *
 * **It stays in SET-RPE units (6–10) and is NOT mapped onto the 1–10 session scale.** Mapping would be
 * inventing precision between two instruments that measure different things — per-set RPE is
 * proximity to failure on that set, Foster's session RPE is global exertion across a session. Since
 * the session number is the one the owner cannot judge, the derived value should stay in the units it
 * was actually measured in. That `'easy'` is unreachable for strength is the correct outcome, not a
 * bug: a logged lifting session where every set sat at 6 or above is not an easy session.
 */
export function deriveSessionRpe(setRpes: readonly (number | null | undefined)[]): number | null {
  const rated = setRpes.filter((r): r is number => typeof r === 'number' && Number.isFinite(r))
  if (rated.length === 0) return null
  return Math.round(rated.reduce((sum, r) => sum + r, 0) / rated.length)
}

/** Which instrument a session's effort number came from — they are not the same scale (see above). */
export type SessionRpeSource = 'self' | 'derived'

/**
 * The session's effort number and where it came from.
 *
 * A self-reported rating always wins, and a derived one never overwrites it — that is the whole of
 * the owner's *"can be overwritten if needed"*, and it needs no flag and no re-derive rule because
 * **nothing is stored**. `session_rpe` remains purely self-reported; the derived value is computed
 * from the set logs on every read, so it cannot drift from them and a later set edit is reflected
 * for free.
 *
 * That is a deliberate departure from the backlog entry, which proposed a stored column plus a
 * source flag plus a rule about when a re-derive may overwrite. CLAUDE.md's **Stored Counters** rule
 * is explicit that every stored counter in this project has drifted and that counts should be derived
 * at read time — and the entry's own anxiety about a re-derive silently eating a manual correction is
 * precisely the drift that rule predicts. Deriving on read removes the column, the flag, the rule and
 * the hazard together.
 */
export function sessionEffort(
  selfReported: number | null | undefined,
  ratedSetRpes: readonly (number | null | undefined)[],
): { rpe: number; source: SessionRpeSource } | null {
  if (typeof selfReported === 'number' && Number.isFinite(selfReported)) {
    return { rpe: selfReported, source: 'self' }
  }
  const derived = deriveSessionRpe(ratedSetRpes)
  return derived == null ? null : { rpe: derived, source: 'derived' }
}
