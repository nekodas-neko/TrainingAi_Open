# 2026-09-27 — measured `CLAUDE.md` for the same compaction, and decided against it

**Branch:** `docs/record-claude-md-compaction-decision` · Orchestrator

`OR-197` took `projectOverview.md` from 309 KB to 17 KB, and the stated next targets were
`CLAUDE.md` (120 KB) and `docs/agents/README.md` (52 KB). Measuring `CLAUDE.md` changed the
recommendation, so this records the call rather than the work.

## The measurement

945 lines, 120 KB. Four sections carry 47% of it: Standing Instructions 18.3 KB, Standing Agents
16.8 KB, Cache Invalidation 10.9 KB, Git Workflow 10.0 KB.

## Why it is not the same job

`projectOverview.md` was 94% one section that had become a changelog under a status heading — a
relocation with no judgement calls and nothing to weigh. `CLAUDE.md` has no equivalent block. It is
rules with their evidence attached.

**The evidence is load-bearing, and the file demonstrates it about itself.** The most cuttable-looking
passages are the ones reading *"this paragraph said the opposite until 2026-09-25, and both versions
were wrong about the mechanism"*. The branch-protection rule has been stated backwards twice and the
merge-button passage was wrong in both directions; the record of that is what prevents a third.

**The saving is also smaller than it looks.** A standing role runs as one continuous session, so this
file is read at session start and served warm after — the cost is per session *start*, not per turn.
That is exactly why 292 KB of per-start noise was worth removing and a few KB of rules is not.

## A claim I withdrew

The Standing Agents section says it is the must-bind subset of `docs/agents/README.md`, which implies
some of it is a second copy. I wrote a token-coverage scan to test that, and it was too weak to
support the conclusion — several bullets had no testable tokens at all, scoring 0/0. No tool owns the
question *"is this paragraph's content also in that file"*, so under the repo's own rule the scan
could find candidates and could not conclude. **Withdrawn rather than reported.** Doing it properly
is a careful read of both files; `OR-199` records what it would have to respect.

## Filed

**`OR-199`** — a `Reference:` entry holding the measurement and the reasoning, so this is not
re-proposed as an obvious win by the next session that sees a 120 KB file.

**Not exercised:** documentation only. Gates: `check-backlog-pointers` and `check-doc-links` both
clean by exit code.
