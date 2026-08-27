# 2026-08-26 — `fix/empty-meal-library-e2e` (LB-20) — the empty state gets cover, and the crash turns out to be a dead button

**Lane B · v1.388.1 · one entry closed (LB-20).** Test-only; no product code changed.

## What this closes

v1.388.0 fixed two instances of one defect — a handler with an optional first parameter wired
straight to `onClick`, so React's click event arrived as that argument. The first
(`meal-builder-footer.tsx`) was **observed** through a Playwright network trace. The second
(`food-list.tsx`'s "Build your first meal") was **found by sweep and fixed by inspection**, because
it is only reachable with an empty meal library and no spec had one:
`food-row-shared.spec.ts:109` matches `/^(New|Build your first meal)$/` and always lands on `New`.

`e2e/empty-meal-library.spec.ts` is that spec. Two tests: the meals empty state offers the builder
**and the builder actually opens**, and the single-foods empty state offers no builder (BF-37's
distinction — that list fills itself, and a button there would reach a different thing entirely).

## The design decision LB-20 asked to be made first

**The library is emptied by mocking the route, not by deleting rows.** LB-20 named two options and
said to pick before writing, because the wrong one makes the whole nutrition suite flaky rather than
this one spec:

- **Its own user** — the harness signs in once in `auth.setup.ts` and every spec shares one
  `storageState`. A second user means a second setup project and a second storage state.
- **A route mock** — `page.route('**/api/nutrition/saved-meals', …)` returning `[]`. Per-page,
  mutates nothing, and it is honest here because `getLocalStore` is null outside the APK, so that
  GET is genuinely the only thing filling the list.

The mock wins on both counts. Five other specs read the seeded `saved_meals`; a `beforeAll` that
emptied the table would have made them order-dependent.

## What the reproduction corrected

**The spec was run against the reverted fix before being kept**, which is the point of writing it at
all — and it changed a claim v1.388.0 made. The prediction was that `meal.items.map(...)` on an event
throws. It does. But **React swallows it**: nothing reaches `pageerror`, no overlay interrupts the
test, and the sheet simply stays on an empty Meals tab. The only symptom is a **dead button**.

That matters for how this class gets reported. It would have arrived as *"the button does nothing"*,
not as a crash — which is the harder report to act on, and the reason this was worth a spec rather
than a note. The `pageerror` listener is kept anyway (it is free, and a future React may surface the
throw instead of eating it), with a comment saying it caught nothing here so nobody reads it as the
assertion that works.

## Verification

- The spec **fails on the reverted fix** (`Save Meal` never appears; the yaml snapshot in the
  failure shows the sheet still on `No meals saved yet.`) and **passes with it** — run both ways.
- `pnpm check:rules` — Ran 60 of 60.
- Full Playwright suite re-run, since this adds specs to a shared harness.

## Not exercised

Nothing new: this is a test-only change and the code it covers shipped in v1.388.0. The APK path is
unchanged and remains unverified for that release, as its own entry records.
