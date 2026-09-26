# The archive list was wrong: eleven rows, eleven still owing something

Orchestrator, 2026-09-26. Docs only. `RV-156` said about 30 Known-Issues rows are already answered
and should move to the archive. Its §4 named the rows. I tested them instead of moving them.

## All eleven failed the archive rule

The rule is *move a Known Issue only when nothing is still owed* — no open work, no pending owner or
device check, no un-run follow-up. Checked one at a time against the row's own text and the queue:

- **`Q-556` describes a live defect.** `DELETE /api/activity-logs` answers `200 {"success":true}` for
  another user's row. Not a leak — the row survives, still theirs — but the handler cannot know,
  because the repo method returns `void`. Archiving that is burying it.
- **`Q-461` is still in the queue**, and it shares one heading with `Q-460` and `Q-462`. Moving the
  row would have taken live work with it.
- **`LB-107` rests on an uncorroborated claim.** The sweep says *"verified in sweep 1"*; no journal,
  entry or sweep record says so, and the row itself says the gesture is owed on the S25 and reachable
  nowhere else. Absence of evidence is the answer here, not a technicality — the check is cheap and
  nobody has recorded running it.
- The other eight each carry an owed device check, an open 🟠, or an unverified probe.

## Why a careful sweep produced a wrong list

Sweep 55 read about 30 rows quickly and judged *"is this answered somewhere?"*. The archive rule asks
a different question: *is anything still owed?* **A row can be entirely correct that its fix shipped
and still owe a device check** — and eleven of eleven here do. The two questions agree often enough
that the difference is invisible until you test for it.

`RV-156` now carries the table and says outright not to apply its own §4 list. The movers have to be
re-derived from the rows.

## The amend half is sound, and two are done

`LB-4` was recorded as 🟠 open in the calorie-surface row although it had shipped and left the queue —
and **the identical paragraph was pasted into the `LB-1` row**, describing a different heading's work.
The paste is gone; the surviving bullet says shipped and says it was corrected.

Still owed on that half: the two *"ALL QUEUED (fixes not yet shipped)"* headings, `gps-watchdog`'s
*"until it ships"*, the sheet that no longer renders the list, the APK claim, the pulls-never-revert
claim `DV-15` disproved, and the route that moved out of Admin.

## Not done

Nothing moved to the archive. That is the result, not a shortfall — `projectOverview.md` is what every
session reads before it can start, and a row that hides an open defect there is worse than a long list.
