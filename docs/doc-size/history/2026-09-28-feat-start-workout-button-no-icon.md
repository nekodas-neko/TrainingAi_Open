# 2026-09-28 — `docs/agents/state/implementation-lane-b.md` baseline raised 57 → 59

**Branch:** `feat/start-workout-button-no-icon` (LB-173) · **Lane B** · one baseline, the Lane B baton.

## Why it grew

Two lessons, both of which had just cost real time in this session:

1. **An entry that names one site may mean one STATE of it** — `LB-173` said to drop the dumbbell from
   "Start Workout", but `Start Workout` and `Continue Workout` are branches of one primary-action slot
   and both carried it. Doing only the named one would have made the icon appear and vanish as the
   workout started. It also records that the entry's comparison was falsifiable as written.
2. **The journal 60-entry runaway limit lands the whole fold sweep in your feature PR** —
   `check-doc-index-size` assigns the sweep to whichever branch tips the directory over, and it has now
   done that twice (#1864 and this PR, which folded 40 entries).

## Why raised rather than trimmed

The ratchet's purpose is to stop the baton accreting narrative, and the honest answer here is that
cutting an existing load-bearing lesson to make room for a new load-bearing one is a false economy —
it trades a known future cost for a different one. Both new entries are gotchas that reproduce, and
the baton is what survives a compaction or a container reclaim, so it is where they belong. The
documented escape hatch is exactly this: raise it in the same PR with a note. Two lines.

**If this file keeps being written, the answer is a real compaction pass on the baton's lessons
section, not successive +2s.** Several older lessons are now superseded by checks that enforce them,
and those are the ones to cut when that pass happens.

## Process note — this is why CI caught it and the local gate did not

I ran the four doc gates, **then** edited the baton, then committed without re-gating. Custom Rules
failed on the first run of #1895 for exactly the 2 lines added after the gate. The gate is only worth
what its ordering is: re-run it after the last edit, not after the last *code* edit.

## Not folded

The other two batons were left inside their 25-line slack bands, per LA-129, so concurrent PRs stay
off one another's `.size` files.
