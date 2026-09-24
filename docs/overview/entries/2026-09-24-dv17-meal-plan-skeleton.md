# DV-17 — a skeleton for an answer the cache already had

**Branch:** `fix/dv17-meal-plan-skeleton-on-warm-visit` · **Entry:** DV-17 (Device Verification, sweep 3) · **Version:** 1.465.25

## The report

A per-frame scan of the active panel over three warm rounds of each tab: Health, More and Home
painted no skeleton in 9 of 9. **Nutrition painted one on every visit, 3 of 3** — a 338×108 pulse at
y=512, from ~85 ms to 392–543 ms after the tap. The owner has no meal plan.

## Where it actually was

The entry pointed at `meal-plan-section.tsx:99`:

```tsx
if (loading && plan == null) return <div className="… animate-pulse" … />
```

That line is correct given its props. The defect is one level up. `nutrition-content.tsx` passed:

```tsx
loading={loading && mealPlan === null}
```

For an account with no plan, **`null` is the settled answer** — the synchronous cache seed at mount
already read `meal-plans`, found `plans: []`, and set `mealPlan` to `null`. That is indistinguishable
from "no answer yet", so every warm visit re-pulsed for as long as the background refetch ran.

This is the second entry in a row whose stated location was downstream of its cause (DV-16's two
candidate causes were both wrong as framed). Reading the code before the entry is paying for itself.

## Fix

`planLoaded` tracks whether the plan has been **answered**, by cache or by network, rather than
whether it happens to be non-null:

- set by the synchronous seed when the cache had an entry — the only thing that runs before first
  paint, so settling it any later cannot prevent a flash that has already happened;
- set by the fetch, but **only on a defined payload**: `cachedFetch` swallows `!res.ok` and calls
  back with `undefined`, and treating that as an answer would replace a skeleton with "Build a meal
  plan" for someone who may well have one.

The presentational guard is untouched and pinned by a test, since it was never the defect.

## Verification

4 tests, control-run against `origin/main`: **3 of 4 go red** without the change. The fourth pins
the component as unchanged and correctly passes either way.

`npx tsc --noEmit` clean · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 77 of 77** · the whole
nutrition suite, **337 tests across 37 files**.

**Not exercised:** the device. DV-17 keeps its pass test — three warm Nutrition visits on an account
with no plan, zero skeleton frames — which needs the APK and a per-frame scan.

## A ceiling reached, and filed rather than absorbed

The six-line fix took `nutrition-content.tsx` from 795 to **exactly the 800-line limit**
`check-component-size` enforces. It passes; the next line anyone adds does not. Extracting a section
of a 795-line screen to make room for six lines would have been a larger and riskier change than the
fix it carried, shipped unreviewed inside a device-reported defect — so the extraction is filed as
**LB-139** instead of improvised here.
