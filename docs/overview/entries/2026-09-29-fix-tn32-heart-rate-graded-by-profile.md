# TN-32 — the Heart Rate page alarmed at a rate inside the user's own Zone 1

**Branch:** `fix/tn32-heart-rate-graded-by-profile` · **Version:** 1.484.1

`app/health/heart-rate/page.tsx` graded with fixed cuts — `<60` Resting, `<100` Normal, else
Elevated — and painted the 60–100 band `#f87171`, a red the zone palette uses for nothing in that
range. It was the only place in the app a heart rate was graded without the user's own resting and
max.

For this owner that is most of a sitting day: resting 52, max 185, so Zone 1 runs to about 132 bpm
and every reading from 60 up was red while inside his own Recovery band.

## What shipped

`gradeHeartRate(bpm, profile)` in `components/health/hr-grade.ts`, pure and tested:

- the bands come from `computeHrZones` — the one place they are built — and the colour from the
  zone itself, never a second palette;
- a true resting rate reads **Resting**, using `HR_REST_THRESHOLD`, the same rest boundary Body
  Battery and the activity score use, rather than a fourth invented one;
- **with no profile there is no grade.** Returning null is the honest answer; inventing cuts is what
  this entry exists to remove, and the hero already rendered its label conditionally.

The page reads the profile through `useCachedValue('hr-profile', …)` — the same key, route and TTL
every other HR surface uses.

## Two things the checks caught

- **`check:rules` refused my first fetch.** I wrote a mount-time `cachedFetch` in a `useEffect(…, [])`
  and the fetch-once rule rejected it: that shape holds its first payload for the life of the
  process, so a resting-HR baseline that moved would grade against stale bands until the app was
  killed (Q-402). `useCachedValue` is what the rule prescribes and it is simpler.
- **My e2e stub took the whole screen down, and the control run is what proved it was the stub.**
  A thin `{ maxHr, restingHr }` body for `/api/hr-profile` produced *"Something went wrong — Cannot
  read properties of undefined (reading 'max')"*: `ObservedHrCard`, already on this page,
  dereferences the `observed` profile that response carries. Running the same spec against
  `origin/main`'s copy of the page reproduced it exactly, which is what separated "my change broke
  the page" from "my fixture did". Both stubs now overlay the real response and pin only the fields
  under test.

## Verified

- `components/health/__tests__/tn32-hr-grade.test.ts` — **7 tests**, including the entry's own pass
  test asserted as a sweep: no bpm anywhere inside Zone 1 carries the Peak colour, and every colour
  returned comes from `HR_ZONE_META`.
- `e2e/tn32-heart-rate-graded-by-profile.spec.ts` — **3 tests** at 412 px dark against the real page.
  78 bpm reads **Recovery**, "Normal" is absent, and the rendered colour is asserted **not** to be
  `rgb(248, 113, 113)` — the old red, read off `getComputedStyle`. Plus a genuinely high rate still
  grading Peak, and no grade at all when the profile fails.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **9,535 passed** · `pnpm build`.

## Not exercised

- **Real live HR.** Both the reading and the profile are injected; the seeded user has neither, and
  the hero renders an em-dash with no grade without them.
- **The device.** No native, safe-area or gesture change, but this is a colour change on a screen the
  owner reads daily, and Samsung WebView rendering is not covered here.
- **No screenshot.** The computed-colour assertion is a stronger check than an image for this
  particular fix, and it fails if the old red returns.
