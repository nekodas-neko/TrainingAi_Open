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
- **If a tap does nothing, suspect a gesture handler before you suspect hydration.** On Nutrition a
  real touch sequence does not open the water sheet while a synthesised `click` event does — filed
  as Q-309, with the workaround and its reasoning in `water-log-write-path.spec.ts`. A spec that
  cannot tap the way a user taps is testing something adjacent to the product, so it is a finding to
  chase rather than a pattern to copy.

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
