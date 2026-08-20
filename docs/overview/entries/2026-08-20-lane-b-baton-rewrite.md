## 2026-08-20 — Lane B's baton, rewritten and ratcheted down 413 → 134 (PS-4, three of six)

**Branch:** `docs/lane-b-baton` · docs-only, no version bump.

The seventh Lane B run's handoff state, rewritten in full rather than appended — a baton that is half
last week's is worse than none, because it gets trusted. It came out at **134** lines against a stored
baseline of **413**, so the baseline is ratcheted down in the same PR: the shrink-only rule exists so
reclaimed space cannot quietly refill, and leaving 279 lines of headroom is an invitation for the
narrative to leak straight back in.

**What went:** six runs of "This run" sections and their per-item detail. That belongs in journal
entries and the linked reviews, both of which the baton points at. **What stayed** is what a cold
successor needs as *state*: nothing in flight, what was refuted this run and must not be re-proposed,
what is owed on the device, which paths are claimed (none — the previous run's four "release when
convenient" claims are released, since every branch holding them has merged), and the gotchas that
cost this run time.

**PS-4 re-measured, and its own thesis is holding.** The entry says baton compaction "is not a
separate task — a baton is rewritten in full at every handoff, so each role compacts its own on its
next one". Three of six are now under the ~150-line target and each fell at its own role's handoff:

| baton | 2026-08-19 | now |
|---|---|---|
| Orchestrator | — | **62** |
| Lane A | 162 | **113** |
| Lane B | 412 | **134** |
| BugFix | 135 | 161 |
| Review | 1,280 | 170 |
| Tuning | 562 | **582** |

**One exception the entry should expect:** Tuning at 582 is 4× the target and has grown, not shrunk.
It will not come down as a side effect of a routine rewrite; its narrative needs moving to a dated
handoff doc deliberately. PS-4 stays open and now says so.

**Verification.** `pnpm check:rules` — Ran 50 of 50 Custom Rules steps, all passed.
`check-doc-index-size` OK at the new baton number.

**Not exercised:** nothing runtime. This PR contains no code.
