# 2026-08-25 — the rest of Q-499's card sweep, enumerated rather than estimated

**Branch:** `fix/card-error-states-sweep` · **Lane B** · no schema, no route, no APK.

Q-499 shipped two cards on 2026-08-24 and left a `Keep`: *"the other ~10–18 candidate cards from the
2026-08-18 sweep remain an unenumerated worklist"*. The review's own file list was not retrievable,
so the number was a grep estimate. This is the enumeration, the per-file judgement, and the fixes for
the three that were genuinely the Q-499 shape.

## What the Q-499 shape actually is

A component whose **entire render** is gated on a fetched value, where the failure and the legitimate
empty case collapse to the same `null` — so a 429 or a 500 makes the card *disappear* rather than say
anything. Two things that look like it and are not:

- **A supporting value.** `hr-profile` in `exercise-review-sheet`, `activity-detail-sheet`,
  `day-detail-content`; `muscle-recovery` in `workout-select-content`; `more-user-profile` in
  `session-select-content`. A failure degrades a chart's zones or a label — the surface stays.
- **A documented empty state.** `home-nutrition-zone-bar` (*"renders nothing without a balance,
  which is the same condition under which the old fill rendered nothing"*), `food-logging-complete`,
  `training-stress-line` / `training-stress-badge` (supplementary lines, *"self-hides when gated"*),
  `exercise-detected-card` (its data source has had no writer since the Oura Cloud removal, so it is
  permanently empty by construction, not by failure).

## The three that were real

| card | its `null` also means | what a failure looked like |
|---|---|---|
| `health/oura-section.tsx` | **"no ring connected"** | a connected user's entire ring section gone, the app behaving as though they had never owned one |
| `health/ai-periodization-status-card.tsx` | "no AI-dynamic sessions" | the card gone; a success with none sets `sessions` to `[]`, so a still-`null` `sessions` is exactly a failed fetch |
| `workout/exercise-hr-trend-card.tsx` | "no HR recorded for this exercise yet" | the Heart & Recovery card gone from the exercise-history sheet |

Each now renders the `observed-hr-card.tsx` shape — a bordered row, a `TriangleAlert`, *"Couldn't
load… — pull to refresh."* — and only when the fetch failed **and** there is nothing cached to paint
instead, which is the rule the reference card already followed.

**`.catch()` is not the guard, and `oura-section` shows why.** It had
`.catch(() => {})` on all three of its fetches and still vanished: `cachedFetch`/`cachedFetchToday`
resolve on a non-ok response, so `.catch` sees a network throw and never a 429. `onError` is the only
hook that fires there. The `.catch` arms now set the same flag, so a genuine network throw is covered
by both.

## Verified

`e2e/card-429-error-state.spec.ts` gains a case per card, matching the two already there: route the
endpoint to a 429, load `/health`, assert the error text. **6 passed.** Both new cases were confirmed
to **fail** with the component changes stashed — `2 failed` — so they guard the fix rather than the
page.

`tsc --noEmit` clean · eslint clean on all three files · `pnpm check:rules` **Ran 56 of 56**.

## Not exercised

Not run on the S25 APK. Also not exercised **offline**: `cachedFetch` cannot revalidate at all with
no connection, so what these states do on a genuinely offline first load is untested here — the
`failed && !cached` guard is what is supposed to keep them from firing over a cached paint.
