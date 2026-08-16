# 2026-08-04 — Measure navigation instead of arguing about it

**Branch:** `perf/nav-timing-instrument` · **Domain:** app-shell · **Version:** 1.255.0

## Why

The bundling-the-shell question was closed against a **cold-start** number (472 ms) when the owner
was asking about **navigation**. Navigation had never been measured at all, on any device, ever. The
prefetch sweep that shipped an hour earlier (#1062) is likewise unverified for the same reason:
prefetch is a client-side behaviour that `pnpm dev` and the test suite cannot observe.

So: instrument it, rather than take another opinion into the next session.

## What it records

Every tap that changes the URL produces one sample:

| field | meaning |
|---|---|
| `urlMs` | press → the URL actually changing. For a cold route this is the RSC round-trip to Railway |
| `paintMs` | press → the first frame after the URL changed. Five routes have a `loading.tsx`, so this can be a skeleton |
| `settleMs` | press → the last DOM mutation before the screen went quiet. The summary ranks on this, because it survives a skeleton |
| `rscCount` | payload fetches the navigation had to make. **0 = the route was already warm** |

`rscCount` is the point of the whole exercise: it turns "did the prefetch work?" from a feeling into
a boolean, per navigation, per route.

Results land in **More → Admin → Device data capture** as one more probe row (`Run all`, then Copy),
which is the flow the owner already used successfully today. There is a **Reset nav timings** button
because a before/after comparison needs an explicit zero point.

## Two design decisions worth not re-litigating

**It does not hook `usePathname`.** A rAF watcher polls `location.href` after a press instead. That
looks like the cruder option and is in fact the only correct one: **`/workout` → `/workout?session=…`
changes only the query string**, so a `usePathname` effect never fires — and that is the app's single
busiest navigation. Verified: the browser run below captured exactly that transition.

**It is always on, not a switch in the console.** An instrument you have to remember to arm before
navigating only ever records the run where you remembered. The cost is one passive capture-phase
`pointerdown` listener plus a string compare per frame for a few seconds after a tap.

## Verified — in a real browser, not just by typecheck

Driven with Playwright against `pnpm dev` (Chromium, 412×915), logged in as the seeded user:

- Tab flips recorded at 80–315 ms, `rscCount: 0` — warm, as expected for `<Link>` tabs.
- **`/workout` → `/workout?session=…` recorded at `urlMs 424.5`, `rscCount: 1`, `rscMs: 243.3`** — a
  genuinely cold navigation with a real 243 ms payload fetch, and the query-only case captured.
- The console row renders, is labelled `on-device`, and returns in 10 ms.
- 18 unit tests on the pure core; full suite 3066/3066; typecheck and lint clean.

## Not verified

**`settleMs` diverging from `urlMs`.** In every local sample the two were equal — the route commits
its DOM in the same beat as the URL, so there was nothing left to settle. The field exists for the
slow-network/skeleton case, and that case was never reproduced here. If a device capture also shows
`settleMs === urlMs` everywhere, the field is telling the truth and is simply redundant on fast
paths; it is not evidence the observer is broken.

**Attribute mutations are deliberately not observed** (`childList`/`characterData` only). The tab
shell flips visibility via an attribute, and Framer Motion writes inline styles per frame — observing
attributes would let an animating screen never go quiet and hit the 6 s watchdog on every sample. A
sample that does hit the watchdog is marked `settleTimedOut` and counted separately, so a floor can
never be misread as a measurement.

**The device itself.** Numbers above are a dev server on the same machine; they say the instrument
works, not what the phone does. That measurement is the owner's next step.

## Next

Capture on the phone: Reset nav timings → use the app normally for a few minutes → Run all → Copy.
`byRoute` sorted slowest-first names what to fix, and `coldCount` per route says whether the answer
is another prefetch or something deeper.
