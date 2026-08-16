# 2026-08-08 — A counter audit that found nothing, and one entry that was undercounting

**Domain:** platform / devices — docs-only, no version bump

Continuing the "mine production for real faults" pass that produced the Year Review zero and the
`rest_adequate` constant earlier today. This round's headline is a **negative result**, which is
worth writing down precisely because CLAUDE.md says every stored counter in this project has drifted
at least once — so "checked, clean" is information, and re-checking it in three months is waste.

## Stored counters: clean

| Counter | Stored | Derived from source of truth | Verdict |
|---|---|---|---|
| `user_stats.total_sessions` | 66 | 66 | exact |
| `user_stats.total_sets` | 922 | 922 | exact |
| `session_periodization.sessions_in_phase` (active program, 5 rows) | 1 · 5 · 1 · 1 · 1 | identical | exact |
| `personal_records` vs best qualifying log (30 records) | — | — | **zero** drifting by >0.25 kg |

The PR check applied the same gates `reconcilePersonalRecord` does — `estimated_1rm > 0`,
`exercise_deloaded = false`, and the whole-session deload/early-deload exclusions — so it is testing
the invariant the code actually claims, not a looser one.

The `sessions_in_phase` result is worth one extra line: the single drifted row found on 2026-08-07
(`AI-Phase1`/Upper, stored 0 vs actual 2) sat on an **inactive** program, and every active row is now
exact. Q-128 (shipped this morning) reconciles on every `workout-data` read, so drift on an active
program should now self-heal before anyone sees it.

## Q-7b was undercounting: ten columns, not eight

Machine-counted every column of `oura_daily_derived` against 82 rows rather than spot-checking.
**Always NULL:** `active_calories_est`, `training_load_ots`, `training_load_high`,
`recovery_index_hours`, `worn_hours_ble`, `night_hrv_baseline_ms`, `chronic_stress_score`,
`chronic_stress_contributors`, `vascular_age`, `pwv`.

The 2026-08-05 pass named seven; `active_calories_est`, `training_load_high` and
`chronic_stress_contributors` were missed. `body_comp` and `bdi_derived` are populated, so they are
not in this set. The entry is corrected with the exact list, which matters because the fix is
"build the producer" and the list is the work-list.

Separately: the table is **sparse where it is populated** — `sleep_score` 25/82, `readiness_score`
24/82, `activity_score` 12/82. "Has a producer" and "has coverage" are different questions; Q-7b is
only about the first, and this entry now says so.

## Q-107: nothing new to diagnose yet, by construction

Production is on v1.270.24, so the `err.cause` capture is deployed. **Zero server errors have been
recorded since 03:26 today**, which is roughly when it went out — so no fault has yet been captured
with its Postgres code. That is the expected state, not a disappointment: the change makes the *next*
occurrence readable and there has not been one. Nothing to act on until there is.

## React #418: the fix is holding

No client error of any kind since **2026-08-07 20:53:02**, which was 19 minutes before the Q-73 fix
merged. That is now ~15 hours spanning several passes through the bug's own 14:00–00:00 UTC window
with zero occurrences, against 283 in the days before. Stronger than yesterday's "encouraging, not
conclusive" — still short of proof, because it also depends on the app being opened during those
windows.

## Verification

Docs-only. Every number is from a read-only query against production via the `claude_ro` schema;
`check-doc-links: OK`. No code changed, so no test/lint/build claim is made.
