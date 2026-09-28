# 2026-09-28 — RV-119 crashed Home, and the registry's `report` was the cause

**Lane B.** Branch `fix/home-banner-registry-render-loop`. v1.481.2. **A regression shipped earlier
the same day, in v1.481.0.**

## What was broken

Home died on the root error boundary with **"Maximum update depth exceeded"** — an infinite render
loop — when one of the four collapsing banners changed its presence after mount. A weekly recap
going *loading → error* is the reliable way to reach it, which is why a 429 stub reproduced it every
time.

## The mechanism, and why my own guard did not save it

`HomeBannerPresenceProvider` built `report` **inside** the `useMemo` keyed on `present`, so it was a
new function every time presence changed. `useReportBannerPresence`'s effect lists `report` as a
dependency — it must, since a stale `report` would write into a dead provider — so **every presence
change re-ran every banner's effect**, each of which calls `report` again.

The registry already had `if (prev.has(key) === isPresent) return prev`, and I wrote *"no state
write, so no render loop"* beside it. **That comment was wrong.** The bail-out prevents a state
write; it does not prevent the effects being re-scheduled, because the identity change has already
happened before any of them runs. With a banner whose presence legitimately flips, the cycle never
settles.

**The fix is one `useCallback` with an empty dependency list.** `useState`'s setter is stable, so
`report` never needs rebuilding, and the effect then re-runs only on a real change.

## How it was found, and why nothing caught it sooner

Running an **E2E shard locally** for `LB-166`. Shard 1 came back **13 failed**, and the Home specs
in it — `bf205-home-section-drag`, `calorie-progress-bar`, `day-rollover-checkin` ×3,
`dv22-status-bar-scrim` ×2 — were not failing on their own assertions at all. **Home had crashed, so
everything that visits Home failed.** All nine pass again with the fix.

**Three things had to line up for this to ship:**

1. **RV-119's own e2e did not reproduce it.** It drives Home with the banners in a steady state; the
   loop needs a presence *change* after mount.
2. **The sibling sweep missed `card-429-error-state`.** I updated the unit guard that pinned the
   recap banner's file and never looked for an e2e asserting it on screen — which is the spec that,
   once corrected, caught this.
3. **CI could not tell me.** Both E2E runs since RV-119 merged were **cancelled at the 45-minute cap
   and reported nothing** (`LB-166`). The no-signal state hid a crash I introduced, the same day.
   That is a far better argument for sharding than anything written in that entry.

## The spec that found it, and what it now asserts

`card-429-error-state.spec.ts` guards Q-499's rule — a card says it failed rather than silently
vanishing. Under RV-119 that guarantee became two halves, and both are asserted now:

1. **the strip advertises it** (`N ready`, naming *Week in review*), so the failure is visible on
   Home at all; and
2. the message and its retry are **attached**, behind the approved collapse.

**Half 1 is what caught the crash** — with Home on the error boundary there was no strip at all.
`toBeAttached` rather than `toBeVisible` for half 2, because the container is hidden until tapped and
that is the approved information architecture, not a defect. Expanding is deliberately not re-driven
here; `rv119-home-banner-strip.spec.ts` already taps the strip and asserts visibility.

## Verified

- The exact context that reproduced the crash now renders the strip, counts the failed recap, and
  does **not** hit the error boundary.
- `card-429-error-state.spec.ts` — **7 passed**.
- `bf205-home-section-drag`, `calorie-progress-bar`, `day-rollover-checkin` — **9 passed**, having
  all failed in the shard run.
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

## Not exercised

**No automated guard stops the registry regressing to an unstable `report`** — the protection is the
e2e above, which only fails when a banner's presence actually changes during a run. A stability test
would need a React renderer, which this repo does not use for components. **Not device-verified**,
and the crash was never observed on the device: the harness reproduction is a 429 stub, and whether
real timing reaches it as readily is unknown — it plainly could, since nothing about the loop needs a
failure, only a presence change.
