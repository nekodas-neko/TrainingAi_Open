# 2026-09-12 — BF-146 closed without a code change: BF-148 had already removed the cause

**PR:** `fix/bf146-baseline-not-a-failure` · **Lane B** · `e2e/baseline-not-a-failure.spec.ts` (new),
`docs/implementation-backlog.md`.

Owner, minutes before training: *"its not able to generate an ai workout for the new one"*, under an
amber *"Couldn't generate your AI prescription just now — showing your base program. Tap refresh to
try again."*

## The report and the diagnosis were both right

`generate-prescription.ts:201` returns `{ ok: false, error: 'Baseline not complete', status: 400 }`
while `phase === 'baseline' && !baselineComplete` — correct, because a prescription is a percentage
of a 1RM and there is none before the AMRAP. The client rendered that under
`prescriptionGenTimedOut`, a *timeout* flag, so a settled state got amber, a warning triangle and a
retry that could never succeed, beneath a panel already explaining it correctly.

I implemented the fix the entry recommended, keyed on the state rather than the error string.

## Then the spec passed without it

Before shipping I wrote `e2e/baseline-not-a-failure.spec.ts`: it puts the seeded user's session into
`phase = 'baseline', baseline_complete = false` on an `ai_dynamic` program — the owner's exact state
— opens the card, waits past the poll window, and asserts no banner. It passed. **It also passed
with the fix reverted**, which is the only reason this entry is closed rather than shipped.

The banner needs `aiPrescriptionPending`, and `isAiPrescriptionPending` requires **`!isBaselinePhase`**
(`prescription-pending.ts:26`). In this state `isAiDynamicBaseline` is true, so `isBaselinePhase` is
true, so pending is false and the poll never runs. The banner is unreachable.

**What changed is `isAiDynamicBaseline` itself.** It used to carry a third, name-keyed
`hasAnyPriorLog` term — true of any rebuilt session — which vetoed the baseline, made
`isBaselinePhase` false, let generation be attempted, and produced exactly this banner.
**`ad8938d328` (BF-148, #1117) removed that term**, hours after BF-146 was filed. The surviving
comment at `app/api/workout-data/route.ts:215` names BF-148 as the reason.

So BF-146's own recommended fix would now be dead code. It was reverted, along with its source guard
and the version bump.

## What ships

The spec, and nothing else. BF-148's change is to a *guard*; nothing pinned the user-visible
consequence, so restoring the veto would have gone unnoticed by tests. This is the verification
BF-146 asked for, kept as a regression net for another lane's fix.

The entry is removed from the queue rather than marked done — a fix nobody made is not a fix, and
CLAUDE.md's rule for a superseded plan is to close it with the reason rather than force a mismatched
implementation to clear the queue.

**If it ever returns**, the fix is not to let generation proceed — that is the borrowed-anchor
prescribing BF-143 removed. Suppress on the state (`phase === 'baseline' && !baselineComplete`),
which the pre-workout screen already computes for its baseline panel. Keying on the error string is
wider and needs text threaded through `workout-screen.tsx`, shrink-only at 1833 lines.

## Verification

`pnpm check:rules` **Ran 73 of 73**; `e2e/baseline-not-a-failure.spec.ts` passes and restores the row
it changed. No production code was touched, so no version bump and no changelog entry — the app
behaves exactly as it did before this PR.

**No `projectOverview.md` Known-Issues row**, deliberately: the user-visible fix is BF-148's, and
claiming it here would put one outcome in two places.
