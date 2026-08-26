# 2026-08-26 — two finished readiness entries leave the queue (Q-500, Q-504)

**Branch:** `docs/retire-resolved-readiness-entries` · **Lane A** · docs-only

## Why they were still there

Both were finished and neither had been struck, so `next-item.js` kept offering them as work.

- **Q-504** says so in its own title — *"REFUTED"* — and in its first bullet: *"Resolved the same
  day, by implementing it and finding it wrong."*
- **Q-500** shipped `RECOVERY_INDEX_OPTIMAL_HOURS = 5` on 2026-08-18 and carried one follow-up, which
  #554 established is both already done and answered *"do not re-anchor"*.

A finished entry in the queue is not inert: it is offered ahead of real work, and Q-500's stale
follow-up in particular reads as an instruction to move a scoring constant that Q-509 has explicitly
said not to move.

## Removing them would have buried the reasoning, so it was moved first

Q-504's value is entirely negative knowledge — *readiness must not get a range calibration, and here
is the measured reason*. That reasoning lives in
`docs/reviews/2026-08-18-readiness-range-refuted.md`, which **was not linked from the readiness
domain index**. Deleting the queue entry would have left it findable only by someone who already knew
it existed.

It is now linked from `docs/domains/readiness/README.md` with the three invariants the calibration
broke (contributions stop summing to the displayed score; all-neutral input gives 35 instead of 50;
skipping the check-in can reach 100), why the in-model lever fails differently, and the measurement
that says there is no compression bug at all — contributors at sd 17–32 against a composite sd of
~11–13, where independence predicts 7.7.

## Dangling references, handled by kind rather than by sweep

Eight prose references to the two entries remain elsewhere in the backlog. Most are **cautionary**
(*"the Q-504 failure mode in a new costume"*), and those still read correctly now that the review is
indexed — a reader following one arrives somewhere better than the old entry.

**Two were sequencing instructions and did not survive**: *"Settle Q-500 first"* and *"Do this before
the calibration items (Q-500, …)"* would send a session hunting for a removed entry. Both now point
at **Q-509**, the live successor, and say what changed — including the part that still holds:
re-cutting readiness weights before Q-509 lands still means doing it twice, because a smoothing
change moves the contributor even though an anchor change is off the table.

## Verification

Docs-only. `pnpm check:rules` **Ran 59 of 59**; `check-backlog-pointers` clean at **199 entries**;
`check-index-doc-paths` **923 paths all exist**; both edited files within their size baselines (the
backlog shrank by 75 lines, and its baseline is deliberately left alone — see the 2026-08-26 note in
`doc-size-baseline-history.md`).
