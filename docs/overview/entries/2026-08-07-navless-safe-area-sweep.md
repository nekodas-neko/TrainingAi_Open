# 2026-08-07 — Navless takeover screens swept onto the floored safe-area utility

**Domain:** app-shell — v1.267.20, JS-only (no APK rebuild) — **NOT device-verified**

## The report

Q-118, found by the 2026-08-07 full-app review (§2.4). The cleanest possible evidence was a
single ternary: `components/activity/activity-screen.tsx` renders `<RunActiveScreen/>` or
`<ActiveActivityScreen/>` from the same parent, same navless `/activity` page, same bottom
Pause/Finish action row — but `run-active-screen.tsx` already used the floored `pb-safe-action-lg`
while `active-activity-screen.tsx` used plain `pb-safe-action`. The divergence was *within* the
same feature.

## Why this is the documented failure class

`pb-safe-action` is `max(env(safe-area-inset-bottom), 0.75rem)`. Under Capacitor edge-to-edge on
Android gesture-nav, the inset the WebView reports is tiny (~16–24px) or reports 0 — so the
`max()` collapses to its floor, 0.75rem, which is not enough clearance and the button sits flush
against the gesture bar. `pb-safe-action-lg` (`max(env + 2rem, 4rem)`) exists specifically to fix
this, and was already the reference fix for workout screens. Activity, fitness-test, and
guided-walk takeovers are the exact same class of screen (full-screen, no header, no bottom nav)
and were simply never included in that original sweep.

## Sites fixed

Pure Tailwind class swap (`pb-safe-action` → `pb-safe-action-lg`), no logic changes, at all 6
flagged sites:

- `components/activity/active-activity-screen.tsx` (the primary/reference site from the report)
- `components/fitness-tests/test-active.tsx` (two occurrences — the phased-HRR branch and the
  plain-timer branch)
- `components/guided-walk/walk-active.tsx`
- `components/guided-walk/walk-config.tsx`
- `components/guided-walk/walk-summary.tsx`
- `components/activity/done-activity-screen.tsx`

Both utility classes were confirmed to already exist as the correct floored variants in
`app/globals.css` before touching any component — this was purely a wrong-utility-chosen bug at
each site, not a missing-class one.

## Verification

`tsc --noEmit -p .` and `eslint` clean on all 6 touched files. Full suite: 404 files / 3197 tests
green (no test coverage exists for Tailwind class names, as expected — this isn't logic).

Checked one site visually against `pnpm dev`: `walk-config`'s "Start walk" button renders with
correct extra bottom clearance and no layout breakage (screenshotted). The web sandbox does render
a visible difference between the two classes even with `env()` at 0, since their floors differ
(0.75rem vs 4rem) — confirming the class change actually applies and doesn't break anything
render-wise.

**This is explicitly NOT the verification that matters for this bug.** `env(safe-area-inset-bottom)`
renders 0 in the web sandbox regardless of which utility is used — the actual failure mode
(Capacitor edge-to-edge reporting a near-zero real inset that the `max()` floor is supposed to
compensate for) can only be observed on a real Android device with gesture navigation. This PR
ships the code fix with an explicit "not yet device-verified" disclosure per the Canonical Runtime
policy, rather than blocking on device access this session doesn't have.

## What device verification needs to check

Per `docs/device-smoke-checklist.md`, on the S25 with gesture-nav enabled:
- Start a tracked activity (run/walk/treadmill) → Pause/Finish row clears the gesture bar.
- Start a fitness baseline test → "End test early" clears the gesture bar.
- Start a guided interval walk → the config screen's "Start walk" and the active-walk screen both
  clear the gesture bar, and the walk-complete summary's action row does too.
- Confirm no double-padding or excessive whitespace at the bottom of any of these screens (the
  `-lg` variant's floor is noticeably taller — 4rem vs 0.75rem — so a visual check for "too much"
  padding is as relevant as "too little").
