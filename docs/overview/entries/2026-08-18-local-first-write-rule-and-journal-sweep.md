# 2026-08-18 — the inverse offline-first rule, and Q-488 handed back with the dead end mapped

Lane B. Docs and one CI baseline; **no application code shipped**, deliberately. No version bump.

## What this set out to do

Take Q-488 — *deleting an activity leaves it in the local store, so three other screens keep showing
it* — which the review sweep had tagged Lane B, scoped to one handler, and described as "one call".

## What actually happened: the fix shape does not exist

`app/health/health-content.tsx` deletes through `fetch("/api/activity-logs", { method: "DELETE" })`
and never touches the local row. That part of the entry is correct. The fix it prescribes is not.

- **`lib/local-store` has no `deleteActivityLog`.** Every hit for that name is
  `repo.deleteActivityLog` — `lib/data/repository.ts:547` and `adapter.ts:2374` — the *server*
  repository, which the route already calls. The local store has `deleteFoodLog`, `deleteInjury`,
  `deleteSupplementLog`, `deleteSavedMealLocally`, `deleteExerciseLogLocally`,
  `deleteWorkoutSessionLocally`. Not this one.
- **`upsertActivityLog` cannot express a delete.** Its INSERT names 27 columns with 27 placeholders
  and its `ON CONFLICT(id) DO UPDATE SET` names 27 assignments; `deleted_at` is in neither
  (`sqlite-backend.ts:2607`). `LocalActivityLog` declares `deletedAt: string | null`, so a caller
  can set it, pass the type check, and be ignored.

A read-merge upsert stamping `deletedAt: now` was written here and reverted before commit. It
compiled, `tsc` passed, and it was a **no-op**: `getActivityLogs` filters `deleted_at IS NULL`
against a column the write never sets. Nothing available in this sandbox would have caught it —
`getLocalStore` returns null in the web runtime, so no spec can exercise the path either. It would
have merged green, been journalled as fixed, and left the bug in place under a struck entry.

That is why the entry was rewritten rather than trimmed to "re-tagged": the dead end reads as
correct in every check that can be run here, so the next session needs the column-list evidence, not
a verdict.

**Re-tagged to Lane A.** The load-bearing half is `lib/local-store/index.ts` +
`lib/local-store/sqlite-backend.ts`, both Lane A's by the ownership list. The Lane B call site is
four lines and is the last step. Splitting it would leave a call to a method that does not exist.

The entry's **audit** still stands untouched: eight other mutating writes to local-first domains
were checked and all eight write locally. This remains the only instance.

## What did ship

**The inverse rule, in `CLAUDE.md`** (Offline-First section, immediately above the forward-direction
rule it inverts). The written rule was *"if a domain WRITES to the local store, its UI MUST READ from
the local store"*. The half that was missing is the one that broke: **a domain the UI reads
local-first must have every write update the local store — deletes included, and including a write
made from a screen that itself reads server-side.** That last clause is the whole reason this hid.
`health-content.tsx` reads the server-assembled `day-log:` aggregate, a sanctioned exception, so the
row vanished instantly on the screen that deleted it while three local-first surfaces kept it.
Nothing on the originating screen could reveal the inconsistency.

**The journal compaction sweep** — third of the day. 61 loose entries, 20 of them unlinked by any
durable doc, folded oldest-first into a new `docs/overview/history-2026-08-18.md` with
`](../../` → `](../` rewritten in each body. A new history file rather than an append because
`history-2026-08-15.md` had reached 300 KB against the ~250 KB rule. 61 → 41, under the 60-file
runaway limit that was **already failing on `main`** and therefore failing Custom Rules on every
open branch.

The README predicted a rising floor: the linked count went 32 → 41 between the first two sweeps. It
did **not** rise on this one — 41 before, 41 after — so the trend is not yet a line, and the README
now says so rather than leaving its own forecast standing unchecked. Headroom is 19 files.

## Baselines raised, with the reasons in the script

- `CLAUDE.md` 1075 → 1077 — the two-line inverse rule.
- `docs/implementation-backlog.md` 9905 → 9924 — the Q-488 evidence and re-tag.

## What was NOT exercised

- **The bug itself is unreproduced and the fix is unwritten.** Nothing here changes app behaviour.
- **No device run.** Not applicable — no runtime code changed.
- The 5-minute staleness floor is still read from `MIN_SYNC_INTERVAL_MS`, not observed.
