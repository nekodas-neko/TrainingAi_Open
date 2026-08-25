# 2026-08-25 — the modal that made Home look empty to every E2E spec (OR-1)

**Branch:** `fix/home-specs-suppress-morning-checkin` · **Lane B** · e2e only, no product change.

E2E had been red on `main`, and the Orchestrator filed OR-1 for it: `home-card-invalidation-refetch`
failing deterministically at `getByRole('button', { name: 'Log Body Weight' })`, with
`score-band-not-colour-only` failing intermittently beside it. Both are now green.

## What it actually was

**Home's first-open-of-day Morning Check-in is a modal.** While a Radix modal is open it sets
`aria-hidden="true"` on `<main>` and `pointer-events: none` on `<body>`, so **everything on Home
leaves the accessibility tree with it**. Measured on the running app:

| | result |
|---|---|
| `getByLabel('Log Body Weight')` | **1** |
| `getByRole('button', { name: 'Log Body Weight' })` | **0** |
| the same `getByRole` after one `Escape` | **1** |

So a Home spec does not fail saying a modal is in the way. It fails claiming the affordance it wants
**does not exist** — a very convincing wrong answer, on markup that is entirely correct.

Every fresh browser profile is exposed: the prompt fires whenever `ta_morning_checkin` is absent and
the user has no `morning` check-in row for today, which is what CI provisions on every run.

**Exposure is not the same as failing, and the difference matters.** The sheet opens after an async
read (the local store on device, `/api/day-checkin` on web), so whether it lands before or after a
spec's first interaction is a **race** — which is why one spec read as *deterministic* and the other
as *flaky*, and why `home-card-invalidation-refetch` passed for weeks before it did not.

**What was NOT established: why the race began landing the other way on 2026-08-25.** BF-23 dated
the turn precisely (green at 02:26, red at 03:46, six merges between) and read it as a content
regression in one of them; that reading is wrong — none of the six touched Home's tiles, the sheet,
or the check-in prompt. Adding spec files shifts Playwright's worker distribution and so what runs
before what, which is a plausible mechanism and is **not proven**. This fixture removes the race
rather than explaining it, which is the right fix either way but is worth not overstating.

`e2e/fixtures.ts` gains `suppressMorningCheckin(page)`, pre-setting the marker a returning user's
browser would already have. The date comes from the **user's** timezone, not the runner's: the
marker is compared against `todayInTz(tz)` (`session-select-content.tsx:107`).

## Two wrong turns, both worth recording

**OR-1's own trace was wrong, and reasonably so.** It reported that `Log Body Weight` *"exists
nowhere under `app/`, `components/` or `lib/`"* and inferred that weight logging had moved to Health,
warning that re-pointing the selector would make the test pass while testing nothing. The string is
**composed** — `aria-label={`Log ${def.label}`}` in `metric-tiles-card.tsx:96`, with the label from
`WIDGET_DEFS` — so a grep for the literal finds only the specs. The sheet it opens is
`log-value-sheet.tsx`, not the `metric-log-sheet.tsx` the trace landed on, and that sheet's
`placeholder={`Enter ${widget?.unit}`}` produces the `Enter kg` the spec wants. **Every selector in
the spec was correct all along.** OR-1's warning was still the right instinct and is why the fix is a
fixture rather than a new selector.

**And I built a fix on the wrong theory before measuring.** Seeing a `<button>` inside a
`<div role="button">`, I restructured the tile into a `role="group"` of two sibling buttons, on the
reasoning that ARIA makes a button's subtree presentational. It type-checked and looked right — and
the rewritten markup still reported **0**, because the cause was three levels up on `<main>`. Testing
the *original* markup with the modal dismissed returned **1**, which is what retired the theory. The
component change was reverted in full; it fixed nothing and would have been unrequested churn on a
hot screen.

## Verified

- `home-card-invalidation-refetch.spec.ts` — **3 passed** (was failing at line 59 on every run).
- Full local suite: **61 passed, 2 failed** — `first-run-empty-states` and `goal-invalidation`, which
  **fail identically with these changes stashed**, so they are not this change. They are local-seed
  drift from this session's own probes (food rows inserted and deleted, the seeded user's timezone
  moved twice); CI provisions a fresh database, and OR-1's report of the CI runs names neither.
- `tsc --noEmit` clean · eslint clean · `pnpm check:rules` **Ran 56 of 56**.

## Left alone deliberately

`calorie-progress-bar.spec.ts` and `one-calorie-budget.spec.ts` also drive `/` but assert through
`getByText`, which reads the DOM rather than the accessibility tree and is unaffected. They pass. They
are one line from being exposed the moment either starts clicking, and the fixture is there when they
do — but changing green specs that have no defect is not this PR's business.

## BF-23 struck with it

The BugFix agent filed **BF-23** independently for the same failure — same spec, same line, same
selector — while OR-1 was open, and it is removed from the queue here. Its diagnosis was wrong in
the same direction as OR-1's (a content regression in one of six merges, "#451 is the first place to
look") and its timing evidence is the best thing about it: it is what forced the correction above
about what was and was not established. Two agents filing the same red independently, hours apart,
is the cost of a check that does not block.

## Not exercised

Nothing device-related; this is test-harness only. The Morning Check-in prompt's own behaviour is
unchanged — the fixture writes the same marker the app writes on save or dismiss.
