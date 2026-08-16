# ACWR + formula consolidation — one training-load number, one 1RM

> Source: post-update review 2026-07-04 (formulas pass). Addresses the long-standing
> "ACWR defined two incompatible ways" note in CLAUDE.md, now made concrete and
> worse (four live band-threshold sets). Anchors verified against `main`; **re-grep
> before editing**. Ships as **one PR** (correctness fix to shipped features → patch
> bump, merge-gate-exempt — but the ACWR value changes on-screen, so verify the new
> number against the canonical helper carefully).

## Context / root causes

The same user's ACWR is computed **two different ways** and banded with **four
different threshold sets** simultaneously, so the Home widget can say
"Undertraining" while the Health card says "Optimal" for the same day. Separately,
one 1RM path and the volume/avgReps/intensity trio carry verbatim copies that will
silently desync on any future tuning.

## Task 1 — Retire the inline ACWR in `/api/training-load` onto the shared helper

**The two implementations:**
- **Canonical** — `lib/ai-periodization/acwr.ts:15-46` (`computeVolumeAcwr`), used
  by `readiness-score/route.ts:154-157` and `signals.ts:319-325`. 28-day window
  anchored at **user-local midnight** (`todayMid`); acute = 7d volume sum (deloads
  **included**); chronic weekly avg = total ÷ `max(1, round(spanDays)/7)` (a
  **real-data-span** divisor, explicitly built to fix the flat-÷4 ~2× inflation on
  young programs); null gates span ≥ 21d, ≥ 6 sessions, chronic avg > 100 kg.
- **Inline duplicate** — `app/api/training-load/route.ts:24-79`. Windows anchored at
  `Date.now() − N×86_400_000` (server-time ms offsets — also the forbidden
  date-arithmetic pattern; the 7/28-day boundary straddles two AEST days and the
  band **drifts during the day with no new data**). Acute = 7d incl. deloads;
  chronic = 28d **excl. deloads** ÷ **flat 4**; gates ≥ 4 non-deload sessions.

So the two return materially different numbers for the same day (different window
anchoring, different chronic divisor, asymmetric deload handling).

**Fix:** delete the inline computation and call `computeVolumeAcwr` in the
training-load route, feeding it a 28-day window anchored at `todayMidnightUtc(tz)`
(`tz = session.user?.timezone ?? DEFAULT_TZ`) exactly like readiness-score does. Keep
the route's `getSessionLoadsFrom` SQL aggregate as the session source (it already
provides per-session volume + deload/phase flags — adapt `computeVolumeAcwr`'s input
type or map to it). Decide the **deload-inclusion policy once** — the canonical
helper includes deloads in acute; match it (and drop the route's asymmetric
excl-from-chronic behaviour). This also fixes review finding M13 (rolling ms-offset
windows) as a side effect.

## Task 2 — One `acwrBand()`, consumed everywhere (kills the four-threshold split)

**The four disagreeing band sets today:**
- Route (`training-load/route.ts:73-77`): `>1.5 very_high / >1.3 high / <0.5 low / else optimal`.
- Home widget (`home-card-widget.tsx:259-260`) **re-derives** from the raw number,
  ignoring the route's `interpretation`: `<0.8 Undertraining / <1.3 Optimal /
  <1.5 High / else Very High`.
- Health explainer (`health-sections.tsx:786-792`): documents "below 0.8 =
  detraining" while its route reports low only < 0.5.
- Readiness modifier (`readiness-score/route.ts:61-64`): a fourth "low" threshold at
  < 0.6.

**Fix:** export a single `acwrBand(acwr): { key, label, color }` from
`lib/ai-periodization/acwr.ts` (next to `computeVolumeAcwr`) with one agreed
threshold set — recommend the sports-science-standard sweet spot `0.8–1.3`
(`<0.8 low / 0.8–1.3 optimal / 1.3–1.5 high / >1.5 very high`), matching the Home
widget's cuts which are the most defensible. Then:
- `training-load/route.ts` returns `interpretation` from `acwrBand()`.
- `home-card-widget.tsx:259-260` **consumes** `interpretation` instead of
  re-deriving (per the rule: clients render the route's band, never re-band a raw
  number).
- `health-sections.tsx:786-792` explainer copy updated to the real thresholds.
- `readiness-score`'s modifier: leave the *scoring* curve as-is (it's a distinct,
  intentional non-linear modifier, not a display band) but source any displayed
  band label from `acwrBand()`.

**Verify:** on `pnpm dev`, the Home widget and the Health ACWR card show the **same**
label + colour for the same day; `curl /api/training-load` before/after Task 1 and
compare the ACWR value to `computeVolumeAcwr` run over the same window (they should
now match readiness-score's number for the same day).

## Task 3 — Replace the pure-Epley 1RM in the exercise-stats sheet

`components/workout/exercise-stats-sheet.tsx:113-115` uses pure Epley on the no-style
path — `matchReps = round((current1rm/workingWeight − 1) * 30)` and
`estFn = r => round(workingWeight * (1 + r/30) * 4)/4` — while `lib/1rm.ts`'s
`repFactor` **averages Epley and Brzycki**. At 100kg working weight, pure Epley says
5 reps ⇒ 116.7kg but `calc1RM(100,5)` = 114.5. So the "Match 1RM" rep target tells
the user a rep count that, when logged, produces a *different* saved 1RM than the
card promised.
**Fix:** replace both with the canonical exports — `repMaxFromOneRm`/`calc1RM` from
`lib/1rm.ts` — and use `mround` (0.25 rounding) instead of the inline `*4)/4`.

**Verify:** the "Match 1RM" target rep count, when those reps are logged at the
working weight, yields a 1RM equal to the card's displayed current 1RM.

## Task 4 — Extract the volume/avgReps/intensity trio (dedupe the log/edit paths)

The set-log volume, avgReps, and intensity-% formulas are duplicated verbatim across
`lib/workout/log-exercise.ts:157-178`, `app/api/workout-entry/route.ts:51-74`, and a
third variant in `adapter.ts:128-141` (`computeLbsToKgFix`). They agree today; any
change to the ragged-array fallback semantics desyncs save vs edit. The
`avgReps()` in `pre-workout-screen.tsx:40-44` is a **separate, intentionally
different** calculation — a floored integer for card display (see
`docs/superpowers/plans/2026-07-05-avg-reps-round-down-display.md`) — not the
same value as the stored 1-dp `avg_reps`.
**Fix:** extract `computeSetAggregates({weights, reps})` → `{ volume, avgReps,
intensityPct }` into `lib/workout/` (or extend `lib/1rm.ts`'s neighbourhood), import
it in the log path, the edit PATCH, and the lbs-fix only. Do **not** fold
`pre-workout-screen.tsx`'s display helper into this extraction or replace its
value with the 1-dp stored figure — it must keep computing its own floored
integer (locked by
`components/workout/__tests__/pre-workout-screen-avg-reps.test.ts` once that
lands); the two `avgReps` names refer to deliberately different roundings for
deliberately different purposes.

## Task 5 — Kill the local `DEFAULT_TZ` shadows (LOW, same PR)

`app/api/day-log/route.ts:8` and `app/api/user/bedtime-estimate/route.ts:8` each
`const DEFAULT_TZ = 'Australia/Brisbane'`, shadowing the canonical export from
`lib/date-utils.ts:3`. Import it instead. (One-formula-one-place for the tz default.)

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; extend `lib/__tests__/acwr` (or add
  one) to lock `acwrBand()`'s thresholds and `computeVolumeAcwr`'s value against a
  fixture; extend the 1RM tests for the stats-sheet path if it gets a testable
  helper. Update `lib/__tests__/1rm.test.ts` expectations if any change.
- `pnpm dev` cross-screen check: Home widget vs Health ACWR card show identical
  bands.
- **Not exercisable in sandbox:** real prod-scale session history (the local seed is
  tiny — the ACWR gates may null out; seed synthetic sessions to exercise the bands,
  clear afterward).
- Patch bump + changelog; merge-gate-exempt. Also tick the CLAUDE.md "ACWR defined
  two ways" note as resolved (coordinate with the CLAUDE.md-update entry in this same
  review batch). Remove this backlog entry in the same PR.
