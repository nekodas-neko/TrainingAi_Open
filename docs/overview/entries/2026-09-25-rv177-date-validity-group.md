# RV-177 (date group) — a date-shaped string that is not a day

**Branch:** `fix/rv177-date-validity` · **Lane A** · `[platform]`

Four of RV-177's nine gaps, shipped together because they are one rule. The other five stay on the
entry with a `Keep:`; each wants its own verification, and a half-checked rate-limit or ownership
change is exactly what this repo's rules exist to prevent.

## The rule, and why the regex was not it

`CLAUDE.md` names two separate guards and they are easy to conflate — I conflated them mid-way
through this and had to back out. The `^\d{4}[-/]\d{2}[-/]\d{2}$` regex on a route schema guards the
**shape**; `normalizeDateParam`/`isCalendarDate` guard **validity**. All four routes already had the
regex, so `2026-02-31` — a real month, a plausible day — passed the gate and reached date arithmetic
or the `date` column, and came back as a bodiless 500 with an `error_events` row. That is Q-496's
shape: a client error recorded as a server fault.

## What shipped

- `ai/health-insight` and `food-logging-complete` take `normalizeDateParamIso` in the handler and
  answer **400**.
- `activity-logs` and `fitness-tests` get `.refine(isCalendarDate, …)` in their **shared**
  validators — the pattern `sync/mutation-schema.ts` already uses. Those validators are shared with
  `pushMutations` on purpose, so this closes the outbox path in the same change rather than leaving
  a device able to write a day that does not exist.

## Two things the entry had wrong, and one is the interesting half

**The slash case is not a validation gap — the right answer is to accept it.** The entry read
health-insight's missing slash conversion as another thing to reject. It is the opposite: the schema
permits `2026/09/10` *deliberately*, because that is what the client's `localDateString()` emits, and
the handler then built `new Date('2026/09/10T00:00:00.000Z')` — Invalid for a perfectly real day. So
the fix converts it. A test asserting 400 for the slash form was written, **failed against the fixed
route**, and was corrected; the passing version asserts it is neither 400 nor 500.

**The line numbers were stale.** `activity-logs:38` and `fitness-tests:38` are inside `POST`, and
neither route has a `date` query param at all — their dates arrive through the shared body
validators, which is why the fix landed there rather than in the routes.

## Verification

Six cases added to `app/api/__tests__/rv55-56-route-input-500s.test.ts`, which already owned this
class. 20 pass.

| mutation | killed |
|---|---|
| health-insight back to the raw date | 3 of 20 |
| food-logging-complete back to replace-only | 3 of 20 |
| drop `.refine` from `ActivityLogBody` | 1 of 20 |
| drop `.refine` from `FitnessTestCreateBody` | 1 of 20 |
| **control:** reword the refine's message string | **0 — survived, as intended** |

**The mutation pass caught a bad test of mine, which is the reason to run it.** The first validator
case asserted `safeParse(...).success === false` — true if the body fails for *any* reason. Dropping
the refine left it **green**. That is the same "right for the wrong reason" trap this very file
records against an earlier case. It now asserts the issue is on the `date` path specifically, and
the re-run kills both refine mutations.

Gates: `tsc --noEmit` clean · lint 0 errors · **Ran 79 of 79 Custom Rules steps** · full suite green.

## Not exercised

Server-side validation only — no schema change, no migration, no local-store change, no device path.
No user-visible behaviour beyond a 400 replacing a 500 on input the app does not send, so no version
or changelog bump. The routes were not driven by hand on `pnpm dev`; the added cases invoke each
route's real `POST` handler directly against the dev database, which is the same path.

## Left open (on the entry, not here)

The **general form is larger than these four and is deliberately not smuggled in**: the shape regex
is repeated in **20+ files** while `isCalendarDate` guards about five of them. That wants its own
sweep entry. RV-177's remaining five groups keep their `Keep:` — of them, only the dead
`logExerciseWithId`/`logSets` pair and `createFoodItem`'s unscoped read-back have been re-verified.
