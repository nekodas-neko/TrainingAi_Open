# 2026-08-19 — Zone minutes and movement-per-hour, coverage-checked (Q-522, Q-523)

**Agent:** Tuning 🎶 · **Branch:** `tuning/zone-minutes-move-hours-coverage` · **Docs-only.**

The owner asked directly for the check Q-521 had deferred. Both inputs turn out to be unusable, and
they fail in opposite directions — one pinned at the top of its range, one at the bottom.

## What was found

**`moveHours` is saturated (Q-522).** Over 59 days with waking-hour HR, **856 of 857 waking hours
that had any data at all counted as "moved"**, and **48 of 59 days score exactly 100**. The
contributor's only source of variance is hours the ring was off the finger. `computeMovedHours`
counts an hour whose HR exceeds `HR_REST_THRESHOLD = 0.05` of reserve — **59.7 bpm** here — and the
owner's waking HR is ring p50 **69**, p90 **88**.

`hourly-movement.ts` carries a comment recording Q-188 fixing this exact contributor for being
*"pinned at 100… it could never carry information"*. Q-188 fixed the **denominator**; the
**numerator** now saturates for an unrelated reason. **The earlier fix could not have prevented
this** — it is the same symptom through the other half of the fraction, and the sixth instance this
session of *the threshold is right, the input is wrong*.

**`zoneMinutes` is floored (Q-523).** **0 active minutes on 53 of 59 days**, mean 1.39 against a goal
of 22. Not a sampling artefact: the chest strap is worn for workouts, samples at ~1 Hz, and its
**p99 is 121 bpm** against a Zone 2 floor of **133**. This is Q-516's finding (`PEAK_BANDS` is
calibrated for a range strength training never reaches) in a second consumer of the same banding.
The existing `zoneMinutes === 0 && strengthSessionToday` guard fires on 40 of 44 strength days, but
**13 of 15 non-strength days score a hard 0** and lose 10 points of weight.

**A third, separable defect.** `DEFAULT_MAX_GAP_SEC = 120`, and its comment says a ring "samples
~1/min". This ring samples on an **exact 300 s cadence** (p50 = p90 = 300.0 s), so **80.1% of its
intervals are truncated** and it keeps **35%** of elapsed time against the chest strap's **84%** —
the same effort is worth 2.4× more on a strap day. Only 26 of 59 days have strap data, so zone
minutes are not comparable across days even after the floor is fixed.

## What it changes

Q-521's Body Battery brief proposes drain from steps, HR above rest, workout load **and zone
minutes / movement**. Two of those four would enter as constants (≈ 1.0 and ≈ 0) while reading, in
review, as working terms. Q-521 now carries a note to **build the first slice on steps + workout
load only**. Steps remain the only movement input with full coverage, which reinforces rather than
relieves that entry's `active_calories` caveat.

## Deliberately not done

No candidate Zone 2 floor is proposed. Fitting one needs days the owner would call "active" to fit
against — owner labels, not more SQL — and guessing a number into the code is how the current one
got there. Written into Q-523 as the open question instead.

## Also in this PR

- `docs/domains/activity/README.md` — the Metrics row pointed at `lib/health/activity-score.ts` and
  `hourly-movement.ts`; both live in `packages/shared/src/health/` since the monorepo extraction
  (the Q-153 stale-path shape). Corrected, and `zone-minutes.ts` added.

## Files

- `docs/reviews/2026-08-19-zone-minutes-move-hours-coverage.md` (new)
- `docs/implementation-backlog.md` — Q-522, Q-523 inserted ahead of Q-521; Q-521's deferred caveat
  replaced with the measured result
- `docs/domains/activity/README.md`, `docs/domains/heart-rate/README.md`
- `scripts/check-doc-index-size.js` — backlog baseline 10519 → 10608
- `docs/agents/state/tuning.md`

## Not exercised

Docs-only; no code path changed. All measurement is `claude_ro` via `/api/admin/db-query`, which is
**row-scoped to the owner** — every count is the owner's, and zone floors are the most
person-specific constant in the app. n = 59 days, one athlete.
