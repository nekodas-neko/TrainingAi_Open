# Session journal — per-entry files

**One file per merged PR / session note. Never prepend to a shared history file.**

This directory holds the **uncompacted recent** session journal. Each session/PR writes its
end-of-session note as its **own new file** here instead of prepending to a batched
`docs/overview/history-*.md`. A periodic **compaction** sweep folds these loose files into the
batched history and deletes them.

## Why (the problem this solves)

The end-of-session journal note used to be prepended to the top of the single newest
`history-*.md`. Every parallel or back-to-back PR therefore edited **the same first lines of the
same file**, so each landing PR forced the next one to rebase-resolve a journal conflict — the
single most frequent merge conflict in this repo's multi-PR runs (observed on every PR of the
2026-07-17 batch). Two PRs writing **different files** cannot conflict, so per-entry files take
that conflict class to zero. It's also **safer**: hand-resolving a prepend conflict is exactly
where a botched merge could silently drop someone's entry; separate files can't lose one.

This preserves the original rule's intent — the note **rides in the same PR as the code**, so it
only ever lands if that PR merges (no stale "done" claims from abandoned PRs).

## Convention

- **Filename:** `YYYY-MM-DD-<branch-slug>.md` — e.g. `2026-07-17-feat-illness-signal-wiring.md`.
  The branch slug is unique per PR, so two same-day PRs never collide. `ls` sorts them by date;
  read them oldest-to-newest for the timeline.
- **Content:** exactly what the batched-history entry used to contain — a `##`-headed session note
  (what shipped, verification, what wasn't exercised, version bump). Copy the shape of any existing
  `history-*.md` entry.
- **Where it rides:** commit it on the **feature branch, last, right before merge** — same timing
  as before. It lands with the PR or not at all.

## What still goes in the feature PR (unchanged)

- This entry file (above).
- The **backlog-entry removal** for the item you completed (`docs/implementation-backlog.md`) —
  each PR deletes a *different, non-adjacent* block, so these rarely conflict.
- The `package.json` version + `lib/changelog.ts` bump when user-visible. **Note: this convention
  does NOT solve the version/changelog conflict** — those still collide because every PR bumps the
  same lines; re-bump on rebase as before. Eliminating that needs a separate changelog-fragment
  (`changesets`-style) change, deliberately out of scope here.

## What to KEEP OUT of a feature PR (moved to the compaction sweep)

To avoid re-introducing shared-line conflicts, do **not** edit these in a feature PR — they're
updated in the periodic docs sweep instead:

- The serial-track **"Next on the track: …"** pointer line in `docs/implementation-backlog.md`.
- `docs/planned_upgrades.md` batch **tick marks** (✅) for shipped review findings.

(Striking the shipped **backlog queue entry** itself stays in the feature PR — that's the
non-conflicting removal above. Only the shared *pointer/tick* lines defer.)

## Compaction chore (prevents unbounded growth — do not skip)

Loose entries are a **holding area, not permanent storage.** Fold them in on this trigger:

> **When `docs/overview/entries/` holds ≥ ~20 note files (excluding this README) OR ~100 KB of
> notes**, a session compacts them: append every entry (oldest-first) into the newest
> `docs/overview/history-*.md` — starting a **new** `history-*.md` when it nears ~250 KB, per the
> existing history-file rule — then `git rm` the folded entry files. One docs-only PR; because only
> one session runs it, it never conflicts.

### Two things the sweep must do that this file did not say (measured 2026-08-18)

The first attempt at a sweep failed the `No broken relative links in docs` rule twice, in two
different ways. Both are mechanical; neither is obvious until it happens.

1. **Do not fold an entry that another doc links to.** Durable docs cite entries by path —
   `projectOverview.md` Known-Issues rows, `docs/domains/*/README.md`, and the agent batons.
   Folding all 61 loose entries broke **48 links**, several of them inside another lane's baton,
   which is not a file a sweep should be rewriting. Fold the **unlinked** ones and leave the rest;
   `grep -rl <entry-filename> --include='*.md' .` tells you which is which. (61 → 32 that way, which
   is under the 60-file runaway limit and enough to unblock CI.)
2. **Re-express every relative link from `docs/overview/`, not just the `](../../` ones.** An entry
   lives in `docs/overview/entries/`; the history file is one level up. The README used to say
   "rewrite `](../../` → `](../`", which is two of the three cases and leaves the other two broken
   (measured 2026-08-26): **`](../x)` also loses a level** and becomes `](x)`, and **a link to a
   sibling entry that this same sweep is folding** resolves to a file that no longer exists. Resolve
   each link against `docs/overview/entries/` and `relpath` it to `docs/overview/`; point a folded
   sibling at `](#)`, since the note it referred to is now in the same file.

3. **Entries link to EACH OTHER by bare filename, and the sweep breaks those too** (measured
   2026-08-24). Two sub-cases, and they need different fixes: a folded entry linking to another
   **folded** entry should point at the history file itself (the target is now inside it), while a
   folded entry linking to one that **stayed loose** needs an `entries/` prefix. Three of these on the
   2026-08-24 sweep; `check-doc-links` names each one.
4. **And the inverse: an entry that STAYS loose can link to one you folded.** That link is not in any
   file you touched, so it is easy to miss — it surfaces as a broken link in
   `docs/overview/entries/`, not in the history file. It needs `](../history-YYYY-MM-DD.md)`. One of
   these on the 2026-08-24 sweep.

5. **A concurrent PR can LINK an entry you already folded, and it lands as a modify/delete conflict**
   (measured 2026-08-24). Three of the 60 became cited by a handoff doc that another lane merged
   while this sweep was open — git surfaces only the one it also *modified*, so the other two would
   have gone unnoticed. **After merging `main`, re-run the linked-vs-unlinked check over the folded
   set, not just over the loose one**, and un-fold anything that has gained a citation. Folding is
   the reversible half; a broken citation in someone else's handoff is not.

**Run `node scripts/check-doc-links.js` after the fold and fix what it names — do not reason about
which links moved.** All five traps above were found that way, in five separate passes, and each one
looked like the last thing that could be wrong.

### The limit now counts foldable entries, not all of them (changed 2026-08-18)

**Third and fourth sweeps, 2026-08-18 (same day again).** Another lane swept 61 → 41 concurrently
with this one: 20 of 61 unlinked, and **the floor held at 41** across both, so the rise predicted
above did not continue on those runs and the trend is not a straight line. What did not change is the
arithmetic — limit 60, floor 41, so the whole directory has **19 files of headroom**, which measured
out at roughly twenty minutes on the busiest stretch of the day and about half a day at the average
rate.

**Why the floor held, measured on that same third sweep — and the lever it gives you.** The eleven
entries added between the second sweep and the third were all **Review** sweeps, and Review links its
**`docs/reviews/…` write-up** from the domain indexes while leaving the **journal entry itself
unlinked**. So the linked floor tracks *durable-doc citations*, not entry count: a session that cites
its review or handoff document costs the floor nothing, while one that cites its loose journal entry
raises it permanently.

**That makes the fix cheaper than either option in the tension below:** when a durable doc needs to
cite a session, **cite the review/handoff document, not the loose journal entry**. No sweep rewriting,
no re-pointing of existing citations — just a habit that stops the floor growing from here.

**Why sweeping harder could not fix it in the meantime.** The linked entries are a floor, not
growth, and the guard was counting them — so it fired on a condition its own prescribed remedy is
forbidden to touch. That is not a guard, it is a periodic outage, and it lands on every lane at once
because a journal entry rides in *every* feature PR. It did exactly that twice in one day.

**So the guard changed too, and the two fixes are complementary.**
`scripts/check-doc-index-size.js` now applies the 60 limit to the **unlinked** count — exactly what a
sweep clears. The citation habit above stops the floor rising; this stops the existing floor blocking
CI while that habit takes effect. It still catches what the guard was written for: if nobody sweeps,
unlinked entries pile up and it fires (verified by simulating 61 against the real floor). A separate
ceiling of **250 total** keeps the original 509-file readability failure caught, and its message says
plainly that a sweep alone will not fix that one.

**The older framing, kept for the record:** this used to be described as an undecided choice between
the sweep rewriting citations into the history file, or durable docs citing the batched history. The
citation habit above is cheaper than either and needs no retrofit, so that is the answer unless the
floor starts rising again from a source other than journal citations.

### What the cadence actually needs to be (measured 2026-08-25, LA-25)

The trigger above says ~20 loose files, which was written when a session produced one or two entries
a week. It no longer describes the load. **Seventeen entries landed on 2026-08-25 alone**, across the
concurrent sessions, and the unlinked count went from a post-sweep 32 on 2026-08-24 to **61 the next
day** — a hard CI failure, on a migration PR, for a reason unrelated to the migration.

So the honest number: at **~17 entries/day** and a limit of 60 unlinked, a sweep that clears 25
buys **about a day and a half**. Treat it as a near-daily chore while this many sessions run in
parallel, not a periodic one — and expect the trigger to be *the guard failing someone's PR* unless
somebody sweeps ahead of it.

**The cheaper half is still the citation habit above**: cite the review or handoff document, not the
loose journal entry, and the linked floor stops rising. The 2026-08-25 sweep itself cost the floor
**two** — a nutrition PR cited its own two journal entries from that domain index, because there was
no handoff doc to cite instead. That is a legitimate trade and worth naming: an entry linked for a
good reason is permanent weight, and a sweep cannot take it back.

This is a standing chore in the same spirit as Dependabot remediation: it lives here permanently and
is worked on a threshold, not every session. Below threshold, leave the entries; above it, compact.

## Considered risks (reviewed before adopting — read before "improving" this)

- **Unbounded directory growth** if compaction is skipped — the whole benefit assumes the sweep
  actually happens. Mitigated by the explicit threshold above; the files are tiny (~1–3 KB each, so
  20 ≈ 40 KB — a tidiness concern, not a git-perf one), but don't let them pile into the hundreds.
- **Loss of the single chronological read** — "recent history" is now N files, not one scroll. The
  `YYYY-MM-DD-<slug>` naming keeps `ls` chronological; compaction restores the single-file read for
  anything past the current window. Accept the small ergonomic cost for zero conflicts.
- **Discoverability** — a session that reads only the batched `history-*.md` would miss the last few
  sessions. The `projectOverview.md` Document Map points here explicitly; keep it doing so.
- **Half-fix honesty** — this removes the journal + shared-pointer conflicts, **not** the
  version/changelog one. Don't claim otherwise.
- **Stale plan-doc instructions** — implementation plans written before this convention (their
  "Task Final" steps) still say "append the session note to the most recent `history-*.md`". That is
  superseded: CLAUDE.md's per-entry-file rule wins (it "OVERRIDES any default behavior"). The plans
  weren't bulk-edited to avoid churn/conflicts with the live queue — follow this convention, not their
  stale line.
