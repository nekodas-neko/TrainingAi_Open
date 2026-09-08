# 2026-09-08 — the running-plan family gets tests (PS-39)

**Branch:** `test/running-plan-routes` · **Lane:** A · tests + docs only, no product code.

## What shipped

`lib/__tests__/running-plan-routes.test.ts` — 29 cases across `running-plan` (read and create),
`…/override`, `…/run-type-stats` and `…/runs/[id]`.

Batched for **one pairing that only holds across two of them: the override writes today's run, and
the GET must not undo it.** Both halves carry a live incident in their own comments, and neither is
visible from a single route's response:

- **Recomputing on read would flip the display back to the framework's original pick on the very
  next reload**, defeating the point of overriding. The GET trusts a persisted row whose rationale
  carries the override marker and never calls the prescriber. Its `gateReasons` come back empty —
  the gate ran once at override time and only its outcome is persisted.
- **A `max-age` header let the browser serve its own stale GET without reaching the handler**, so an
  override looked like it "reverted" inside the same 60-second window. Every path — no plan, the
  override short-circuit, the recompute, and the override POST itself — answers `private, no-store`.

Also pinned: today's existing row is never overwritten (its status may already be completed or
skipped, and clobbering it would revert the user's action) but is created when absent so completion
has a stable id; a manual pick carries the override rationale and **no distance target**, because
the user is choosing structure rather than a distance goal; overriding **resets status to pending**
even over a skip, keeping the same row id and activity link rather than duplicating; a push session
raises the distance to 2% above the block's best and leaves it alone when the framework already beat
it; the read and the override **share one rate-limit budget**, since both recompute the same thing;
run-type stats count only runs that are *completed* **and** linked to an activity, and degrade to
empty rather than 500ing when a read throws; and a PATCH writes to the run the **path** names, not
one the body names.

`scripts/check-route-test-coverage.js` baseline 100 → **96**.

## Found doing it — LA-79

`POST /api/running-plan` stores `normalizeDateParam(targetDate)`, which returns the **slash** form,
into a Postgres **`date`** column. Checked against the local database rather than reasoned about:
under the default `ISO, MDY` it reads correctly, but under `DMY` the day and month swap and a target
date moves by up to eleven months. Nothing sets `DateStyle`, so the correctness rests on a server
default nobody wrote down. The fix is one identifier — `normalizeDateParamIso` exists for exactly
this, and the supplements validator already solves the same hazard with a transform.

Filed, not fixed, so this PR stays one thing. The test **deliberately does not assert the stored
separator** — it matches `/^2026[-/]12[-/]01$/` and says why — rather than pinning current behaviour
as correct; the entry names the assertion to add when fixing.

## Notes

- **Two cases failed on first run, and both were my premise rather than the code.**
  `normalizeDateParam` returns slashes (that is its documented job — the dash form is
  `normalizeDateParamIso`), and `computeRunTypeStats` returns *every* run type as a key, so
  "does not contain 'tempo'" could never hold. Both rewritten to assert what is actually true:
  counts per type, and a validated-but-unasserted separator.
- The prescription engine is mocked; `computeRunTypeStats`, `weeklyZoneTargets`,
  `targetsForRunType`, `defaultFrameworkForGoal` and `CARDIO_GOALS` are real.
