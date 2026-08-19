# 2026-08-19 — an invalidated cache key now tells the component reading it (Q-402)

Lane B. v1.325.1. One new hook, one signal in the cache module, one hook converted, one Q filed.

## What the owner reported

*"noting the widget energy bar doesnt update natively; requires a restart of the app."*

## The half that already worked

`lib/cache-groups.ts` clears `energy-balance:` from **six** write groups, and it always did. The
entry was correctly evicted every single time. This was never an invalidation bug.

## The half that did not exist

Nothing told the component reading the key to go and get a new one. `useEnergyBalanceToday` seeded
from cache and then fetched once:

```ts
useEffect(() => {
  cachedFetch(`energy-balance:${today}`, …, ENERGY_BALANCE_TTL, d => setData(d ?? null))
}, [])          // ← once per mount, never again
```

That shape is fine for a screen you navigate away from — the next mount refetches. It is silently
wrong for anything in the **persistent tab shell**, which never unmounts. `HomeEnergyBalanceCard`
kept its first payload until the app was killed. Exactly the reported behaviour.

**The repo had no subscribe-to-invalidation mechanism at all** — no cache event, no listener.
`TAB_NAV_EVENT` exists and is navigation only.

## What shipped

- **`subscribeToInvalidation(fn)`** in `lib/sqlite/cache.ts`. `invalidateCache(prefix)` notifies
  after the delete lands, so a listener that refetches cannot repopulate the key before it is gone.
  A plain module-level `Set`, not a `window` event: the cache module is the only thing that
  invalidates, subscribers are in the same bundle, and a DOM event would need a server guard and
  would not fire in the node test environment where this is asserted. A throwing listener is caught
  and logged — this runs on every write path in the app, and one bad subscriber must not turn a
  mutation into a failed one.
- **`useCachedValue(key, url, ttl)`** in `lib/hooks/use-cached-value.ts`. Seeds from cache in an
  effect (never a `useState` initializer — session 165's hydration mismatch), fetches, and refetches
  on a matching invalidation. Prefix matching runs both directions because a group clears
  `energy-balance:` while the reader holds `energy-balance:2026-08-19`.
- **`useEnergyBalanceToday` converted** to it, and reduced to five lines.

## Two things deliberately not done

- **`ENERGY_BALANCE_TTL` is untouched.** The Q-402 entry says so and it is worth repeating: the
  effect never ran again, so the TTL was never consulted. Shortening it adds load and hides the
  defect.
- **No visibility gate on the refetch.** An off-screen card in the shell will refetch. That is one
  GET against a correctness bug, and `cachedFetch` de-dupes concurrent requests for the same key, so
  a write clearing several groups at once still produces one request.

## The other 36

A scan for `useEffect(…, [])` blocks containing `cachedFetch` found **37**, this one included. The
other 36 have the same shape and are **latent rather than broken**: almost all sit in components that
unmount, so their next mount refetches. Some are deliberately fetch-once — a sheet snapshotting data
at open, the sync provider's warm pass — and converting those would add refetches with no reader
waiting. Filed as **Q-359**, with the suggestion that a shrink-only Custom Rules baseline may be
worth more than the sweep: it freezes the count and makes each conversion visible, which is the part
that actually matters.

## Verification

Five unit tests on the signal, mutation-checked twice: commenting out the notify call reddens three,
and removing the try/catch around listeners reddens the throwing-subscriber case.

## What was NOT exercised

- **`useCachedValue` itself is not unit-tested.** Both vitest projects are `environment: 'node'` and
  `@testing-library/react` is absent, so there is no route to rendering a hook. What is asserted is
  the signal it consumes; the wiring between them is read, not run.
- **The owner's exact scenario is unconfirmed end to end** — log from Home and watch the bar move,
  without leaving the tab. **Three E2E probes all measured zero `/api/nutrition/energy-balance`
  requests**, so none of them ever reached the thing under test, and none was committed
  half-working. Two fixture gaps found on the way, both worth knowing before the next attempt:
  the seeded user has **no `height_cm` / `date_of_birth` / `sex`**, so the card sits in its
  "add your details" state; and `HomeEnergyBalanceCard` is an **opt-in** Home widget —
  `DEFAULT_CARD_WIDGETS` in `lib/home/home-prefs.ts` is an empty array, so nothing renders it by
  default. Setting `ta_ss_cards` via `addInitScript` was not enough on its own. **A guard for this
  needs a fixture that turns the widget on and gives the user a body, and that fixture does not
  exist** — which is also why the bug survived to a user report.
- **No device run**, and the persistent shell is what makes this reproduce: a browser reload masks
  it entirely. This is a JS-only change, so it reaches the APK on the next Railway deploy with no
  rebuild — but the check the entry asks for is still owed.
