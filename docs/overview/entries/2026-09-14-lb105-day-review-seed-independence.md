# 2026-09-14 — the read-through spec was wrong in both directions (LB-105)

**Branch:** `fix/day-review-seed-independence` · **Lane B** · no version bump — no product behaviour changed

## The half that was visible

`day-review-read-through.spec.ts`'s first test failed on a clean checkout of `origin/main` in the
sandbox and passed on CI. Filed rather than fixed on the spot, because a guess about CI is not a
finding; the answer arrived when PR #1160's E2E job went green on the exact tree that failed here.

The cause is the seed. Every section of `DayReadThrough` self-hides when its domain is empty, and
the local database has **nothing at all** for today:

```
food_logs 0 · activity_logs 0 · body_metrics 0 · workout_sessions 0 · sleep_sessions 0
```

So the dialog was legitimately blank and the assertion was legitimately failing. A spec that is red
locally and green on CI is worse than one that is simply wrong: it trains a session to skip it,
which is how a genuine failure gets waved through.

## The half nobody was looking at

The **second** test — *"the same section labels appear on /health/day"* — passed on that same empty
day. It should not have been able to.

Its regex was `/^(Training|Activity|Energy|Sleep|Body|Heart rate through the day)$/`, unscoped. The
day screen renders its own score row above the read-through: `Ready`, `HR`, **`Sleep`**, `Move`. So
`^Sleep$` matched a score cell, and the test guarding *"both hosts render ONE implementation, not
two"* **would have passed with `DayReadThrough` absent entirely** — the precise failure it exists to
catch.

The label list was wrong as well. `day-sections.tsx` renders **`Body composition`**; `^Body$` never
matched it, and the anchors meant it matched nothing rather than matching loosely.

## What shipped

- `DayReadThrough`'s root carries `data-testid="day-read-through"`, and **both** tests scope to it.
  That is the only way an e2e can tell this component's labels from a word that happens to appear
  elsewhere on the host screen. (`data-testid` has one prior use in the repo,
  `meal-source-attribution`.)
- The spec records an activity for today in `beforeAll` and deletes it in `afterAll`, reading the
  user's local day back from Postgres in their own timezone rather than computing a UTC one — the
  app buckets by the user's day, and UTC is the wrong day for two hours of it.
- `SECTION_LABELS` is a named constant, checked against `day-sections.tsx` rather than remembered.

## Verification

All six tests in the file pass locally, where one failed before. `day-detail-sheets` and
`day-entry-edit-delete` still green on the same seeded row; teardown verified by reading
`activity_logs` back — zero fixture rows left.

**The soundness fix was falsified directly, not assumed.** With the seed suppressed, the
`/health/day` test **fails** — where before this change it passed on exactly that empty day. That is
the vacuity being gone, demonstrated rather than argued.

`pnpm check:rules` **Ran 74 of 74** · `npx tsc --noEmit` clean.

## What was NOT exercised

- **No device, and none needed** — this is a test-harness change plus one `data-testid`. No product
  behaviour changed, which is why there is no version bump or changelog entry.
- **CI was not re-verified for the opposite direction.** These tests were green on CI before because
  its seed records something for today; they should stay green now that the spec makes its own row,
  but a seed that already has an activity means the fixture is additive rather than load-bearing
  there. If CI ever goes red on this file, that is the thing to look at first.
- **The other four tests in the file were not audited** for the same class of unscoped matcher. Two
  of them assert on buttons and a network request, so they are not exposed to it; `the wrap-up steps
  through to a Save` was not examined.
