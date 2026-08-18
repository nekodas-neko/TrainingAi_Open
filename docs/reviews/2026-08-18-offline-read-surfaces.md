# Review — offline read surfaces, driven for real

**Date:** 2026-08-18 · **Agent:** Review 📖 · **Sweep 38** · **Finding:** Q-555 (narrow)

## Why this lens

This role's baton has listed *"the offline and error paths — everything ran against a healthy server
on a live network"* as structurally untested since sweep 1. Sweep 30 had just shown that a surface
written off as unreachable (*"needs configuration"*) dissolved in about a minute. Playwright's
`context.setOffline(true)` is the same kind of barrier: assumed, not tested.

## The app works. Both offline paths deliver.

**1. A full-page load offline serves the precached fallback.** With the service worker controlling
the page, going offline and reloading renders `/offline` verbatim: *"You're offline. This screen needs
a connection. Your saved data is still on the other tabs — reconnect to load this one."* The precache
succeeds even under `next dev` (`offlineCached: true` on the very first load).

**2. Offline client-side navigation paints the full cached surface.** Tapping a tab offline, with the
worker in control:

```
READY  controller=true  url=/            chars=674
AFTER  url=/health      navigated=true   chars=2515
AFTER  offlinePage=false  healthOnlyMarker=true
```

**2515 characters against an online baseline of 2486 — about 101%.** No offline page, no skeleton, no
blank. That is the instant-paint and offline-first design doing exactly what `CLAUDE.md` describes.

Worth stating plainly: this is the strongest positive result of the run. The offline story is not
aspirational here.

## Q-555 — but both depend on the worker being in control, and on the first session it is not

Every result above holds only when `navigator.serviceWorker.controller` is non-null. In the
**uncontrolled** state, measured repeatedly, the same tab tap is a **silent no-op**:

| State | Offline tab tap |
|---|---|
| `controller: true` | navigates, paints 101% of cached content |
| `controller: false` | **URL unchanged, no navigation, no offline page, no feedback of any kind** |

The uncontrolled state is not exotic — **it is the first-ever page load.** The worker registers
*during* that navigation and only activates and claims afterwards. So a user's genuine first session,
if it goes offline before the worker claims, gets a tab bar where taps do nothing and nothing explains
why.

**Severity: low, and narrow by construction.** It needs a first-ever load (or a cleared worker) plus
connection loss inside that window, and it self-heals on the next load. It is filed because the
symptom — *a tap that does nothing, silently* — is indistinguishable from a frozen app, and because
on the APK the service worker **is** the offline cold-start mechanism, so the install-day window is
exactly when a new user is most likely to be moving between networks.

**Not diagnosed:** whether the no-op is Next's router aborting a failed RSC fetch, or the click
handler swallowing it. Establishing that needs the router's internals, not another probe.

## Method — three retractions, and the second is the useful one

This took five probe iterations. **Three produced plausible, specific, wrong answers**, and every one
would have been publishable as written.

**1. "No offline page is served on any surface."** Two pages × three network states, a clean table of
zeros. Wrong: the reload happened while the worker was still uncontrolled. **Registration is not
control** — `getRegistrations().length === 1` was already true on the failing load. The field that
mattered was `controller`.

**2. "38% of cached `/health` content survives offline."** The offline body was 950 chars; the *home*
page's own online size was 921. The click had never navigated — `navigated=false`, URL identical
before and after. I was measuring the home page against a `/health` baseline.

**And the marker signal agreed with it, and was also wrong.** The regex used `Sleep|Readiness` as
evidence of the health surface; the home page renders widgets with exactly those labels. **Two
signals agreed and both failed for the same reason.** Only the URL — the one signal that content
overlap cannot fake — settled it.

> **Corroboration between two weak signals is not evidence when they can fail for the same reason.**
> That is a sharper rule than "print the independent variable", and it is the one worth keeping.

**3. The `controller` flag was true after two loads in one run and false after the identical sequence
in the next.** Activation races the navigation. Any probe that *assumes* a fixed number of loads is
measuring a coin flip — the final version waits for the property instead.

## Not exercised

Web build at the S25 viewport against the seeded database. **Not on device**, and that limit is
load-bearing here: on web `cachedFetch` falls back to `localStorage`, so what was measured is the
**seed** path, not the native SQLite local store that is the actual source of truth on the APK. The
offline-first guarantee this sweep confirms is therefore the weaker, web half of it. Q-555's
first-load window in particular should be re-checked on device, where the worker's install timing and
the WebView's lifecycle differ.
