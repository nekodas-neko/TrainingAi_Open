# 2026-09-21 — the self-report has never been answered, and that is why tuning cannot be accurate

**Branch:** `tuning/checkin-label-has-no-answers` · **Agent:** Tuning · **Docs-only.**

The owner asked what would make tuning more accurate. The answer turned out to be measurable in one
query, and it explains why every calibration in this repo has been fitted to internal consistency.

## Measured, 96 check-ins over 81 days

| | |
|---|---|
| rows with a `perceived_recovery` value | **77** |
| rows where `perceived_recovery_touched` is true | **0** |
| distinct values ever | **2** (2 and 3) |
| standard deviation | **0.29** |
| `sleep_quality_feel_touched` | **3 of 96** |

The control that scores 10% of readiness, and is the only candidate ground truth in the app, has
**never once been answered** — exactly as the owner said unprompted a fortnight ago (*"I dont really
choose them; I let it auto select"*). The column that distinguishes answered from unanswered already
exists, is populated correctly, and reads zero.

## The defect is not what I first wrote down

I drafted this as circularity — the control pre-filled from readiness, feeding the model its own
output. **It is not.** `components/morning-checkin-sheet.tsx:21` seeds from a neutral constant
(`NEUTRAL_SCALES = { perceivedRecovery: 3 }`), tracks `touched` correctly, and posts both. The
circular one is the separate *energy* check-in, `readinessToEnergy()` in `mood-checkin-sheet.tsx`
(TN-50). Two sheets, two defects; filing them as one would have sent an implementer to the wrong file.

**The real defect: an untouched default is persisted and then read as an answer.** Three consumers,
none of which checks the flag in the same row:

1. `app/api/admin/battery-recovery-calibration/route.ts:83` — a **calibration** route builds
   `recoveryByDate` from it. It is being calibrated against 77 values nobody gave.
2. `app/api/health-trends/route.ts:136` — filters `!= null`, then correlates against readiness.
   A correlation against a series with sd 0.29 is not a coefficient, and it is shown as one.
3. `app/api/body-battery/stress-day/route.ts:17` — its own comment already says
   *"`perceived_recovery` reads 3 on all 17 days"*. The observation was made; the flag was not used.

Q-465 already closed the adjacent case (an empty body writing all-null). This is the case a
**non-empty** body carrying an unanswered value slips through.

## Why it is the root cause rather than one bug

TN-33 cannot validate the daytime-stress **sign** without an independent target that varies. That
blocks TN-16's warning, TN-34's re-wire, and the stress weight TN-55 measured at **61% of all Body
Battery drain** — which is currently de-weighted precisely because the sign is unknown. One missing
label holds up the whole chain.

## Filed

- **TN-57** (Lane A, top of its queue) — make the three readers require the `*_touched` flag, then
  store `null` for an untouched scale. **No migration and no data write**: the flag already separates
  the two populations, so backfilling buys nothing and destroys the record of how long this ran.
  Expect the health-trends correlation to *disappear* rather than change; there are zero answered rows
  to plot, and that is the correct outcome, not something to fix by relaxing the filter.
- **TN-58** (Lane B, its only READY item) — replace the absolute 1–5 with a comparative
  *better / same / worse than yesterday*, no default and no pre-selection. Three taps on a sheet he
  already sees. Comparative judgments produce variance by construction, and **pairwise orderings are
  enough to validate a metric's sign and ranking** — which is exactly what TN-33 needs, without
  calibrated absolute values. The owner declined a three-week daily log this morning; that decline is
  the design constraint this works within, not an obstacle to argue with.

Its pass test is falsifiable in a fortnight: ≥3 distinct values and a touched-rate above zero. If it
fails, the finding is that self-report is not available from this owner at all — worth knowing, and
cheap to learn.

## Not exercised

Nothing runs; documentation only. The production read is one query through `/api/admin/db-query`,
**row-scoped to the owner**, which is the right scope since the claim is about his own answers. I have
**not** verified that no fourth consumer reads `perceived_recovery` without the flag — the three named
came from a grep of `app/`, `components/`, `lib/` and `packages/`, and TN-57's implementer should
re-grep before calling it complete. `pnpm check:rules` **Ran 75 of 75**, all passed.
