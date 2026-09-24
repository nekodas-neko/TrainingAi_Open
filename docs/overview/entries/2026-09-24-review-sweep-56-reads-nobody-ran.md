# 2026-09-24 — Review sweep 56: the reads nobody ran

**Branch:** `review/sweep-56-owed-reads` · **Agent:** Review · **Docs only.**

The owner asked for Q-351, Q-353 and Q-144 to be checked, and for another sweep.

- **Q-351, Q-353 and Q-144 are all resolved.** They were fixed in #48, in #79, and on 2026-08-08.
  Their Known-Issues rows are stale; closing them is RV-160.
- **Sweep 56** looked for entries waiting on a read anyone could run. Of 105 candidates, about 33
  were run today and 23 changed their entry. The headline, re-checked here: **12 of 27 recent
  nights are missing from `sleep_sessions`**, and the entry saying the problem does not reproduce
  is wrong.
- Also found: an **unattributed rewrite of 106 stored score rows** at 02:37 UTC (RV-159). A
  never-run baseline re-derive blocks five pass tests (RV-161). The strap log goes silent overnight.
  LA-110's cause turned out to be the new program's baseline block.
- Filed:
  - RV-159: attribute the rewrite.
  - RV-160: close what is answered.
  - RV-161: five owner decisions, each with a recommendation.
  - RV-162: a `Due:` field so an owed read fires on its date.
  Dated reading notes went onto 23 entries.
- Not done: no product code and no production writes. `projectOverview.md` is left to the
  Orchestrator.

Write-up: `docs/reviews/2026-09-24-sweep-56-reads-nobody-ran.md`.
