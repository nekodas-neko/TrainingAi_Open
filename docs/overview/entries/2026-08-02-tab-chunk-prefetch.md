# 2026-08-02 — the other four tabs load their code before you tap them (Q-51 Task 2)

_Branch `perf/home-nav-cold-start` · PR #1022 · v1.251.2 · domain `app-shell`_

Q-51 Task 2, the one the owner endorsed by name: *"your idea of prefetch other tabs on load is
probably the right move."* The approach was settled; only the trigger point was open.

## What was slow

Home is a static import so first paint never waits on a second chunk. The other four tabs are
`dynamic()` imports that load on **first activation** — so the first tap of Health, Workout,
Nutrition or More paid a chunk fetch before it could render anything but a pulse skeleton. Repeat
switches were already instant (all five panels stay mounted; a switch is a CSS visibility flip).

That first-tap cost is exactly what the owner described: *"switching tabs and navigating through the
app."*

## What shipped

One effect in `tab-shell.tsx` that imports the four tab modules when the browser goes idle.
`requestIdleCallback` with a 4-second timeout backstop, falling back to a 2-second `setTimeout` on
any runtime without the API (Chromium has it, so the S25 takes the idle path).

**Chunks, not data — deliberately.** Each tab fetches its own data from mount effects, and those do
not run here because nothing is rendered; only the module is downloaded and evaluated. The item is
explicit that warming the four tabs' *fetches* would put five screens' worth of requests on the
critical path and make cold start worse — the opposite of the goal.

The static-import decision for home is untouched.

## Verified against a control, not just observed

Counting network requests for tab modules on load, **without any tab being touched**:

| | tab modules fetched | total chunk requests |
|---|---|---|
| before | **0** | 55 |
| after | **4** | 77 |

All four — `health-content`, `workout-select-content`, `nutrition-content`, `more-content` — arrive
before the user touches anything, and demonstrably were not arriving before. The control run is what
makes that a measurement rather than an assumption.

## The honest caveat: this adds 22 chunk requests to load

They are deferred to idle and service-worker-cached on repeat visits, so the intent is that they cost
nothing the user feels. **But that is an argument, not a measurement.** Whether the trade is a net
win on the actual device is precisely what Q-51 **Task 3** exists to answer — a Performance profile
of home cold start on the S25, before and after. The sandbox cannot profile a WebView.

If Task 3 shows cold start got worse, the cheap adjustments are staggering the four imports across
separate idle callbacks, or dropping to the two tabs the owner actually uses most, rather than
reverting. The revert itself is deleting one effect.

## Not verified

Cold-start timing on device (Task 3, device-only). Nothing native, offline-first or safe-area
related is touched — this is one effect in a client component, and the four modules it imports were
already being imported, just later.
