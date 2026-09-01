# 2026-09-01 — LB-46 closed by measurement, and it casts doubt on BF-64

**Branch:** `fix/lb-46-card-deload-numbers` · **Domain:** `workouts` · **Lane:** B · **No version bump** (docs only)

## LB-46 was not a bug, and the entry's own caveat was the answer

I filed LB-46 while building BF-64: the AI Prescription card showed `4×5 @ 128.75kg (80%)` for an
exercise I had stored as `3×5 @ 60%` — the *pre-deload* figures under a `Deload session` subtitle. I
recorded it with an explicit caveat that the row was hand-built and might be a shape the engine never
emits, and that this should be settled against production before touching code.

Settled. **The card renders the prescription faithfully.** `reevaluateForToday` self-reverts a
per-exercise deload once the soreness that caused it clears — swapping the `preDeload` values back
in, setting `deloaded: false`, and dropping the `preDeload` block. My fixture had no mood log, so the
reverts fired on the first read. Through the API: `Deadlift: 4x5 @80% deloaded=false pre=none`.

**The tell was on screen and I missed it.** The card suppresses its intensity-zone chip when
`ex.deloaded`, and the chip was showing — so the exercise it was drawing was not deloaded at all.

## The fixture merged two mechanisms production keeps apart

Of **5** stored prescriptions in production: **1** has a session-level `deload: true`, **2** have
per-exercise `deloaded: true`, and **0 have both**.

A **session** deload has its low intensities baked into the LLM's own `pct` values at generation. A
**per-exercise** deload is an overlay applied afterwards, which stores the original in `preDeload`
precisely so it can be undone. Only the second has anything to revert *to*.

One latent inconsistency stays open and is **Lane A's**: `reevaluate` returns
`{ ...prescription, exercises }` and never touches the top-level `deload` flag, so if both were ever
set and the per-exercise ones reverted, the subtitle would read `Deload session` over full-intensity
numbers. n = 5, so "has never happened" is not "cannot".

## And the same measurement questions BF-64, which I shipped four hours earlier

**LB-47.** BF-64's premise, quoted from its entry: *"Every deloaded prescription exercise carries a
`preDeload` block."* True of per-exercise deloads. But those occur when `prescription.deload` is
**false** — and BF-64's override only triggers when it is **true**. On the one real session-level
deload in production, no exercise carries `deloaded`/`preDeload`, so `deloadRevertNames` returns an
empty list and **the override reverts nothing**: exactly the behaviour BF-64 was filed to fix.

BF-64 reused the per-exercise mechanism to implement the session-level one, and the two do not
overlap. Its per-exercise path is correct and does work; what is unproven is the case the owner
actually reported.

**Not reverted, deliberately.** Nothing regressed, the card copy is right, and the mixed case it was
measured against is real in the sense that each half occurs — just not together. LB-47 records the
open question and the three candidate answers, and notes that the honest cheap one is probably to
disable the toggle on a session deload and say why.

## What this session should have done differently

The fixture was built to make an unreachable path testable, which was right. What was missing was
**checking the shape against production before trusting what it rendered** — the same
`db-query` call that closed LB-46 in two minutes was available the whole time, and would have caught
the mismatch before BF-64's verification leaned on it.

## Not exercised

No code changed. Nothing runtime, on device or otherwise.
