# 2026-08-08 — "Adequate rest" now requires a measured recovery

**Domain:** heart-rate / workouts — v1.270.26, JS-only (no APK rebuild)

Q-149. Filed this morning as needing an owner decision; the owner handed the call back with a brief:
*the more data-driven and accurate response that sets up a better structure for future*. This is that
call, with the reasoning, because a judgment made on someone's behalf should be inspectable.

## What the measurement said

`set_hr_stats.rest_adequate`, production, 615 rows:

| | |
|---|---|
| non-null verdicts | 278 |
| **true** | **278 (100%)** |
| via the `bpmAtLog < 120 → true` shortcut | **271 (97.5%)** |
| via `hrr1 >= 15` | 7 |
| `bpm_at_end` across the table | min 39 · **max 128** · mean 94 |

The 120 bpm threshold assumes chest-strap-grade end-of-set HR (140–170). The ring power-gates when
worn-idle and samples at 1/min, so the nearest reading within ±90 s of the log is rarely near the
true peak — and the highest it has *ever* recorded at set end is 128. The shortcut could therefore
never not fire.

## The call, and why

**Drop the shortcut. Require a measured `hrr1`. Return `null` when there isn't one.**

- **A constant is worse than an absence.** A reader cannot distinguish a column that is always `true`
  from one that is meaningfully `true`, so a degenerate flag actively misleads — that is how it got
  as far as gating an analysis (Q-11's B2) before anyone checked its distribution.
- **Re-tuning the number would repeat the mistake.** Picking 100 instead of 120 is the same
  population assumption with a different constant, and it would need re-picking the moment the data
  source changes. Requiring the measurement is source-independent by construction.
- **It leaves the better structure available without another change of meaning.** `set_hr_stats.source`
  has been populated since 2026-08-06. When there is enough of it, a per-source or per-user threshold
  can refine *how much* recovery counts — but the column will still mean "measured recovery met the
  bar", which is what it should have meant all along.
- **Honest nulls are cheap here.** The column is nullable, every reader already handles null, and
  `hr-recovery-by-exercise.ts` already returns `null` when no set has a verdict.

Expect far fewer verdicts: **7 rather than 278** on today's data. That is the true coverage of a
question this data can actually answer, and it is better to know that than to read a constant as an
answer.

## What is deliberately not done

**No backfill.** The 278 stored `true` values are not recomputed — that would rewrite history, and
the owner's standing preference this session (Q-139) was fix-forward. Rows computed before this
change remain uninformative; the `computed_at` timestamp separates them, and Q-11's entry records the
distribution so a future analysis can filter. The existing admin backfill can recompute them on
request.

**No change to the 15 bpm figure itself.** Only the escape hatch around it moved. Whether 15 is the
right bar for this user is a separate, still-open calibration question — it just now applies to
something real.

## Verification

`tsc --noEmit` clean · full suite **412 files / 3260 tests, all green**.

Five new tests: a measured drop at the threshold is `true`; one bpm short is `false`; a lone low
reading with nothing 60 s later is **`null`** (the production shape — this was `true` before); a set
under the old 120 cutoff whose HR did not come down is `false` (previously an automatic pass); and no
log time is `null`. **Three of the five fail against the pre-fix implementation**, so they test the
change rather than the harness.

**Not exercised:** no on-device run — this is a pure server-side derivation with no native, safe-area
or gesture surface. No production recompute, by choice (above), so the live column keeps its old
values until a backfill is asked for.
