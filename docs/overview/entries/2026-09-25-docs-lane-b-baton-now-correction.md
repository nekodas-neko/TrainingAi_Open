# 2026-09-25 — Lane B's baton was three PRs stale, and the cause was a silent no-op

**Branch:** `docs/lane-b-baton-now-correction` · **Lane B** (LB-148) · docs-only

The 4-hourly queue check reads the baton before anything else, on the grounds that after a
compaction it may be more current than the session's own context. This time it was **less** current:
`Updated` still read 2026-09-24 and the `Now` line stopped at RV-176, omitting RV-113+OR-161, BF-196
and RV-183 — three merged PRs.

## Why

Every one of those PRs *intended* to rewrite `Now`. `git show 57a65d05 -- docs/agents/state/implementation-lane-b.md`
shows the BF-196 diff touching only `Next ID` and the `Next` section: the `Now` replacement produced
no hunk at all.

The edits were scripted `str.replace(old, new, 1)` calls. **A `str.replace` whose `old` is not found
returns the string unchanged and reports nothing.** The first one no-oped, so the second was written
against text that had never landed, so it no-oped too, and so on. Each PR's other baton edits — the
`Next ID` bump, the `Next` and `Lessons` sections — matched and applied, which is why the file looked
maintained while its most-read line went stale.

Backlog and source edits in those same PRs all carried `assert s.count(old) == 1`. The baton's did
not. That asymmetry is the whole defect: the one file explicitly described as "what survives a
compaction, a container reclaim, or a cold restart" was the one edited without a guard.

## Fixed

`Updated` → 2026-09-25 and `Now` restored to what actually shipped. Every replace in this PR asserts,
including the two that only reshaped text to stay inside the 55-line shrink-only baseline.

Added as a lesson in the file itself, because the next session will script baton edits the same way:
**assert every scripted replace.**

## Not changed

No queue movement, no code. `Next ID: LB-148` was already correct — verified against every `LB-` in
`docs/`, where its only occurrence is the pointer line itself, so the highest *used* is LB-147.
