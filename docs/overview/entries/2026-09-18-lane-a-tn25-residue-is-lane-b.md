# 2026-09-18 — TN-25's residue is Lane B's, and Lane B could not see it

**Branch:** `lane-a/tn25-residue-is-lane-b` · **Lane A** · docs-only · no migration

## What this is

Not a fix — a routing correction, found while picking the next Lane A item rather than by looking
for it. TN-25 sat at the **top of Lane A's READY list** with both of its engine halves already
shipped (#1262's selector, #1263's band). The only work left is wiring the selector to a surface,
and that touches no `app/api/**` route and no storage.

## Why it was Lane A, and why that expired

The entry was filed `Lane: A` for the correct reason at the time — *"both (1 engine, 1 surface) → A,
engine half first"*, which is exactly what the rule in `docs/agents/README.md` §3 prescribes for a
two-half entry. The lane was right when it was written and became wrong when the engine halves
landed. Nothing re-reads a lane line after a partial ship, so it stayed.

## Checked, not assumed

The claim "this is a surface change" is the kind that is easy to assert and wrong often enough to be
worth three greps:

- `recommendRunType` — the selector TN-25's module deliberately mirrors — has exactly **one caller**,
  and it is a client component: `components/running/running-plan-content.tsx:133`, reading the quota
  from the existing `/api/cardio-week` through `cachedFetchToday`. So the walk's wiring is the same
  shape against the same route, and there is no exposure for Lane A to build.
- The walk's block structure lives in `useGuidedWalkStore`'s config and `walk-config.tsx` —
  `lib/stores/**` and `components/**`, both Lane B by the path list.
- `recommendWalkPattern`'s `hadHardDayYesterday` / `shortOnTime` are **optional**, so they cannot
  quietly drag an engine half back in.

## Why it mattered more than one queue position

Lane B's READY list held **two** entries. Lane A's held twelve, and TN-25 was first. So the entry
Lane B could actually build was the one it could not see, while it headed the list of the lane that
could not build it. A mis-laned entry does not merely sort wrong — it is invisible to the lane that
can ship it, and it blocks the head of the other lane's queue at the same time. After the
correction, TN-25 is **#1 in Lane B's READY**.

That is the same failure BF-175 hit from the other direction on 2026-09-17: cutting an entry down
dropped its `Lane:` line, `next-item.js` printed it `⟨lane unstated⟩`, and it landed in **both**
lanes' lists. A lane line that is stale is worse than one that is missing, because nothing prints a
warning about it.

## What was added beyond the lane

The `Keep:` line now carries the shape to copy (`running-plan-content.tsx:113-133`, and the
instruction to **reuse the `cardio-week` cache key** rather than adding a second one for the same
payload), and one genuinely open question left to Lane B: whether the recommendation **pre-sets**
the walk config or is offered as a suggestion. The owner asked to have it *"determined for me"*,
which argues for pre-setting — but `walk-config.tsx` persists a custom config on every edit, so
overwriting it silently needs care the running plan never had to take, since it only displays.

## Not verified

Nothing was run, because nothing executable changed. `pnpm check:rules` covers the backlog's
structural rules and is the only gate this diff can fail.
