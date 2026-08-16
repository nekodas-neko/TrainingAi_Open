# 2026-08-04 — Scale weight trend: lowest reading of the day wins (Q-69)

**Branch:** `feat/scale-lowest-reading-trend` · **Domain:** body · **Version:** 1.253.2

## What changed

The day's **first** confirmed scale reading used to set the `body_metrics` weight trend, on the
fasted-morning-weigh-in convention. If that first reading happened to be taken clothed, it was stuck
as the day's value with no correction path short of a manual edit. Now the day's **lowest** confirmed
reading wins: clothes only ever add weight, so a later nude reading comes in lower and replaces the
earlier one. On an ordinary day the fasted morning weigh-in is already the low point, so the common
case is unchanged.

Averaging was considered and rejected in the planning session — it launders a clothed reading into
the trend instead of replacing it, and blending readings taken at different food/water states makes
the trend noisier, not more accurate.

- `hasConfirmedScaleTrendForDate` (boolean) → `getConfirmedScaleTrendForDate` (`{ weightKg } | null`)
- `applyScaleReadingToBodyMetrics` compares instead of skipping; writes only when strictly lower
- `/api/scale-ble/today` resolves the Trend badge by matching the stored value, not by list position

No migration, no native change, no new storage — every reading was already archived to
`scale_raw_samples` unconditionally.

## Two things the plan did not cover

**1. The toast would have started lying.** `isAdditionalReadingForDay` was returned to the native
plugin, which renders **"Additional reading today"** — meaning, in effect, *"this did not change your
trend."* Once a lower second reading can become the trend, that copy is wrong for exactly the new
case. The plan kept the flag's old meaning ("a reading already existed today"), which would have
shipped a misleading toast.

Fixed without needing an APK: the wire field name stays (the installed APK reads it), and its
**meaning** moves to `!trendUpdated`. The existing copy is then correct in every case. The internal
return is `trendUpdated`, which is the question callers actually have.

**2. Ties.** Two readings can legitimately land on the same weight, and value-matching would have
badged both — claiming the trend came from two places. The badge marks at most one row, the earlier
one, which is the reading that actually set it.

## Manual weights

Untouched, and now guarded by two tests. `getConfirmedScaleTrendForDate` filters on
`source_map->>'weight_kg' = 'scale_ble'`, so a manual entry reads as "no scale trend" and the rank
merge (`manual(5) > scale_ble(4)`) keeps owning it. Without that filter a low scale reading would
compare against a manual value and try to replace it.

## Verification

- **23 tests** across three files, plus a new 6-test route file for the badge.
- **Mutation-checked, not just green.** Reverting the badge to `i === 0` fails 3 of its 6 tests;
  loosening `>=` to `>` in the comparison fails the equal-reading no-op test. The tests catch the
  bugs they claim to.
- Full suite, typecheck, lint at baseline.
- `pnpm dev`: POSTed a first reading, a higher second, and a lower third to
  `/api/scale-ble/samples`, and confirmed both `body_metrics` and the `/api/scale-ble/today` badge
  followed the lowest.

## One nuance found while testing, deliberately not fixed

`trendUpdated` means "this reading was written", not "this reading won". When a **manual** weight
already exists for the day, `getConfirmedScaleTrendForDate` correctly returns null, the write goes
ahead, and the rank merge then rejects it — so `trendUpdated` reads true while the stored trend did
not move. Verified end to end: a 70.0 kg reading against a manual 80.0 left 80.0 standing.

Knowing the difference would mean reading `body_metrics` back after every scale write, for a toast
nuance in a case that only arises when the owner has already entered a weight by hand that day. **The
behaviour here is identical to before this change** (the first-of-day path had the same property), so
it is not a regression — recorded rather than fixed.

## Not verified

The **native toast** — the copy is now correct by construction (the flag means what the string
says), but no APK was built and nothing was seen on device. Also unexercised: the pending-confirm
path (`/api/scale-ble/pending/[id]/confirm`) shares `applyScaleReadingToBodyMetrics` and is covered
by unit tests, but was not driven end-to-end from a real staged reading.
