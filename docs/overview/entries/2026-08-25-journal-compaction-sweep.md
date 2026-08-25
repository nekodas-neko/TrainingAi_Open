# 2026-08-25 — the journal sweep, and what its cadence actually is (LA-25)

**Branch:** `chore/journal-compaction-2026-08-25` · **Lane A** · docs only.

`check-doc-index-size.js` failed a **migration PR** at **61 unlinked** journal entries against a
limit of 60 — for a reason with nothing to do with the migration. That PR unblocked itself the way
the check intends, by citing its two nutrition entries from that domain's index, which left **59**
and would have blocked the next session instead. This is the deliberate version.

## What was folded

**25 of 59 unlinked entries**, 2026-08-19 → 2026-08-24, oldest first, into a new
`docs/overview/history-2026-08-25.md` (89 KB). Unlinked **59 → 34**; the directory holds 166 files,
132 of them cited by a durable doc and therefore not foldable.

**A new file rather than an append**: `history-2026-08-24.md` was at **223 KB**, and 25 more entries
would have taken it past the ~250 KB rule that governs when a batch closes.

## The five traps, checked rather than assumed

`docs/overview/entries/README.md` records five ways this sweep has broken links before. Three did
not apply to this batch and were *verified* not to, rather than skipped:

| trap | this run |
|---|---|
| Folding an entry a durable doc cites | Recomputed the unlinked set with the **checker's own logic**, not a grep — same 59 either way |
| `](../../` → `](../` in each body | Applied to all 25 |
| A folded entry linking to another folded one | **None** — surveyed the whole fold set |
| A folded entry linking to one that stays loose | **None** |
| A loose entry linking to one you folded | **None** |

`node scripts/check-doc-links.js` — **OK, 848 files** — after the fold and again after the
Document Map edit. The README is right that this is the check to trust: it is what found all five
traps originally, over five separate passes.

## The finding worth more than the sweep

**The trigger in the README describes a load that no longer exists.** It says "~20 loose files",
written when a session produced one or two entries a week.

Measured: **seventeen entries landed on 2026-08-25 alone** across the concurrent sessions, and the
unlinked count went from a post-sweep **32** on the 24th to **61** the next day. At ~17/day against a
60 limit, a sweep clearing 25 buys **about a day and a half**. That is a near-daily chore, not a
periodic one, and the practical trigger is *the guard failing somebody's PR* unless someone sweeps
ahead of it. Recorded in the README.

**The cheaper half is the citation habit the README already names** — cite the review or handoff
document, not the loose journal entry, and the linked floor stops rising. Worth stating plainly
because this sweep's own PR broke it: BF-11e cited two journal entries from the nutrition index,
because there was no handoff doc to cite instead. **That cost the floor two, permanently** — a sweep
can undo a fold, but not a citation. It was still the right call for that entry; the point is that it
is a real cost and should be spent knowingly.

## Verified

- `check-doc-links` **OK (848 files)**, twice. `check-doc-index-size` OK, unlinked 59 → 34.
- `check-backlog-pointers` OK at 203 entries. `pnpm check:rules` **Ran 56 of 56**.
- Every folded file `git rm`'d; the new history file carries a `<!-- folded from … -->` marker per
  entry, so each one still names the PR file it came from.

## Not exercised

Docs only — no code, no device, nothing to deploy. **Trap 5 is the one that cannot be closed until
merge**: a concurrent PR can cite an entry this sweep folded, and it lands as a modify/delete
conflict that git surfaces only for the file it also modified. The linked-vs-unlinked check was
re-run against the folded set immediately before pushing, which is what the README asks for, and it
is a point-in-time answer rather than a guarantee.
