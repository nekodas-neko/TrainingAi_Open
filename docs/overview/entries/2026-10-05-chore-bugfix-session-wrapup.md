# 2026-10-05 — BugFix session wrap-up, and an entry that was lost for a week

**Agent:** BugFix intake, closing the session. **Docs only.**

## The find that made this more than a ritual

**`BF-218` never reached `main`.** Written 2026-09-28, its commit `68277da67` is timestamped
**21:31:17Z**; PR #1936 had **auto-merged at 21:28:44Z** — nearly three minutes earlier. The push
landed on a branch whose PR was closed and whose head was auto-deleted, so the entry, and an
`LA-178` amendment in the same commit, sat invisible for a week.

Nothing flagged it. `check-backlog-pointers` cannot see an entry that was never added, and the
journal entry on `main` simply lacks the appendix. It surfaced only because the wrap-up checked
each of this session's IDs against the live queue rather than against memory.

Both are restored here, recovered verbatim from the surviving remote branch.

**The mechanism, worth internalising:** `enable_pr_auto_merge` fires the moment the required checks
pass, so a second push to the same branch races the merge and loses. Finish the diff before arming
it, or open a second PR for the follow-up.

**What changed underneath BF-218:** `BF-221` shipped and now clamps an accessory's reps to the goal
band before the load is derived, so the plan its table was computed against no longer exists in that
shape. The two mechanisms it names — `dropToBudget` having no floor but one, and re-fitting
survivors from their original set counts — are untouched. The entry says so rather than keeping
numbers that may not reproduce.

## Where this session's intake ended up

Shipped by the lanes: **BF-217** (#1937), **BF-220** (#1993), **BF-221** (#1999).
Still queued: **BF-218** (restored), **BF-219** (`Lane: T`, awaiting a Tuning proposal),
**BF-222**, **BF-223**, **BF-224** — the last three all waiting on the owner.

## Documentation reconciled

- `docs/handoffs/handoff-2026-10-05-workouts-bugfix-intake-prescription-cluster.md` written, with
  the pickup prompt.
- `docs/domains/workouts/README.md` — History links the handoff and summarises the cluster.
- No new `known-issues.md` rows: every finding carries a backlog entry, which is what the
  no-orphaned-findings rule asks for, and duplicating them is how that section regrew to 17% of the
  file last time.

## Not exercised

Docs only. No product code, no device run, no `pnpm dev`. The one claim resting on a live system is
that the restored branch still held the lost commit — verified by fetching it, not assumed.
