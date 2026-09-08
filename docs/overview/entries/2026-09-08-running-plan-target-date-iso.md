# 2026-09-08 — the running plan's target date stops depending on a server default (LA-79)

**Branch:** `fix/running-plan-target-date-iso` · **Lane:** A · one route change, three tests.

## The defect

`POST /api/running-plan` stored `normalizeDateParam(targetDate)`. **That helper returns the SLASH
form** — which is its documented job, because the day-scoped readers want it — and
`running_plans.target_date` is a Postgres **`date`** column. So the slash string was parsed by the
server under whatever `DateStyle` it happened to have.

Checked against the database rather than reasoned about: under the default `ISO, MDY`, `2026/12/01`
reads as 2026-12-01 and `2026/01/12` as 2026-01-12 — both correct. Under `DMY` the day and month
swap, and a target date moves by up to eleven months. Nothing in this project sets `DateStyle`, so
the correctness rested on a server default nobody had written down.

Latent rather than live, which is why it was filed small. `normalizeDateParamIso` exists for exactly
this case — *"consumers that do dash-based arithmetic … dash-keyed DB columns"* — and the supplements
validator already solves the same hazard with a transform whose comment says why: *"the difference
between one rule and two routes that must both remember it."* This was the second route.

## The fix

One identifier, plus the decision the entry flagged as still open:

- `normalizeDateParamIso`, so the stored value is the dash form a `date` column reads unambiguously.
- **A supplied date that is not a real day is now refused (400) rather than stored as null.** The old
  behaviour silently left a distance-event plan with no deadline and no way to tell why. An *omitted*
  date is still null and still fine — lenient about absence, strict about garbage.

## Tests

The three cases the PS-39 batch deliberately left out, now in
`lib/__tests__/running-plan-routes.test.ts`: both separators store dashes; `2026-13-45`,
`2026-02-31`, `0000-00-00` and free text each answer 400 and write nothing; an omitted date stays
null without refusing anything.

**Both of the first two fail against the pre-fix route** — checked by reverting only `route.ts` to
`origin/main` while keeping the new tests, which is the ordering that actually proves the fix is
load-bearing.

## Notes

- Found while writing the running-plan family's PS-39 tests (#976), filed there, fixed here — one PR
  per thing. That batch's test deliberately matched `/^2026[-/]12[-/]01$/` rather than pinning the
  slash form as correct, so this change reads as a fix and not a regression.
- **`git checkout HEAD -- <file>` after a mutation check reverted the fix along with the mutation.**
  The working change was not committed yet, so `HEAD` was still `origin/main`. Caught by grepping
  for the new identifier before moving on; worth doing every time rather than trusting the restore.
- No version bump or changelog entry: nothing user-visible changed under the default `DateStyle`,
  and the new refusal only fires on input the app's own client cannot produce.
