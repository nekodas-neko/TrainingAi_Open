# 2026-08-04 — Warm the four navigation targets that had no prefetch

**Branch:** `perf/prefetch-missing-nav-targets` · **Domain:** app-shell

## Why

The owner reported navigation feeling not-quite-swift, and clarified it was **not** cold start —
that measured 472 ms and is fine. Two different things were being conflated:

- **The five bottom tabs** stay mounted; switching flips visibility with no network at all. The
  owner confirmed this is instant.
- **Everything else** — detail screens, the workout entry, the exits from a finished session — is a
  real route navigation that fetches an RSC payload from Railway.

`<Link>` prefetches automatically. **A `router.push` from a button does not** (#919), and most of
this app navigates by button.

## What I got wrong first, and the correction

I claimed "42 push sites, ~5 prefetched — roughly 35 cold navigations". **That was wrong**, and it
is the second time in one session I quoted a number without checking it.

Counting per file rather than in aggregate: the sweep has largely **already been done**. The health
detail cards each carry `// Warm the detail route before it's tapped — see oura-score-chip-row`, and
the cardio pickers, walk summary, running plan, log-activity sheet, session-select and
workout-select all prefetch their primary target.

The real gaps were four, not thirty-five.

## What changed

| screen | target | why it matters |
|---|---|---|
| `done-screen` | `/session-select` | **every workout ends here**, and it is the only way forward |
| `done-activity-screen` | `/workout-select` | every activity ends here; all three exits go there |
| `workout-select` | `/cardio` | the strength tile was warmed and the cardio tile was not — picking cardio waited, picking a lift did not |
| `running-plan` | `/cardio` | both back-exits were cold, so leaving was slower than entering |

Each is one `useEffect` following the established pattern, on screens the user is *reading* while
the warm happens — the summary screens especially.

## Deliberately NOT done: the session list

`session-select` prefetches only the **recommended** session's `/workout?session=…`. Tapping any
other session is cold. That is the most-used navigation in the app, so it is the biggest remaining
win — and it is left alone on purpose, because the code carries a deliberate reason:

> *"…in the tab list would be N payload fetches to serve one tap."*

Prefetching every session on mount trades one slow tap for N wasted payload fetches on a screen
that is already the app's busiest. Overturning a documented decision needs a measurement, not an
opinion.

**The idea worth trying instead is prefetch-on-press** — `onPointerDown` warms the route a few
hundred milliseconds before the tap completes, covering *every* session at zero waste. It needs a
new prop threaded into the session-card child components, and it touches the daily workout-entry
path, so it wants a device to verify. Filed rather than rushed.

## Not verified

**Effect, at all.** Prefetch is a client-side behaviour: it cannot be observed from `pnpm dev` or a
test, only from the device. Typecheck, lint and the suite are green, and the pattern is copied from
six existing call sites, but **whether navigation actually feels different is unmeasured**.

The honest next step is a device measurement of *navigation* — the one that was never taken, and
whose absence is why the bundling decision got closed on cold-start evidence that did not cover the
question the owner was asking.
