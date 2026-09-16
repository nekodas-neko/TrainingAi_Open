# 2026-09-16 — the owner-gate triage: most of the 52 were never the owner's

**Branch:** `chore/or-117-owner-triage` · backlog only. No product code.

## The count, and what it hides

95 entries carry a gate: **52 `Gate: owner`**, 20 `Gate: device`, 22 `Verify: device`, 1
`Verify: owner`. Read as a work list that says the owner is blocking 52 items. They are not.

**Eight of them are provably not owner-ready** — Q-275, Q-272, Q-508, Q-515, Q-516, Q-522, Q-523,
Q-149. Every one is a scoring change, where the route is **Tuning proposes → the owner signs → Lane A
implements**, and every one says in its own text that **no proposal exists**. Q-149 is the clearest:
*"cannot be asked for until Tuning has produced"* the fitted number. Putting these to the owner asks
them to sign a blank page, and meanwhile they have been counting as owner debt in every sweep.
Marked `NOT OWNER-READY` so the next sweep skips them.

**Sixteen more are scoring-shaped** and need the same check, one at a time — they do not state
either way, so this entry does not claim they are unready.

## Two sittings, not five asks

Batched on **what the owner has to be sitting in front of**, per the batching rule's own axis:

- **`owner-admin-sitting`** — LA-68, TN-1, LA-56 all need a **fullHistory redecode/rollup triggered
  by hand from an admin session**. One login. Asked separately they cost three.
- **`owner-branch-protection`** — LB-52 (add classic protection beside the Ruleset so auto-merge
  works) and **Q-297's second residue** (should E2E become a required check). One settings page, two
  toggles. Nothing previously connected them; they sat in different domains.

## One closed on its own evidence

**Q-283** — *"~11 MB of indexes have never served a scan"*. Re-measured 2026-09-02 and **stale by
~14×**: its one real candidate was already dropped in migration 249, leaving **800 kB**. The entry
had said *"this should probably be CLOSED rather than implemented"* for two weeks and nobody acted,
because `Gate: owner` kept it alive. Dropping 800 kB of indexes is not worth an owner's attention.

The caution it carried survives in the removal note: **`idx_scan` counts reads, not constraint
enforcement**, so a zero-scan unique index is still working — `rr_intervals_pkey` read 0 in August
and 5,034 in September. Never drop an index on `idx_scan` alone.

## What is genuinely the owner's

**Actions only they can run (7, in 3 sittings):** the admin batch above · the branch-protection batch
above · `VACUUM FULL` (BF-106) · one tier's artwork (BF-126) · a night in the Polar H10 (Q-4, agreed
2026-08-04 and never done).

**Decisions only they can make (roughly 10):** real money (PS-46, an Apple Developer enrolment and a
new platform target) · new auth surface (PS-45) · two data-losing migrations (BF-144, LA-71) ·
deleting a live HTTP route (LA-89) · product direction (BF-77 shared meals, LA-82 degraded-profile
zones, PS-43 backfill policy) · a rename that does not deliver what was asked (Q-44).

Everything else in the 52 is mine, a lane's, or Tuning's.

## Result

Queue **339**; `Gate: owner` **52 → 43** with eight of those marked not-owner-ready. Backlog
**22,378 → 22,301**, baseline ratcheted.

`check-backlog-pointers` clean on 339 · `pnpm check:rules` **Ran 75 of 75**.

**Surfaces not exercised:** none apply — backlog only.
