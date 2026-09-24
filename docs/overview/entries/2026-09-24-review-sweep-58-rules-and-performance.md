# 2026-09-24 — Review sweep 58: the rules no check enforces, and where the time goes

**Branch:** `review/sweep-58-rules-and-performance` · **Agent:** Review · **Docs only.**

The owner asked for three things: send the decisions to the Orchestrator, do another sweep, and do
a performance sweep with the device agent's help.

- **Decisions:** already at the head of Lane O (RV-161, RV-157, RV-170, behind OR-150). There are
  no new owner questions.
- **Rules census** (RV-171 to RV-179). The headline is **RV-171**: a failed request in the
  meal-plan setup silently deletes every saved dietary restriction. Also **RV-172**: the sync pull
  nulls supplement ticks' time and frozen vial dose. Also **RV-173**: Coach runs without the prose
  guards.
- **Performance** (RV-180 to RV-186). **RV-180** is the likely cause of DV-13's outage: every row
  re-sorts 12,396 clock anchors. **RV-181**: one HR query is 51% of all database time. The device
  agent gets one sitting (**RV-186**) to record baselines before the fixes.
- The bundle agent stopped on a usage limit after its build finished; its analysis was completed
  here. The `@sentry/conventions` 499 KB lead was checked and is false (657 bytes shipped).

Write-up: `docs/reviews/2026-09-24-sweep-58-rules-and-performance.md`. No product code and no
production writes.
