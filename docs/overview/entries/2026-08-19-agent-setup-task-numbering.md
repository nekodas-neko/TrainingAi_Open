# Agent setup — entry IDs, readiness fields, and the file everything conflicted on

**Branch:** `claude/agent-setup-task-numbering-5gojd9` · **2026-08-19** · docs + scripts only, no app code.

The owner asked whether task IDs should carry a letter describing what an item *touches*, prompted by
the Tuning agent reporting it was running out of its allotted Q-numbers. Reviewing the setup turned
up three separate problems, only one of which was the numbering.

## What was actually wrong

**Bands exhaust and their ledger drifts.** Tuning had used 29 of its 30; Review burned all 50 in two
days. `docs/agents/README.md` already carried a warning that its own block ledger had been wrong —
544–551 were live and recorded nowhere, so a session following the file's "claim the next block of 50
above 529" instruction literally would have collided with fourteen live numbers.

**Domain-first letters would not have fixed it.** Review, BugFix and Tuning all file nutrition
findings, so they would all write into one `N-` namespace — trading five exclusive ranges for eleven
shared ones. The domain is already carried by the `[nutrition]` tag, which is CI-enforced, greppable,
mutable as understanding improves, and handles multi-domain entries that a single prefix cannot.

**The real cost was never the IDs.** Of the last 40 commits, `docs/implementation-backlog.md` was
touched by 40 and `scripts/check-doc-index-size.js` by 32. That script was **1,091 lines of which 955
were comments** enforcing **three numbers**, with every raise prepending a paragraph above the same
key — and it had already been corrupted by conflict-splicing into two verbatim-duplicated blocks plus
two recording contradictory figures for one change.

## What shipped

- **Baselines out of the script.** Three numbers to `docs/doc-size-baseline.json`, 955 comment lines
  to an append-only `docs/doc-size-baseline-history.md`, script down to 107 lines. Behaviour verified
  identical against the previous script on the same tree. **This closes Q-543**, whose entry is
  removed; it warned against dropping the raise-history wholesale, and none of it was dropped.
- **The five batons joined the ratchet** at current size, shrink-only. They are what the other lane
  reads before claiming a path, and their own template asks for one screen while Lane B stands at 412
  lines and Review at 1,280.
- **Per-agent ID prefixes** replace bands: `LA- LB- BF- RV- TN- PS-`. Legacy `Q-` stays valid — over
  10,000 references across 775 files.
- **`Needs:` / `Gate: owner|device` / `Lane: ?`** replace prose blocked markers on 17 of 23 entries.
- **`scripts/next-item.js`** prints READY / PARKED / UNCLASSIFIED per lane.
- **Four findings filed** as `PS-1`…`PS-4`.

## Batching — and why not in one pass

The owner asked at what level 210 entries should aggregate into PRs. Measuring first killed both
obvious answers: entries name **320 distinct files of which only 39 are shared**, so file-level
batching yields almost nothing, and `platform` alone holds **106** entries, so domain is far too
coarse. Median entry body is 40 lines with half over 40 — not a pile of trivia.

CI is not the constraint: 210 PRs at 3–5 minutes is machine time nobody waits on. The constraints are
the owner's attention and the device — **61 entries mention device verification and 20 touch
native/Kotlin**, each of the latter costing an APK cycle whose install can force the uninstall that
destroys the ring key. So the axis is **what one verification pass covers**: never batch the 41
migration-touching entries, batch native hardest, batch UI by screen, and never split the 18 entries
that are already one pattern across up to 263 files.

Shipped as a `Batch: <slug>` field with grouping in `next-item.js`, plus two seeded worked examples.
**Batches are assigned when an entry is next touched, not in a bulk pass** — grouping 200 entries at
once means deciding for work nobody is about to start, from the least information anyone will ever
have, on a queue that moves underneath it.

Expected effect is **210 → roughly 60–80 PRs, not 20**; half these entries are substantive work that
has to be reviewed on its own terms however it ships.

## Two things that only surfaced by testing

**Single-letter prefixes do not survive this repo.** Testing the "find your next number" grep before
putting it in the prompts returned **56 false matches**: archived reviews label their sections
`A-1..A-10`, `F-3`, `R-2`. That would have inflated every new number *and* weakened the `Needs:`
existence check, since a typo naming `A-4` would be proved real by a 2026-07 review heading. The
two-character prefixes return zero matches repo-wide.

**The `Needs:` existence check was proving itself.** It scans `docs/` for the target ID — including
the `Needs:` line that names it. A typo'd target was therefore always "found" and the check never
fired. Caught by testing each check against a deliberate violation rather than reading the code;
fixed by stripping `Needs:` lines from the evidence blob.

**A `## ` section heading did not end an entry.** Both new scripts tracked the current entry from one
`### ` to the next, so a field written under one of the queue's **eight** `## ` section boundaries —
belonging to no entry at all — was attributed to the last entry above it. Found while using the same
parser shape to pick batch candidates, and it had already produced one wrong grouping. Both scripts
now reset on a section heading.

A fourth, smaller one: extracting 955 comments into a `.md` file made one journal entry look cited by
a durable doc, which would have exempted it from compaction permanently. The history log is now
excluded from that scan.

## Deliberately not done

- **The backlog is not split per pillar.** It was proposed and withdrawn: a per-subject split
  destroys the single global priority order that makes "take the top item" work.
- **Changelog fragments are deferred.** `changelog.ts` is 7,129 lines of typed TS read by five call
  sites; fragments need a codegen step wired into CI, Railway, vitest and local dev. That is real
  cost against a 30% conflict rate whose resolution is already documented. Revisit if it still hurts
  once the 80% problem is gone.
- **The lease model was dropped** on the owner's answer that only Lane A and Lane B run concurrently.
  Fixed lanes stay; an urgent third agent gets four rules instead, the binding one being that it
  never takes a migration number.
- **Six of the 23 prose blocked markers are left unmigrated**, because classifying them needs a human
  read. The query parks them and prints their marker text rather than silently promoting them.

## Not exercised

No app code changed, so there is nothing to verify on device. `pnpm check:rules` ran **49 of 49**.
The new checks were each tested against a deliberate violation and against the valid case.
`PS-3` records four migrations that fail on every local start; **whether the same four are unrecorded
in production is not established** and is the first thing that entry asks for.
