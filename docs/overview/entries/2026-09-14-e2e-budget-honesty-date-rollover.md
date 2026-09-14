# 2026-09-14 — the nutrition-budget-honesty spec detonated on its own hardcoded date

**Branch:** `fix/e2e-budget-honesty-date-rollover` · Found from a red E2E on an unrelated PR (#1182,
BF-160), which is the only reason it was looked at.

## What happened

`e2e/nutrition-budget-honesty.spec.ts` stubs `/api/nutrition/energy-balance` with a fixed payload
whose `date` was written as the literal `'2026-09-14'`. `nutrition-content.tsx` renders both cards
the spec asserts on under a date guard:

```tsx
<EnergyCard        data={energyBalance?.date === selectedDate ? energyBalance : null} … />
<TdeeAdaptationCard energyBalance={energyBalance?.date === selectedDate ? energyBalance : null} … />
```

`selectedDate` is `todayInTz('Australia/Brisbane')`. At **14:00 UTC on 2026-09-14** Brisbane rolled
over to the 15th, the guard stopped matching, the page rendered its no-balance state, and both
locators became genuinely absent. Two tests, both `toBeVisible()` timeouts at 60 s, on every branch.

**It does not recover.** The literal recedes further from the user's day every hour, so this is the
`scale-ble-day-keying.test.ts` shape — detonates once, stays red — not the
`periodization-soft-delete.test.ts` shape that fires for two hours a day. Both come from the rule
CLAUDE.md already states: a fixture may hold an absolute date only when **both** sides of the
comparison are fixed, and here the other side is the clock.

## How it was established rather than assumed

BF-160's diff touches no nutrition file. That is suggestive and proves nothing, so the spec was run
locally against `origin/main` with the branch nowhere in it: **the same two failures, identically**.
The page snapshot in the Playwright error context was what named the cause — it showed the nutrition
screen rendering fine at the stored goal (*"0 of 1,900 · 1,900 kcal left"*) rather than the stub's
numbers, which is the no-balance state, not a crash and not a missing component.

## The fix

One line: the payload's date is derived from the seeded user's zone at run time.

```ts
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date())
```

`Intl` rather than a DB round-trip because nothing in this file needs the database — the payload is
stubbed precisely so the estimator is not under test. `plan-day-fill.spec.ts:58` is the same shape.

Verified both ways on the local harness: **2 failed on `origin/main`, 4 passed with the fix** (two
setup projects plus the two specs).

## What is deliberately not done here

No guard against the next one. Thirteen specs derive the user's day correctly and this one did not,
which is a gap a check could close — a spec that compares a literal date against a clock-derived
value is statically visible. Filed as its own entry rather than folded in, because this PR's job is
to get `main` green for every branch and a new Custom Rules step is not that.
