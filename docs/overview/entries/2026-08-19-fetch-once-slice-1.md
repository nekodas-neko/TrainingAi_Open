# 2026-08-19 — Q-359 slice 1: six leaf cards adopt `useCachedValue`

**Branch:** `chore/adopt-use-cached-value` · **Lane B** · v1.325.6

Q-402 shipped the mechanism — `subscribeToInvalidation` + `useCachedValue` — and Q-359 froze the 36
sites still doing it the old way behind a shrink-only ratchet. This is the first slice of the sweep:
**six files, seven baseline sites, 36 → 29.**

| file | sites | mounted by |
|---|---|---|
| `components/home-day-timeline.tsx` | 2 | Home (tab shell) |
| `components/calendar-widget.tsx` | 1 (+1 keyed) | Health |
| `components/activity/exercise-detected-card.tsx` | 1 | Home |
| `components/health/hr-recovery-profile-card.tsx` | 1 | Health |
| `components/health/strength-progress-card.tsx` | 1 | Health |
| `components/cardio/trends-section.tsx` | 1 | `/cardio` |

Leaf cards first, deliberately: each owns one key and converts without touching screen state, which
the four tab-screen orchestrators (`session-select-content`, `health-content`, `nutrition-content`,
`workout-select-content` — nine sites between them) do not.

`calendar-widget`'s second effect is the bonus. The ratchet only counts `useEffect(…, [])`, so its
`calendar-data:${year}-${mm}` fetch — deps `[viewYear, viewMonth]` — was never in the baseline, and
it goes stale in exactly the same way: the deps change on a month flip, not on a write. The hook
handles a changing key, so both converted.

## The `today` option, and why the sweep needed it

`useCachedValue` could only speak plain `cachedFetch`. Three of the sites on the list —
`home-day-timeline` among them — call `cachedFetchToday`, the variant that treats an entry stored on
a previous day as a miss. Adopting the hook would have meant **switching their variant**, and
`training-stress` shows why that is not a local decision: it is read at two sites and warmed by
`sync-provider` with `today: true`, so changing one reader silently splits the key across two
freshness semantics. That is the drift the one-variant rule exists to stop.

So the hook takes `today?: boolean` and picks `cachedFetchToday`/`readTodayCacheSync` from it. The
flag is a property of the **key**, not a preference, and nothing in the type system says so — pass
it wrong and there is no error, no throw, just a *seed* that misses, so the card paints blank for one
frame and fills in after the network. That reads as slowness, not as a bug.

`lib/hooks/__tests__/use-cached-value-today-agreement.test.ts` is the guard: it parses every
literal-key `useCachedValue` call and cross-checks the flag against `sync-provider`'s warm list,
which is the one place each warmed key already declares its variant. Mutation-checked in both
directions — flipping `weights-summary` to `today: true` fails it by name, and breaking the call-site
regex fails the "finds the call sites at all" assertion rather than passing vacuously.

## A hand-built workaround the mechanism replaced

`home-day-timeline` carried a `ta:oura-ble-synced` window listener, added by Q-91 because the widget
— mounted in the shell, never unmounted — did not refetch after a BLE drain invalidated its entry: a
just-synced night kept showing the pre-sync bed/wake time. **That is Q-402's bug with a workaround
for one event.** The invalidation signal covers every writer instead, so the listener is gone.

Safe to drop because the dependency it now leans on is guarded rather than assumed: both dispatch
sites (`lib/oura-ble/sync.ts`, `components/sync-provider.tsx`) call `invalidateOuraSync()`
immediately before dispatching, and `lib/__tests__/cache-groups.test.ts` already asserts that group
clears `home-day-timeline`.

**Three sibling listeners remain** — `session-select-content`, `health-content`, `sleep-content` —
and should go the same way as those files convert.

## The grouping was wrong again

The can-bite group has now been miscounted twice. The first correction was 14 → 19 (sheets do not
unmount here; the tab screens render them unconditionally with a null prop). The second, found this
slice: `cardio/trends-section.tsx` was filed as "Health, via health-sections" and is not rendered
there at all — its only renderer is `cardio/cardio-content.tsx`, and `/cardio` is not one of the five
tabs in `components/shell/tabs.ts`. **It was 18, not 19.** Converting it was still right; the count
was not. Both errors came from reading the directory a file sits in instead of grepping for its
renderer and checking that against `tabs.ts`, which is now written into the check script.

## Verification

- `pnpm dev` exercised: Home, Health and `/cardio`. Every converted card renders and its route is
  requested — `day-timeline` 1, `oura/workouts` 1, `weights-summary` 2 (warm pass + card, expected),
  `hr-recovery-profile` 1, `calendar-data` 1, `workout-data` 3, `cardio-trends` 1 — with **zero
  console errors** on all three surfaces.
- `home-day-timeline`'s "Today's Timeline" heading renders, which is what proves the `today: true`
  envelope is being read correctly; a wrong flag shows nothing.
- Ratchet: 36 → 29, and it proved itself live by failing on all six files before the baseline was
  lowered.

**Not verified:**
- **The refetch-on-invalidation half was not driven end to end for these six.** The signal is
  unit-tested (`cache-fetch.test.ts`) and the hook shipped verified in Q-402, but no test drives a
  write → invalidation → refetch through one of *these* cards. Both vitest projects are
  `environment: 'node'` with no `@testing-library/react`, so the React half is not unit-testable, and
  the E2E fixture Q-359 asks for (a seeded body plus `ta_ss_cards`) still does not exist.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- The seed moved from `useLayoutEffect` to the hook's `useEffect` in `calendar-widget` and
  `hr-recovery-profile-card`. That is a one-frame difference in when the cached value paints, not a
  behavioural change, and the standing instant-paint rule asks for an effect rather than a
  `useState` initializer either way.
