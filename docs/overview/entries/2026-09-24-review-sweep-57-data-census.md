# 2026-09-24 — Review sweep 57: a census of the owner's data, and the decisions sent to the Orchestrator

**Branch:** `review/sweep-57-data-census` · **Agent:** Review · **Docs only.**

The owner asked for two things: send the decisions to the Orchestrator, and do another sweep.

- **Decisions.** No Orchestrator session was running, so the queue is the channel, and position is
  what makes an entry visible. RV-161 and RV-157 sat at ranks 17 and 13, past the top-10 view, and
  now open Lane O. **RV-170** follows them: the history-row policy, which had never been an entry.
- **Sweep 57** checked every daily series in production for gaps, duplicates, stuck values,
  impossible values and cross-table contradictions. Most of it is clean. Seven new entries:
  - **RV-163:** four rules for "last night"; a daytime rest graded as the night on 09-23.
  - **RV-164:** a goal recommendation marked applied without its writes.
  - **RV-165:** the height correction never reached stored body composition, so the DEXA offset is
    off by a point.
  - **RV-166:** prescribed runs are never marked done.
  - **RV-167:** a strap walk's steps are undercounted when its cadence starts late.
  - **RV-168:** a join key is wiped on every program save.
  - **RV-169:** the stress history's self-heal never ran.
- **RV-159 is answered:** a body-comp re-stamp, with no scores recomputed. **BF-38's fix is failing
  on real data.**

Write-up: `docs/reviews/2026-09-24-sweep-57-data-census.md`. No product code and no production writes.
