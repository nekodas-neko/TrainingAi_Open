# 2026-08-19 — Q-359 slice 4: the can-bite group reaches zero

**Branch:** `chore/adopt-use-cached-value` · **Lane B** · v1.325.9

Fourth and last shell-level slice. **12 sites across 10 files remain, and the CAN-BITE group — the
only one that is a live bug — is empty.** Everything left unmounts on navigate and is latent.

## What was left, and why it needed a second hook

The survivor was session-select's `ta:oura-ble-synced` listener, refetching `sleep-sessions` after a
BLE drain. Slice 1 deleted the identical listener from `home-day-timeline` simply by converting that
widget to `useCachedValue` — the hook refetches on invalidation, so the bespoke listener had nothing
left to do. That trick does not work here: this screen's sleep read seeds from the local SQLite store
*and* wraps its fetch in `fetchWithRetry`, and `useCachedValue` replaces a read outright — it holds
the value, seeds it and fetches it. A read it cannot own still needs the half the hook exists for:
**something has to ask for a new value when a write clears the old one.**

So `lib/hooks/use-invalidation-refetch.ts`: `useInvalidationRefetch(keys, onInvalidated)`. It is the
escape hatch for reads `useCachedValue` cannot take over, and three screens had already hand-rolled
it against one event.

**Subscribing to the invalidation is strictly wider than listening for the event**, and that is the
actual bug fixed here rather than a tidy-up. `sleep-sessions` is cleared by `invalidateBiometrics` as
well as `invalidateOuraSync` — so a manually-edited sleep row, or a Health Connect ingest, left all
three screens stale until a remount. Only the BLE path self-healed, because it was the only writer
that thought to dispatch an event.

Converted, per the sibling-surface rule, all three at once:

| screen | was | now |
|---|---|---|
| `session-select-content` | listener → `cachedFetch('sleep-sessions')` | `useInvalidationRefetch('sleep-sessions', …)` |
| `health/sleep/sleep-content` | listener → `cachedFetch('sleep-sessions')` | same |
| `health/health-content` | listener → `fetchMeta()` | `useInvalidationRefetch(['body-metadata', 'sleep-sessions', 'readiness-score'], fetchMeta)` |

session-select keeps its listener for the part that is **not** a cache read — it bumps `refreshTick`,
which re-runs four gated effects (readiness, body-battery, training-load, oura-hr-day).

## Coalescing, which the three-key call site needs

`invalidateCache` is called **once per key**, so a group clearing all three of health-content's keys
would fire the subscription three times and run its whole meta load three times over. The hook
collapses a burst into one call through a zero-delay timer. Not a micro-optimisation: `fetchMeta`
issues three requests and a local-store read.

## Verification

- `pnpm dev`, all three screens: Home, Health and `/health/sleep` each render and fetch, **zero
  console errors**. Request counts rise by exactly one per screen visit — a subscription that fired
  on its own writes would show a climbing count, and does not.
- `lib/hooks/__tests__/use-invalidation-refetch.test.ts` guards the pattern from coming back and is
  **mutation-checked**: reintroducing a `cachedFetch` inside a `ta:oura-ble-synced` listener fails it
  by filename. It also pins the two properties that are silent when wrong — two-way prefix matching,
  and the coalescing.
- Full unit suite 4,142 passed. 49 of 49 custom rules. `tsc` clean, lint 0 errors (the six warnings
  in the touched files pre-date this diff — verified by stashing).
- `check-component-size` caught the growth on session-select; the baseline is raised by two with the
  reason, which is what that check is for.

**Not verified:**
- **The staleness this fixes was reasoned from the cache groups, not reproduced.** What is confirmed
  is that `invalidateBiometrics` clears `sleep-sessions` (asserted in `cache-groups.test.ts`) and
  that these screens previously refetched it only on one event. Driving an edited sleep row through
  to a visibly-updated Home would need the sleep-edit flow end to end.
- **The React behaviour of the hook is not unit-tested** — both vitest projects are
  `environment: 'node'` with no `@testing-library/react`. The test is a source guard; the runtime
  evidence is the dev-server pass above.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild. The BLE
  drain path itself is device-only and was not exercised — but it is the path that already worked,
  and it is unchanged for `refreshTick`.

## One unrelated failure found while verifying, and filed rather than absorbed

The full local E2E run turned up `goal-invalidation.spec.ts` failing — *"a steps-goal edit reaches
Health without a reload"*. It is **not this change**: it fails identically on an unmodified
`origin/main` checkout at `968516f`. The panel renders `steps / goal` and the local seed's most
recent `steps` value is 2026-08-17, with today's `body_metrics` row carrying NULL — so there is no
step count to draw the goal into and the locator never appears. Filed as **Q-360**; the durable fix
is a seed generated relative to the run date rather than from literal dates.

Worth stating plainly because the tempting reading was the wrong one twice over: first that a
neighbouring change had broken it, then — once it reproduced on `main` — that it was safe to ignore
because CI is green. Neither is a finding. The finding is that a static seed and an assertion against
*today* drift apart by one day per day, which is the rolling-window class CLAUDE.md already names one
layer down.
