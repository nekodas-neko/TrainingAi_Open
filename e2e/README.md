# E2E harness

The first tests in this repo that actually run the app (Q-249). 466 vitest files read source or hit
the DB; none of them opened a browser, which is why *"the first review to RUN the app"* (2026-08-08)
found two live bugs that source-reading reviews had walked past repeatedly.

```bash
pnpm e2e              # run everything (starts its own dev server)
pnpm e2e --ui         # pick and watch specs interactively
pnpm e2e -g "Health"  # one spec
```

`DATABASE_URL` must point at the local dev Postgres. The session hook exports a **socket** form;
this harness wants the TCP one:

```bash
export DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'
```

## Two accounts

`auth.setup.ts` signs in the **seeded** user (program, logs, metrics) — the default for every spec.
`zero-data.setup.ts` creates and signs in a second account with **none** of those, for first-run and
empty-state specs. Opt in per file:

```ts
import { ZERO_DATA_STORAGE_STATE } from './fixtures'
test.use({ storageState: ZERO_DATA_STORAGE_STATE })
```

It exists because no empty state was reachable from this harness before it (Q-352), which is why
Q-451 and Q-452 — both first-run bugs — shipped unguarded. The account is created by the setup rather
than by `scripts/local-db/seed.sql` on purpose: `setup.sh` skips the seed when `users` is non-empty,
so an existing local database would never gain it while CI always would, and a spec resting on that
passes in CI and fails locally.

## What a green run does and does not prove

Read this before trusting a pass. Every line here was measured, not assumed.

**It proves the web build works.** `getLocalStore` returns null outside the APK, so every
offline-first domain takes its **web fallback** here. The device branch — the canonical runtime, and
the one that actually holds the user's data — is never executed. A spec that "proves" food logging
has proved the online path only. Treat this the way CLAUDE.md tells you to treat "works locally":
necessary, never sufficient.

**It runs `pnpm dev`, not `pnpm start`.** Not a preference — the pg pool enables SSL whenever
`NODE_ENV === 'production'` (`lib/data/postgres/client.ts:30`), which `next start` sets, so a
production server cannot reach the local non-SSL Postgres at all. Every request dies with *"The
server does not support SSL connections"*, surfacing as a bare `?error=Configuration` on the
sign-in page. Two consequences worth knowing:

- Route handlers compile on first call, so first-visit timings are meaningless. That is why
  `SKELETON_TIMEOUT_MS` is 20 s and why `visitTwice` waits out the `loading.tsx` boundary
  (`aria-busy`) before asserting.
- Dev runs React **StrictMode**, which double-invokes effects and state updaters. That is a feature
  here: this repo's bug history is full of effect-ordering and rehydration faults, and this is the
  only harness that can see them.

**Skeleton checks only cover the panel you can see — so drive the panel.** Health mounts all three
of its tabs at once inside a `SwipeCarousel`, so the inactive panels are in the DOM and, to
Playwright, "visible". A document-wide skeleton check reports those off-screen panels as
instant-paint violations — they are not, because a tab's data is fetched when you swipe to it, by
design. `expectNoSkeleton` therefore counts only elements **inside the viewport**.

That means one spec per screen covers one tab. `health-tabs-instant-paint.spec.ts` closes it for
Health by driving `?tab=` (which `health-content.tsx` reads on mount and in an effect) and asserting
the requested tab is the selected one before checking. Measured both ways: forcing Health's
Body-tile skeletons to never clear does **not** fail `tabs-instant-paint.spec.ts`, and **does** fail
the Body case of the per-tab spec — and only that case. **Any other tabbed screen still has this
gap**; if you add a spec for one, drive its tab the same way and assert which panel is selected, or
you will re-assert the default three times and report full coverage.

**A slow-but-correct load passes.** The 20 s budget cannot distinguish "seeds instantly from cache"
from "seeds in 8 s off the network". It catches a card that *never* seeds, which is the failure the
instant-paint rule is actually about, and it does not catch a regression from instant to sluggish.

**Nothing here touches the S25.** Safe-area insets render as 0, Samsung's WebView compositor is not
Chromium-on-Linux, and gestures behave differently under a real thumb. Those still need the device.

## Rules for adding a spec

- **Seed deterministically.** `pnpm db:local` is idempotent and will not re-seed a non-empty DB. Do
  not write a spec that depends on data another spec created unless you make that ordering explicit.
- **Never assert against a clock-derived date without injecting the clock.** See the
  `scale-ble-day-keying` time bomb in CLAUDE.md's *Date Arithmetic* rules: a fixture pinned to an
  absolute date on one side of a rolling window went red on every branch, months later, on a
  schedule nobody remembered setting.
- **Prove the spec discriminates before you trust it.** Break the thing it watches and confirm it
  goes red. Every spec here was checked that way, and the first version of the skeleton check
  passed a mutation that should have failed it — which is how the viewport limitation above was
  found rather than shipped.
- Specs run serially against one seeded database and one signed-in user. Parallelism would buy
  seconds and cost reproducibility.
- **Assert a direction, not a figure, for anything a rerun changes.** The water spec asserts the
  total *increased*; an absolute litre value would pass on the first run and fail on the second,
  since the seeded DB is shared and not reset between runs.
- **A control that Playwright never clicks may be `aria-disabled` rather than broken.** Playwright
  counts `aria-disabled="true"` as *not enabled*, so `click()` waits for it to become enabled and
  hits the 45 s test timeout instead of failing with anything useful. The browser and a real tap
  both dispatch the click — `aria-disabled` blocks no pointer event — so the app's own handler is
  the only thing refusing the action, and that is usually the thing worth testing. Click it with
  `{ force: true }` and assert the *outcome*, not the attribute: an attribute assertion passes with
  the handler's guard deleted. `nutrition-day-navigation.spec.ts`'s today guard is the reference.
- **If a tap does nothing, suspect a gesture handler before you suspect hydration.** On Nutrition a
  real touch sequence does not open the water sheet while a synthesised `click` event does — filed
  as Q-309, with the workaround and its reasoning in `water-log-write-path.spec.ts`. A spec that
  cannot tap the way a user taps is testing something adjacent to the product, so it is a finding to
  chase rather than a pattern to copy.

- **Stubbing an `/api/` route needs `test.use({ serviceWorkers: 'block' })`.** `public/sw-template.js`
  re-issues **every** `/api/` request — no method filter — so once the worker controls the page the
  request comes from the worker and **`page.route` never sees it**; Playwright's own types say so
  (1.62.1, `types.d.ts:10184`: route "will not intercept requests intercepted by Service Worker").
  The worker calls `skipWaiting()` then `clients.claim()`, so control arrives **mid-page-life**
  rather than on the next navigation — which is what makes it a race rather than a constant, and why
  the spec passes locally and fails on CI *sometimes*, with the real route answering in the server
  log. Measured on `recipe-url-to-meal.spec.ts`: three attempts hit the route, a fourth was stubbed
  and passed.

  **`scripts/check-e2e-api-stub-sw.js` enforces it now (PS-14).** This paragraph alone did not hold:
  three specs were written against it afterwards, two of them on the day PS-14 was filed, by a
  session that had the entry open. PS-14's own hypothesis — a remount discarding the typed query —
  was **wrong**, and testing it is what found this: a probe asserting the query survived passed
  8 for 8, while a page-context fetch before the worker's claim reached the stub and the identical
  fetch after it did not. If you are debugging a stubbed route that "sometimes" misses, check the
  worker before you check your component.
- **A spec that WRITES rows must delete them, either side.** The local database persists between
  runs and CI provisions a fresh one, so a spec that leaves rows behind passes on CI **forever**
  while failing every local run after the first. That is the inverse of the aged-fixture trap in
  `CLAUDE.md` and it hides just as well: `recipe-image-to-meal.spec.ts` mints a `food_item` per
  imported ingredient, and on the second run its own leavings came back in the picker's list, where
  a bare-name assertion matched both the ingredient row and a stale search row. Clean up in
  `beforeAll` **and** `afterAll` — before, because a previous run may have died mid-way.

  Two habits make it moot. Assert on the **row's own shape** (`/Spec Flour.*250 g/`) rather than a
  name anything can carry; and run a new spec **twice in a row** before believing it, which is the
  cheapest thing that distinguishes "passes" from "passes once".

- **Never put an `expect` inside a `page.route` handler.** A throw there skips `route.fulfill`, so the
  app's request breaks and the failure surfaces several assertions later as something unrelated —
  a locator error, usually. Record the request and assert in the test body.

## Layout

| Path | What it is |
|---|---|
| `auth.setup.ts` | Signs in through the real form once; saves `storageState` for every spec |
| `fixtures.ts` | Seed credentials, `visitTwice`, `settleRouteBoundary`, `expectNoSkeleton` |
| `tabs-instant-paint.spec.ts` | The five tabs paint real content on a repeat visit |
| `health-tabs-instant-paint.spec.ts` | The same, per Health panel (Training / Body / Progress) |
| `goal-round-trip.spec.ts` | A goal edit reaches the server and shows on another tab (guards Q-260) |
| `goal-invalidation.spec.ts` | A steps-goal edit reaches Health's Progress panel client-side. Its header records why a Q-240 cache-invalidation guard is **not possible** here — measured, after two attempts |
| `water-log-write-path.spec.ts` | A logged value appears on the screen that triggered it, no reload |
| `.auth/` | Generated session state — git-ignored, never commit it |
