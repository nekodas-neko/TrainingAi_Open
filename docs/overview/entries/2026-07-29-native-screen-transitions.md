## 2026-07-29 — Native-feeling screen transitions (View Transitions API)

Owner, after the #885/#881 speed work landed: *"changing between pages doesn't feel as smooth as a
Swift app — is there some sort of page transition it uses?"* There was none. Route changes replaced
the screen instantly with no motion at all.

### What was there before

- **Tab switches**: `TabShell` toggles `invisible` on and off — a hard cut. **This is native-correct**
  and is left alone; an iOS tab bar switches instantly too.
- **Non-tab routes** (`/workout`, `/health/sleep`, `/activity`, …): `router.push` with no transition.
  A native push slides in from the right. This is what read as unpolished.
- `startViewTransition` appeared nowhere in the codebase. A `TabPanels` crossfade primitive exists
  (`components/ui/tab-panels.tsx`) but is used at exactly one site.

### Change

- **`lib/view-transition.ts`** (new) — `useTransitionRouter()`, a drop-in for `useRouter()` whose
  `push`/`replace`/`back` run inside `document.startViewTransition`. Applied at 13 call sites that
  navigate to full-screen routes.
- **`app/globals.css`** — `::view-transition-old/new(root)` keyframes: forward slides the new screen
  in from the right while the old drifts left (the parallax that makes a native push read as
  "deeper"); back mirrors it. 180 ms, deliberately shorter than a stock iOS push (~350 ms) because a
  longer animation gives the eye more time to catch a half-painted frame in a WebView.

**Why this API over Framer Motion**, which is already installed and would have been the obvious
reach: a view transition is interpolated by the **compositor** from before/after snapshots, so no JS
runs per frame. `CLAUDE.md` documents Samsung's WebView compositor as the thing that janks on
JS-driven animation, so the cheapest-per-frame option is the right one for the only supported target.

### Two decisions worth keeping

**Tab switches stay instant, by policy, in one place.** `useTransitionRouter` calls
`tabKeyForHref()` (`components/shell/tabs.ts`) and skips the transition for any of the five bottom-nav
destinations. That helper already knows `/workout?session=…` is a real screen rather than the Workout
tab, so the rule lives in one place instead of being re-decided at 39 `router.push` sites.

**The transition callback resolves on route change, not on `push()` returning.** This was a real bug
caught before shipping: `router.push` only *starts* a navigation, and `startViewTransition` takes its
"after" snapshot the moment the callback settles — so `startViewTransition(() => router.push(href))`
snapshots the **old** page as the new one, yielding no transition or a flash of the wrong screen. The
callback now returns a promise resolved by an effect watching `pathname`/`searchParams`, with a
1000 ms timeout so a navigation that never lands can't hold the frozen snapshot open.

### Tests

`pnpm tsc --noEmit` clean, `pnpm lint` 0 errors, and a **full `pnpm build`** — run specifically
because `useSearchParams` in a client component can force a CSR bailout at build time. It does not
here.

Browser-verified in Chromium against `pnpm dev`: **tab switches start 0 view transitions** (the
policy that matters most), and no JS exceptions or page errors come from the transition path — the
only console output is pre-existing 401/400 network noise while auth settles.

### Not verified

- **How it looks on the Samsung WebView.** Whether the slide is smooth, and whether the WebView's
  compositor handles `::view-transition-*` well, is a device check.
- **The visible result of the async-snapshot fix.** It typechecks and is correct by construction, but
  "the new screen is what actually gets snapshotted" is judged by eye, on device.

**Failure mode if it is wrong, stated deliberately after #881:** unlike the service-worker change,
this cannot wedge the app. There is no caching and no build-id coupling; `canViewTransition()` falls
through to a plain `router.push` when the API is missing or the user prefers reduced motion, and the
timeout bounds the worst case. The downside is an animation that looks wrong, not an app that will
not start.
