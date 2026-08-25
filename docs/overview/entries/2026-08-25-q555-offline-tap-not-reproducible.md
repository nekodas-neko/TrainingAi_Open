# 2026-08-25 — the offline tab tap is not silent on current `main` (Q-555 closed, not fixed)

**Branch:** `docs/q555-offline-tap-not-reproducible` · **Lane B** · docs only. No product change, and
the parked branch `fix/offline-tab-tap-native-fallback` should **not** be merged.

Q-555 said that offline, before the service worker claims the page, a tab tap is a silent no-op —
*"URL unchanged, no navigation, no offline page, no feedback of any kind"*. The entry's own remaining
task was to reproduce that tap, after three earlier Playwright attempts failed for three different
reasons. It was driven, and **the silent no-op does not reproduce in either window.**

## How it was driven

Chromium against `pnpm dev`, signed in as the seeded user, with `**/sw.js` aborted at the route
level so `navigator.serviceWorker.controller` stays `null` for the whole run — a deterministic stand-in
for the uncontrolled window that does not depend on catching a race. Confirmed `controller: false`
before every case. `handleNavClick` was temporarily instrumented to print whether it ran, with what
`pathname`, and whether it had an `onTabChange`; the instrumentation was reverted before committing.

## What the three cases actually do

| | state | result |
|---|---|---|
| **1. settled tab route** | hydrated, offline, no controller | tap **navigates** `/health → /nutrition`; `app/error.tsx` renders *"You're offline — This screen needs a connection. Your saved data is on the other tabs."* |
| **2. loading fallback, pre-hydration** | offline, no controller | `handleNavClick` **never runs**; the anchor performs a **native** navigation and lands on Chrome's *"No internet"* page |
| **3. loading fallback, hydrated** (destination RSC stalled 25 s) | offline, no controller | tap navigates `/nutrition → /health`, same explicit offline screen as case 1 |

**Case 2 is proved by the navigation itself, not by the instrumentation.** `handleNavClick` calls
`e.preventDefault()` unconditionally, so a native browser navigation is only possible if the handler
did not run — which before hydration it cannot. Nothing in React is running there, and the worker is
not installed either, so there is no code of ours in a position to respond at all.

## Two of the entry's premises do not hold on current `main`

- **`app/error.tsx` is the missing feedback, and it already exists.** The failed RSC fetch reaches the
  error boundary, which renders an offline screen naming where the user's data still is. The entry
  and the review it came from both list "no offline page" as part of the symptom.
- **`tab-loading.tsx`'s `<BottomNav />` — the one with no `onTabChange` — is not what receives the
  tap.** Measured on the fallback: **one** `<nav>` on screen, and its handler logged
  `hasOnTabChange: true`. `TabShell`'s nav is the live one across the transition. The entry's
  mechanism (point 1 of its diagnosis) is not what happens.

And `TabShell`'s in-app tab switch **does** change the URL, contrary to the diagnosis's *"a tap is
pure in-app state and never routes"* — visible in cases 1 and 3, where the pathname changes.

## Why the parked fix must not ship

`fix/offline-tab-tap-native-fallback` adds a toast inside `handleNavClick` gated on
`offline && !controller`. In case 2 that handler never runs, so the toast is inert exactly where the
defect is real. In cases 1 and 3 the handler does run — and the navigation **works**, so the toast
would be a false alarm on top of a screen that already explains itself. The branch's predicate and
its unit test are sound about the browser state; what is unsound is the assumption that this state
means the tap will be silent.

The predicate file and test are left on that branch as the record. Nothing from it is merged.

## What is genuinely left, and why nothing was built

Case 2 — a first-ever load that loses its connection before hydration — sends the user to the
browser's error page and loses the app shell. That is worse than a no-op, and it is **inherent**: no
JavaScript of ours is running and the service worker, which is the only thing that could serve
`/offline`, has not installed yet. The service worker already does `skipWaiting()` and
`clients.claim()`, so it claims as early as it can. There is no fix available in the click handler or
anywhere else in app code, which is why this closes rather than being re-filed.

## Not exercised

Web build only, `pnpm dev`. Not run on the S25 APK, where the worker's install timing and the WebView
lifecycle differ — the case-2 window may be wider or narrower there. Since the conclusion is that
nothing should be built, the device check is not gating anything; it is recorded here so a future
report of a dead tab bar on install day is read against these measurements rather than against the
entry's original description.
