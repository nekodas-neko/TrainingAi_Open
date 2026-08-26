# 2026-08-26 — the window that made an ACWR impossible, and what it was really breaking (Q-512)

**Branch:** `fix/health-insight-acwr-window` · **Lane A** · no migration, no APK.

`app/api/ai/health-insight/route.ts` fetched a **7-day** session list and handed it to
`computeVolumeAcwr`, whose span gate is **21 days** — measured from the earliest session *in the list
it is given*. A 7-day list can never span 21 days, so the gate could never pass. Tuning replayed 110
days and got **0 non-null**: structural, not a coverage problem more history would fix.

## The entry's mechanism was right; its consequence was wrong

Q-512 says *"the route computes the load object and reads `.acwr` from it every time, always null."*
**It does not read `.acwr` at all.** What it reads is `load.typicalSessionVolumeKg` — described in
`score-audit/activity.ts` as *"the volume-lane denominator"* of the activity score.

That changes what was actually broken, and makes it worse rather than harmless:

- **`acwr` being null was inert** — computed and discarded.
- **`typicalSessionVolumeKg` is NOT gated.** It is the median of whatever sessions it is handed, so
  it always returned a number — a median over **one week** where every sibling computes it over
  **four** (`readiness-payload.ts` fetches 28 days). Two heavy sessions in a quiet week set the
  denominator, and the activity score the insight narrates moved with it.

**And it makes one of the entry's two proposed fixes unsafe.** It offered "drop the
`computeVolumeAcwr` call and the `.acwr` read" as an option; dropping the call removes
`typicalSessionVolumeKg` and breaks the activity score. Only widening was ever available.

## Not the one-line fix the entry expected

Widening the fetch to 28 days silently converts `sessions7d` and `volume7dKg` — read by the model as
*"this week"* — into 28-day figures, because they were `recentSessions.length` and a reduce over the
same list. That would trade a structurally-null ACWR for a **wrong session count**, which is the
worse failure: null is visibly absent, a wrong number is not. They now filter back to 7 days
explicitly.

`minSpanDays` was **not** lowered. The entry says so and it is right: that would degrade every
caller's ACWR to rescue one mis-wired window.

## Verified

- **5 tests, stated as properties rather than examples**: no 7-day list clears the gate however dense
  it is; a 28-day one does; the boundary sits exactly at 21/20 so lowering the gate fails loudly; and
  the one that matters — `typicalSessionVolumeKg` comes back **even when the ACWR gate fails**, with a
  worked case where a two-session week sets the median to 9000 and a real month restores it to 5000.
- **Full suite 603 files / 4,926 tests green** — exactly +5. `tsc --noEmit` clean ·
  `pnpm check:rules` **Ran 59 of 59**.

## Not exercised

The replay itself — Tuning's 110-day 0-of-110 figure is taken as given and was not re-run; what was
verified is the mechanism that makes it structural. No migration, no APK, nothing native,
offline-first, safe-area or gesture-related, so **no device smoke run is owed**.
