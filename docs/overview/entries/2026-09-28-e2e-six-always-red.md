# LA-176 — five of the six were the app changing and nobody updating the spec

**Branch:** `fix/e2e-six-always-red` · **Lane B** · `components/**`, `e2e/**`.

Six E2E specs failed on every PR that ran the full suite, and nothing noticed because E2E is
advisory. The entry asked for a triage before any fixing: regression or stale test, one line each.
Reproduced all six locally against `main` first.

| spec | verdict | cause |
|---|---|---|
| `home-card-invalidation-refetch` | **product defect** | every Home section is `aria-disabled="true"` |
| `la109-back-from-subroute` | **product defect** | same |
| `food-log-swipe-delete` | **stale fixture** | seeds a NULL `meal_type_id` |
| `meal-plan-library-surface` | **stale test** | LB-159 flipped the default the day before |
| `one-calorie-budget` | **stale test** | RV-208 ① added thousands separators |
| `rv38-body-battery-no-data-badge` | **stale test** | RV-211 ② replaced the badge with stronger copy |

## The one real defect

`HomeSortableSection` passes `disabled: !editMode` to dnd-kit's `useSortable`. **That stops the
drag; it does not stop the decoration.** Measured at 412 px, every Home section carried
`role="button" aria-disabled="true" tabindex="0" aria-roledescription="draggable"` — outside edit
mode, permanently. A screen reader announced each card as a disabled button, each section took a tab
stop that does nothing, and Playwright, correctly following ARIA, refused to act on anything inside
them.

Attaching the ref only in edit mode is the whole fix. `bf205-home-section-drag.spec.ts` still passes
both its cases, so reordering and the edit-mode-only handles are intact.

**It reached further than the two specs.** Of the six "sometimes fails" specs the entry also listed,
five now pass — including all five tabs of `tabs-instant-paint` and all three of
`tn85-sleep-verdict-on-home`, both Home surfaces.

## The stale four, and one of them is mine

`food-log-swipe-delete` seeded `food_logs` with `(SELECT id FROM meal_types … LIMIT 1)`. The six
default meal types are created **lazily by the app** on the first nutrition read, never by the
database seed — so on a fresh database, which is every CI run, that subquery is NULL and the insert
dies on a not-null constraint. It passed locally only because an earlier run had already made the
app create them. **That is the whole reason this one failed on CI and on nobody's machine.** The
spec owns its meal type now.

`meal-plan-library-surface` asserted the saved-meals toggle starts off. **LB-159 — mine, shipped the
day before — made it start on for an account that has saved meals**, and I did not update this spec
or the picker's own docstring, which still said "off by default". Both corrected, and the spec now
exercises both directions rather than only the off→on tap.

`one-calorie-budget` interpolated the budget bare into `\d[\d,]* / ${total} kcal`. RV-208 ① gave
that exact card `toLocaleString()`, so `2548` renders `2,548`. `rv38` asserted a "Limited data"
badge that RV-211 ② deliberately suppressed for a zero-data account in favour of "No data yet" —
*"the stronger statement of the same thing"*. RV-38's requirement is unchanged and still asserted;
what satisfies it moved.

## What is left, filed as LB-178

Fixing the fixture unblocked six tests in `food-log-swipe-delete` that had never executed. They
pass — but across three runs, two failed a **different** swipe-timing test each and the third passed
8/8. And `tn53-sparkline-does-not-span-gaps` fails after five other specs and passes alone. That is
order- and timing-sensitivity rather than a failing assertion, and it is what LB-56's "should E2E be
required" decision actually needs measured.

## Verification

`tsc` clean · Custom Rules **83 of 83** · lint 0 errors, 831 warnings · full unit suite green ·
build clean. All six specs pass, `bf205-home-section-drag` still passes, and the six intermittent
specs are five-of-six.

**A local diversion worth recording:** `check-test-typecheck` reported 2 errors in
`lib/health-connect-sync.ts` that also appeared on clean `main` while CI was green. It was local
`node_modules` drift — `pnpm install --frozen-lockfile` cleared it. Not a repo defect, and CI
installs frozen so it never saw it.

**Not exercised:** the device. The a11y fix is a ref attachment with no layout change, and the rest
is test code.
