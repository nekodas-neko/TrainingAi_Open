# 2026-09-24 — RV-164: "Apply Selected" never read a single write's response

**Branch:** `fix/rv164-apply-checks-its-writes` · **Lane:** B (Implementation) · **Domain:** nutrition, app-shell

## What was wrong

`components/profile/goal-recommendation-sheet.tsx` `await`ed three mutations and read none of them:

| Write | Before | After |
|---|---|---|
| `PATCH /api/user/goals` | response discarded | checked; seeds written only on success |
| `PUT /api/nutrition/targets` | response discarded | checked |
| `PATCH /api/user/profile` | `res.ok` checked, failure silent | checked; reports "Activity Level" |
| `PATCH /api/nutrition-goals/<id>` → `applied` | unconditional | only when nothing failed |

Only a *thrown* network error reached the failure toast, so a 4xx or 5xx passed as success. The
recommendation then recorded `applied` — permanently, because the route accepts `applied` or
`dismissed` and nothing between.

Review sweep 57 found it in production: the 2026-09-14 recommendation is `status='applied'` while
`nutrition_targets` still holds the 2026-08-31 values.

**A second, quieter half.** The three `localStorage` seeds were written whatever the PATCH answered.
A refused goals write therefore left the home widgets — which read those seeds synchronously —
showing a value the server had rejected, until the next read corrected them. They are now inside the
success branch.

**And the sibling in the same file.** `handleDismiss` had the identical shape: it closed the sheet on
an unread response, so a refused dismiss left the recommendation pending and the sheet gone, and it
returned on the next read looking untouched. Fixed in the same PR per the sibling-surface rule.

## Partial applies stay pending, deliberately

There is no "partly applied" status, so the choice is between recording `applied` for a half-landed
apply and leaving it pending. Pending wins: the recommendation stays retryable and the queue's view
of it matches the database. The sheet stays open with the toggles as they were, so retrying is one
tap, and the toast names the metrics that did not land.

Calories is stored by *two* routes (`user.calorie_goal` and `nutrition_targets`), so it is deduped —
it is one metric to the reader even when both writes fail.

## Verification

- `e2e/rv164-apply-checks-its-writes.spec.ts` — a real browser at 412 px, everything stubbed so it
  touches no shared seeded row. Forces a 500 from `/api/nutrition/targets` with the goals write
  succeeding, which is the partial-apply case the old code recorded as a clean success.
- **Control-run against `main`'s component: red**, and then measured rather than inferred. With the
  same 500, `main` toasts *"Goals updated"*, closes the sheet, and sends `{"status":"applied"}`.
  That is the production defect reproduced in a browser.
- `pnpm check:rules` **Ran 78 of 78** · `tsc --noEmit` clean · lint clean · `components/profile`
  3 files, 27 tests green.

**Not exercised:** the APK. This is a WebView-only change (no `android/**`, no Capacitor plugin), so
it reaches the device through a normal Railway deploy, but Samsung WebView rendering, safe-area and
drifted production data are untested here. The failure path itself is now covered in Chromium, which
is where it could be driven.

**Deliberately not done:** the 2026-09-14 row is not repaired. Whether the owner meant to apply
1,618 kcal is his question and stays in the queue under RV-161; this fixes the cause going forward.

## Next

Lane B's queue head is RV-166, then RV-167, RV-122.
