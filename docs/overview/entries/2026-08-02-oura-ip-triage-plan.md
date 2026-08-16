# 2026-08-02 — Oura-IP triage: what actually imports Oura's constants (docs-only)

**Branch:** `docs/oura-ip-triage-plan` · Run-list item 6 of the
[batch queue drain](../../handoff-2026-08-02-platform-batch-queue-drain.md). **No code changed.**

The owner escalated this on 2026-08-02: *"This is a big one — we need to figure out fast how we
will do this in the future; or how we will obscure this part from our public github repo when we
move to it."* The run-list called for a docs-only planning PR producing a replace-vs-gitignore
decision per module. Plan:
[`docs/superpowers/plans/2026-08-02-oura-ip-triage.md`](../../superpowers/plans/2026-08-02-oura-ip-triage.md).

## What the audit found

Q-31 claims two live imports of Oura's extracted constants, with everything else in
`lib/oura-models/` "confirmed dormant". A fresh grep over `lib/ app/ components/ packages/` finds
**seven live** — confirming the previous session's count — and one more thing it missed.

**`inference/dhrv` is dead code.** `computeDaytimeStress` (the ONNX path) is called only by
`buildDaytimeStressSeries`, and `buildDaytimeStressSeries` has no caller at all: both production
sites (`adapter.ts` and `app/api/body-battery/route.ts`) use `buildDaytimeStressSeriesFromModel`,
D5's own fitted regression. So D5 didn't just add an alternative — it orphaned the Oura model, and
nobody removed it. One Oura dependency is deletable today at zero product cost, and it makes a good
first row precisely because it is low-risk.

**The MET table is nearly free to replace.** `daily-energy.ts:13` already documents its source as
the *Compendium of Physical Activities (Ainsworth et al.)* — a published, citable reference. Oura's
`energy-expenditure-features.json` is a pinned copy keyed by their activity ids. So row 2 is
re-sourcing the same numbers from the public original and re-keying them, not deriving new science.
That is why it leads the replacements.

**One owner question blocks the whole gitignore strategy.** Is the public repo a fresh `git init`,
or a push of this repo's history? `.gitignore` excludes a file from *future* commits; it does
nothing about 43 MB of model assets already in every prior commit. If the answer is "push the
history", gitignore is not a strategy at all. Nothing in the gitignore half can be planned further
until that is answered — it is on the owner checklist as a decision, not a device check.

**Ported logic is a separate question and is not resolved.** Several modules carry Oura source in
comments rather than importing its numbers — `hrv-5min.ts`, `sleepnet-preprocess.ts`,
`step-features.ts`, and above all `lib/oura-ble/decode.ts`, which is the entire BLE protocol port.
Vendored constants and ported algorithms are different questions, and this plan deliberately only
answers the first. It is plausible the second is the bigger one.

## Verdicts

- **Replace:** MET table (public Compendium) → training stress (Banister/Foster, calibrated via the
  existing D6 harness) → resilience → cumulative stress, that last one with a migration story since
  it writes a synced column.
- **Gitignore:** SleepNet (8.0 MB) and `step_counter` — neural weights with no public equivalent.
  Conditional on the fresh-repo answer, and requiring an explicit unavailable state rather than a
  fabricated one when the weights are absent. Health Connect already covers both for non-Oura
  users, so a clean fallback exists.
- **Delete:** `inference/dhrv`, plus whatever a full dormancy sweep turns up (Task 0 — the audit
  above only enumerated *live* imports; the tree has 60+ constants files and 10 ONNX files).
- **Undecided, needs the owner:** `steps-motion-decoder` — dequantisation tables for the ring's own
  step frames, arguably the same category as the protocol decoder rather than model constants. The
  code cannot settle it.

## Scope held

No constants were swapped. Q-31's *implementation* stays blocked behind Q-1 and Q-30 per the
owner's 2026-07-30 sequencing; only the thinking was unblocked, which is what the run-list asked
for. The entry's false "only two live imports" sentence is struck in place rather than deleted, so
the correction is visible rather than silently rewritten.
