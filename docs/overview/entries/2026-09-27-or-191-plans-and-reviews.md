# Plans and reviews: one report added, 729 link rewrites declined

Orchestrator, 2026-09-27. Third part of the repo cleanup. **Most of this entry is work I decided
not to do, and why** — the measurements are the deliverable.

## Plans: 47 of 260 are live

A plan is live exactly while a backlog entry cites it, and that is a definition rather than a
heuristic: the protocol has PR 1 write the plan **and** its queue entry together, and PR 2 remove
the entry when the work ships.

Measured: **47 cited by the backlog, 160 cited only by journals/handoffs/reviews, 53 cited nowhere
at all.** So 82% of the directory is history — the same shape as `projectOverview.md` being 79%
Known Issues.

### Why they were not moved to an archive directory

The obvious move — 213 files into `plans/archive/` — costs **729 reference rewrites across 202
files**, three times the handoff move earlier today. Against that:

**Nobody browses that directory.** A reader reaches a plan by following a link from the backlog
entry that cites it. The move buys navigability that is not used, and pays for it in churn across
202 mostly-historical documents.

What was actually wanted is the *liveness answer*, and that is now
`scripts/check-plan-liveness.js`, reporting in the Custom Rules job beside the doc-size check:

```
check-plan-liveness: 47 live of 260 plans (213 are history — cited by no queue entry).
```

**It reports and does not gate.** A plan going quiet is normal; failing CI for it would only stop
people writing plans.

**A README index was the other candidate and is worse.** An index of "current plans" is stale the
moment a plan ships, and a stale index that gets trusted is this repo's most-repeated documentation
failure — the backlog's `Branch:` field is the standing example. A number computed at run time
cannot drift.

## Reviews: nothing to clean, and that is a measurement

187 reviews, flat. Unlike plans, **a review does not go stale** — it is a dated record of what was
found, and it stays true. The only thing that could be wrong is a review whose findings never became
entries, which **No orphaned findings** forbids.

Checked every one for an entry ID:

| month | reviews | none cited |
|---|---|---|
| 2026-07 | 16 | **14** |
| 2026-08 | 117 | **2** |
| 2026-09 | 54 | **0** |

The July cluster predates the entry-ID convention, so it is not evidence of dropped findings. Both
August cases were read rather than counted:

- `2026-08-07-full-app-review-prompt.md` is a **prompt** for a review session, not a review.
- `2026-08-18-empty-and-single-datapoint-accounts.md` states **"Findings filed: none"** and has a
  section headed *"Recorded as observations, deliberately not filed"* with the reasons — which is
  exactly what the rule permits.

**Zero orphaned findings.** The discipline arrived and stuck, and the right action on the reviews
directory is none.

## What this makes true

Across the three cleanup PRs: `projectOverview.md` 13,028 → 2,812, `CLAUDE.md` 1,061 → 937, the
`docs/` root 118 → 50, the journal 81 → 36, and the plans directory now reports its own liveness.
**No file was archived on a guess** — each move was justified by a measurement, and the two that did
not clear the bar were declined in writing rather than done quietly.
