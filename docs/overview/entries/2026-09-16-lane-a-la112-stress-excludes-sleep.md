# 2026-09-16 — Lane A · LA-112: daytime stress stops counting the night

**Branch:** `lane-a/la112-stress-excludes-sleep` · **v1.457.2**

TN-39's validation (merged earlier today) measured that **277 of 672** stress buckets fall inside a
recorded sleep session and **28 of the 140** counted as high-stress — so a fifth of the
`stress_high_minutes` the app calls *daytime* stress was recorded while the owner was asleep. This
fixes it.

## The fix is one filter, and WHERE it sits is the whole point

`buildDaytimeStressSeriesFromModel` now takes the sleep windows overlapping its range and drops those
buckets **before** `scoreStressPoints`, not after.

That ordering is the fix rather than a detail. `scoreStressPoints` calibrates against the
**day-median dHRV across whatever it is handed**. A sleeping bucket has a low heart rate, and
`hrCoef` is negative, so its imputed dHRV is *high*. Leaving sleep in raises the median — and every
waking bucket is then scored as sitting below baseline, i.e. stressed. **Filtering only the summary
would have removed the sleeping buckets from the count and left the waking ones still mis-scored.**
A test pins exactly that: the mutant that filters after scoring passes every other assertion in the
file.

## Two things found while doing it

**The sibling surface was already right.** `/api/body-battery` computes its series from
`wakeTime → now`; only the rollup used `aestMidnight(d) → aestMidnight(d+1)`. When BF-81 made the
rollup the single writer — to stop two producers disagreeing — it also adopted the rollup's
whole-day window. So this is closer to restoring semantics the app already had on one surface than to
choosing new ones. The route now passes its windows too, so the two agree *by construction* rather
than by coincidence of window: `wakeTime` falls back to the first HR reading and then to 07:00, and
either fallback can open the window before the owner actually woke.

**A day needs BOTH its nights.** Sleep rows are keyed by wake date, so filtering on
`sleepByDate.get(day)` alone would catch the night that ended this morning and miss the one starting
tonight. The owner's buckets ran densest in Brisbane 00:00–06:59 *and* 22:00–23:59 — that evening
tail is the second night. The rollup now filters on every window overlapping `[dayStart, dayEnd)`.

**The windows are read, not taken from the pass.** `sleepRows` only covers the nights the current
rollup pass reconstructed, while the stress series is recomputed over a fixed trailing 21 days — so
deriving the windows from the pass would make a day's stress depend on how wide the pass happened to
be. `RollupIO` gained `readSleepWindows(from, to)`, bound to the repository's existing
`listSleepSessions` rather than reimplemented (rollup-io's own rule for operations that aren't plain
slice calls).

## The parameter is required on purpose

`sleepWindows` has no default. A `= []` would read as "no sleep to exclude" at a call site that
simply forgot — the silent-omission shape CLAUDE.md's day-window rule already names. It worked: the
three existing tests failed loudly on the un-updated call, which is what a default would have hidden.

## What this does and does not change

**History self-heals within ~21 days.** The resilience loop recomputes the trailing
`RESILIENCE_MAX_DAYS = 21` summary rows on every rollup pass and rewrites their buckets and scalars,
so stored days inside that window are corrected by the next pass. Days older than that keep their old
values until a wide pass covers them.

**The size of the change could not be predicted before shipping.** Only `level` is persisted, never
`dhrv`, so the corrected levels cannot be recomputed from stored data — the median has to be rebuilt
from the raw inputs. The direction is certain (fewer waking buckets scored below baseline on
sleep-heavy days); the magnitude will be visible in the owner's numbers after the next rollup.

**The mechanism is read from the code, not inferred from the correlation.** Days whose buckets are
mostly sleep do flag 2.5× more of their *waking* buckets as high-stress (0.397 vs 0.158, corr
**+0.697** over 24 days) — but sleep share and waking-bucket count are **−0.95** collinear, so that
correlation cannot separate "the median is contaminated" from "fewer waking buckets, noisier share".
It is recorded as corroboration, not as the evidence. The evidence is that `scoreStressPoints` takes
a median over everything it is given.

## Verification

- `pnpm test` **924 files / 8770 tests** green (with `DATABASE_URL` set). `pnpm check:rules`
  **75 of 75**. Typecheck and lint clean (0 errors).
- **Mutation pass, 3 mutants, all killed:** filter-after-scoring, no-filter, inverted predicate.
  **Equivalent control** (hoisting the filter into a named const) stayed green. The first mutant is
  the one that matters — it is the naive version of this fix, and only the re-scoring test rejects it.
- Four new tests, including a control: a day whose recorded sleep does not overlap the window must
  come out byte-identical, which a change that merely lowered every level would fail.
- `pnpm dev`: `/api/body-battery` compiles and returns 401 unauthenticated.

**Not exercised.** The authenticated body-battery path and the rollup's own stress step never ran:
the sandbox cannot mint a session, and `daytime-stress-buckets.test.ts` records that the full rollup
pass "cannot run in this sandbox at all — it needs vendored constants". So `readSleepWindows` is
called only on a path no sandbox test reaches; what holds it is the typecheck on `RollupIO` and the
unit tests on the function it feeds. No device, no APK. Every production figure quoted is the owner's
rows only (`claude_ro` is row-scoped).
