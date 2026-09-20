# 2026-09-20 — "is that the default full, not the AI full?" — yes, and the sweep was worse than the report

**BugFix intake.** Docs-only. Owner, after overriding the BF-179 deload: *"now I have full - but im
guessing its the default full - and not the ai prescribed full (as it was usually 2 sets now its 4).
So we need some sort of catch to make sure its always ai derived right?"* **BF-180** and **BF-181**.

## His diagnosis was right, and it measures out exactly

All five Upper exercises are `{ pct: 52, reps: 8, sets: 2, deloaded: true }` with **no `preDeload`
block**. So `deloadOverrideBlocked` returns all five, `deloadRevertNames` returns empty, and
`deloadOverrideOutcome` returns `nothing-to-revert`. The override has nothing AI-derived to revert
to and the session falls through to each exercise's stored progression style:

| exercise | static style | sets |
|---|---|---|
| Incline Bench Press | Powerbuilding | **4** |
| Chest-Supported Dumbbell Row | Hypertrophy Plus | **4** |
| Chin-Up / Lateral Raise | Hypertrophy 3-set | 3 |
| Barbell Skull Crusher | **none** | **0** |

"Usually 2 sets, now 4" is Incline Bench's Powerbuilding style exactly.

## Root cause

`preDeload` is written only on the **per-exercise** deload path —
`reconcile-prescription.ts:224` iterates `params.deloadedIds` and captures each target's values
before overwriting them. A **session-level** deload never enters that loop: its low percentages are
produced directly at generation, so "what full would have been" is never computed and never stored.
The exercises carry the flag with nothing behind it.

`utils.ts:216-231` (LB-47) already documents `nothing-to-revert` for the case where a session-level
deload carries **no** `deloaded` flag. This is the sibling it did not name — flag set, `preDeload`
absent, same branch.

## Recommendation on his "catch"

Store the full-intensity block at generation for session-level deloads too, so the override reverts
locally and instantly with no network call while he is standing in a gym. **The information is not
currently computed on that path**, so it is a generation change rather than plumbing — that is the
honest cost. Regenerating on tap is kept as the fallback for prescriptions already stored without
the block, including his; it is rejected as the primary because it needs a round trip at the worst
moment and fails offline.

## BF-181 — the sweep was run before filing and changed the entry

The missing style on Skull Crusher looked like one orphan. It is **14 rows, nine in the active
program**, and **`Lower` has no static programming at all** — all five exercises. Every session in
the active program has at least one, and the inactive `Main` shows the same shape, so it is a
missing constraint at write time, not bad rows. Worth knowing: this is invisible while the AI
prescribes every set, and load-bearing the moment anything falls back — which is precisely what
BF-180 found the override doing.

## What was not exercised

Nothing on the S25. Both were traced in source and confirmed against production rows — the stored
prescription JSON, the style join, and the null-style sweep — not reproduced at runtime. BF-180
carries a device check because the owner has to see 4 sets become the AI's number.
