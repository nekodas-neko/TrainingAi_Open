# 2026-08-26 — Q-500's follow-up was already answered, and the answer is "don't re-anchor"

**Branch:** `docs/q500-followup-superseded` · **Lane A** · docs-only

## What this prevents

Q-500 shipped `RECOVERY_INDEX_OPTIMAL_HOURS = 5` on 2026-08-18 and left one follow-up: *"re-derive
the anchor once ~15 BLE-era nights exist."* Read top-down — which is how a session picks work off the
queue — that is an instruction to wait for data and then move a scoring constant.

Both halves are wrong now:

- **The data arrived long ago.** `oura_daily_summary` holds **50 of 51** BLE-era nights
  (2026-07-07 → 2026-08-26) at mean **2.625 h**. The sample-size condition reads as the blocker and
  has not been one for weeks.
- **The refit was already run, and argued against.** Q-509 did it at n = 42, landed on **3.31 h**,
  and then said not to apply it: the anchor shrank **0.715×** while its input shrank **0.74×**, so an
  anchor moved to match would be absorbing a **multiplicative bias in the estimator** rather than
  correcting a score. Its own words: *"Do NOT move `RECOVERY_INDEX_OPTIMAL_HOURS`."*

So the next session to take Q-500 would have re-derived an anchor another entry had already told them
not to apply. Both entries now say so, and Q-509 carries the fresher number.

## Re-measured, and the finding is stronger than when it was filed

Eight more nights since Q-509's window moved the mean by **0.03 h** (2.657 at n = 42 → 2.625 at
n = 50). The level shift is not a small-sample artefact, and waiting for more data will not change
the answer — which is worth stating, because "get more data" is the reflex this entry pair invites.

The real work item is unchanged and is Q-509's: smooth the BLE HR series to Cloud-like noise *before*
the argmin and re-measure the ratio. If it goes to ~1.0 the estimator is fine and the input needed
conditioning.

## A mistake I made getting here, recorded because it nearly shipped

`recovery_index_hours` exists on **two** tables. I counted it on `oura_daily_derived`, got **0
non-null across all 100 rows and the whole history**, and drew the confident conclusion that the
estimator had never produced anything and Q-500's follow-up was permanently impossible. That was
written down and one step from being filed.

Q-509's own `n = 42` contradicted it, which is what forced a re-check: the populated column is
`oura_daily_summary.recovery_index_hours`; the derived one is a known always-null column.

This is the same shape as the `n_live_tup` error that got Q-528's predecessor retracted — **a number
from the wrong source is not a weaker fact than a right one, it is a different claim entirely**, and
it arrives with the same confidence. The caution is now on Q-500 next to the follow-up, where someone
about to measure this will read it.

## Verification

Docs-only. `pnpm check:rules` **Ran 59 of 59**; both files within their size baselines (no raise
needed); production figures pulled live from `claude_ro`.

**Stated precisely:** `claude_ro` is row-scoped to one user, so every count here is **the owner's**
rows. That is the right population — they are the only ring wearer — but it is not a statement about
any other account.
