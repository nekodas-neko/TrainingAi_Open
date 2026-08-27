# 2026-08-27 — `fix/food-row-spec-flake` (PS-14) — the flake was the service worker, not a remount

**Lane B · v1.389.1 · one entry closed (PS-14), one CI check added.** Test-only; no product code
changed.

## What PS-14 proposed, and why it was wrong

The entry theorised that `IngredientPicker`'s `key={buildSession}` remount discarded the typed
query before the 700 ms debounce could see it, and proposed wrapping the `fill` in a `toPass` loop
that re-types until the value sticks. It was careful to say the mechanism was **a hypothesis, not a
diagnosis**, and had never been reproduced locally. Good instinct: it was wrong.

**Testing it is what found the real cause.** A probe asserting the value survived the fill —
`await expect(search).toHaveValue('spec mismatch')` — passed **8 runs out of 8**. The query was
never being discarded, so the proposed patch would have added a retry loop around a step that was
already working, and the flake would have continued.

## What it actually is

`public/sw-template.js:108` answers **every** `/api/` request with
`e.respondWith(fetch(e.request, { cache: 'no-store' }))`. That fetch is issued *by the service
worker*, and Playwright cannot intercept those — its own types say so (1.62.1, `types.d.ts:10184`:
route *"will not intercept requests intercepted by Service Worker"*, recommending
`serviceWorkers: 'block'`).

The worker calls `skipWaiting()` then `clients.claim()`, so it takes control **mid-page-life**
rather than on the next navigation. Whether a given fetch is stubbed therefore depends on whether
the claim has landed yet — and the picker's 700 ms debounce puts the food-search request right
around that moment. That is the whole flake, and it explains the shape PS-14 measured: fail → pass →
fail across three CI runs on a Bluetooth branch touching no nutrition file.

**Reproduced directly**, rather than inferred: with a stub counting its own hits, a page-context
fetch **before** the claim reached the stub, and the identical fetch **after** the claim did not —
the real route answered, returning `{"results":[]}` where the stub would have returned a row.

## The part that stings

**This rule was already written down.** `e2e/README.md` has stated it since
`recipe-url-to-meal.spec.ts` hit the same thing. Six specs stub an `/api/` route; three carried the
guard and three did not — and **two of those three were written by me earlier today**
(`empty-meal-library.spec.ts`, `meal-plan-library-surface.spec.ts`), because I wrote new e2e specs
without reading the e2e README first. They passed, which is exactly what a race looks like before it
bites; PS-14's own text predicted it of them.

So this is not "a rule nobody knew". It is a rule prose could not hold, which is the repo's standing
argument for a script. `scripts/check-e2e-api-stub-sw.js` now fails the Custom Rules job on any spec
that stubs `**/api/…` without `serviceWorkers: 'block'` — **Ran 61 of 61** after adding it.

## Verification

- The check **fails on a real offender** (guard removed from `food-row-shared.spec.ts` → exit 1
  naming that file) and passes with it restored. Run both ways, not just the green one.
- All three previously-unguarded specs fixed; all six now carry it.
- `pnpm check:rules` — Ran 61 of 61.
- The probe spec and the temporary `toHaveValue` assertion are both removed — they were instruments,
  not tests.

## Not exercised

**Whether this fully closes the flake on CI.** The mechanism is proven and the guard is the
documented remedy, but PS-14's failure was CI-only and eight local runs never reproduced it, so the
only real confirmation is `food-row-shared.spec.ts` staying green across future CI runs. Nothing
here can prove that today.

The other three `/api`-stubbing specs were latent, not observed failing — they are fixed on the same
mechanism, not on their own evidence.
