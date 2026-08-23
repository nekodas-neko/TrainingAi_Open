## 2026-08-20 — Q-402's fix is guarded, and the Home-card fixture exists (Q-359)

**Branch:** `feat/home-card-invalidation-guard` · test-only, no runtime code changed, no version bump.

Q-359's remaining shell-level work was already done — the can-bite group reached zero in slice 4 —
so what the entry actually asked for next was the fixture: *"whoever takes this should build that
fixture first … because every Home-card guard needs it, and its absence is part of why a shell-only
staleness bug reached a user report."* Built, and used to drive Q-402 end to end for the first time.

**What Q-402 shipped and what was never proven.** The owner's report was *"requires a restart of the
app"*: Home's energy-balance card held its first payload forever. Eviction was never broken — six
write groups clear `energy-balance:` — but nothing asked the card to fetch again, and it lives in
the persistent tab shell, so its `useEffect(…, [])` never re-ran. `useCachedValue` +
`subscribeToInvalidation` are the missing half. **That fix merged unguarded.** Its PR tried three
times and measured *zero* `/api/nutrition/energy-balance` requests, because the harness could not
get the card on screen at all.

**Two fixture gaps, and one of them was described wrongly.**

| gap | as recorded | as measured |
|---|---|---|
| the profile the route needs | seeded user missing `height_cm`, `date_of_birth`, `sex` | it has height 180 and sex male — **only `date_of_birth`** is missing, and the route names exactly that one field in `missingProfileFields` |
| Home renders no cards | `DEFAULT_CARD_WIDGETS` is empty | correct as written |

So `ensureEnergyBalanceProfile()` is one column, `COALESCE`d over the other two so it stays right if
the seed changes, with a **fixed** date of birth — an age that drifts between runs would move the
BMR and every number resting on it. `enableHomeCards(page, keys)` sets `ta_ss_cards` through
`addInitScript` rather than driving More → Home Widgets, so an unrelated screen cannot break every
Home-card spec. Both live in `e2e/fixtures.ts` for the guards that come after this one.

**The guard asserts the request, not the number.** The mechanism under test is *"something asks for
a new value when a write clears the old one"* — a second GET is present only if that works, whereas
a changed figure could come from a remount and an unchanged one proves nothing. Asserting the
absence of staleness would pass either way, which is the Q-452 lesson.

The write is Home's own quick-log sheet, deliberately: **Home stays mounted throughout**, so a
refetch cannot be a remount, which is the entire distinction Q-402 is about. `POST
/api/body-metadata` → `invalidateBodyMetricWrite()` → `energy-balance:` cleared → second GET,
visible in the dev-server log in that order.

**Mutation-checked both ways.** Reverting `useEnergyBalanceToday` to the pre-Q-402
`useEffect(() => { cachedFetch(…) }, [])` shape makes it fail with its own message — *"the
energy-balance card did not refetch after a write cleared its cache key"* — and restoring the hook
makes it pass again.

**One local failure that was not a regression.** `goal-invalidation.spec.ts` went red on the full
run: it needs today's `body_metrics` row to carry a **steps** value, and this container's seed was
filled on 08-18, so 08-20 had no row. Exactly the aged-seed gotcha the Lane B baton records. Fixed
by topping up the row — a data change, not a code one — after which it and the new spec both pass.
CI provisions a fresh database every run and never sees it.

**Verification.** Full local Playwright suite: **28 specs, all passing** after the seed top-up.
`node scripts/check-fetch-once-effects.js` — OK, 12 known sites across 10 files, none new (no site
was converted in this PR). `pnpm check:rules` — Ran 50 of 50 Custom Rules steps, all passed.
`tsc --noEmit` clean.

**Not exercised.** The E2E harness drives the **web** build, where `getLocalStore` returns null, so
the offline-first branch of the write path never ran — the POST went straight to the API. Nothing
was checked on the S25, and no runtime code changed, so there is nothing new to check there.

**Still open in Q-359:** the twelve latent fetch-once sites. Every one unmounts on navigate, so none
can bite, and each needs judging individually rather than a codemod.
