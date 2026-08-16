# 2026-08-08 — SyncProvider stops doing authenticated work before login (Q-150)

**Branch:** `fix/sync-provider-auth-gate` · **Domain:** `app-shell` (also `platform`) · **v1.270.31**

## What was wrong

`SyncProvider` is mounted in the root layout, so every one of its mount effects runs on **every**
signed-out route. Loading `/sign-in` with no session fired a burst of `/api/*` requests, all 401, one
of them a `POST /api/oura/sync` — an expensive external-sync route reached before the user had done
anything.

The push and pull phases already consulted `userId`. The cache-warm phase and `maybeSyncOura` did
not.

## The count is 22, not 12

The review filed this as 12 calls. Measured here against `pnpm dev` at the 412×915 viewport with a
scripted browser capturing every request for 12 s after load: **22**, all 401.

The difference is not a discrepancy in the finding, it is the observation window. Phase 3 sleeps
2.5 s and then warms all 20 `CACHE_TASKS` in chunks of five, so a network panel read shortly after
load sees roughly the first two chunks. The full list is those 20 plus
`GET /api/oura-ble/freshness` and `POST /api/oura/sync`.

After the fix, the same probe records **0**.

## What changed

`components/sync-provider.tsx` — six effects gated on `userId`:

- **Phase 3 cache warm** — the bulk of the burst.
- **`maybeSyncOura`** — guarded before the function is defined, not inside it, because the effect
  also registers a native `resume` listener that re-invokes it; a guard in the body alone would
  leave the listener bound.
- **The four native-only reminder reconcilers** (meal, workout, supplement, health alerts). These
  are a sibling sweep, not part of the filed item: on the APK they fetch meal types, next session,
  supplements, readiness and body battery before login too. The browser reproduction could not show
  this because all four are behind `Capacitor.isNativePlatform()`.

## Deliberately left ungated

- **Phase 1.** It mirrors already-cached rows into `sessionStorage` and never touches the network.
- **The two BLE radio effects.** They own hardware rather than fetches. A failed post from the step
  orchestrator re-queues in its own `localStorage` retry buffer against a server that dedups on
  `(user_id, start_ds)`, so a signed-out window is recovered rather than lost — and changing when
  the ring radio starts is device behaviour that cannot be verified in this sandbox. Examined and
  found to need nothing, rather than skipped.

## The test, and why it is a source-text check

`components/__tests__/sync-provider-auth-gate.test.ts` brace-matches every `useEffect` in the file
and asserts that none of them reaches the network without consulting `userId`, with the two radio
effects held as an exact-count exemption so a third ungated effect fails the check.

It is source-text rather than behavioural because the repo has **no jsdom environment and no
component tests at all** — every vitest project in `vitest.config.ts` runs `environment: 'node'`.
Rendering this component to assert on its fetches means adding jsdom and a testing library, which is
a dependency decision and not this fix's to make. Same reasoning, and the same shape, as
`lib/local-store/__tests__/insert-arity.test.ts`.

Confirmed it fails on a planted regression: removing the phase-3 guard turns the check red and names
the effect.

## Verification

- `tsc --noEmit` clean · `eslint` clean · full suite **415 files / 3275 tests** green.
- `pnpm dev`, scripted browser at 412×915: `/sign-in` signed out **22 → 0** requests, 0 console
  errors. Signed in with the seeded `test@local.dev` and watched the whole warm cycle — the Oura
  freshness check, the Oura sync POST and the cache-warm chunks all fire as before, **0** 401s.

**Not exercised: the APK.** The four reconciler gates are native-only, so the surface they affect is
precisely the one the sandbox cannot reach. What is verified there is the direction of the change
(they cannot fire signed out) rather than that reminders still schedule correctly signed in on
device.
