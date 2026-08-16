# 2026-07-29 — Dead back button on the health detail screens

Branch: `fix/detail-hero-back-button` · v1.241.2

Follow-up to #919. Owner report: *"pressing back from one of the home circles takes you to home
sometimes or health — when you can only access it from home so it should always take you back there.
also the only the android back button works. the actual ui back button in the top does not work"*.

## What was actually wrong

### 1. The back button was covered by an invisible sibling

`DetailHero` (`components/health/detail-hero.tsx`) renders the back-button row as
`absolute top-0 … z-10`, and immediately after it the children well as
`relative … z-10` with `minHeight: 260` — the full height of the hero. Two positioned elements at
the **same** z-index paint in DOM order, so the transparent children well painted over the button
and took every tap. The button was visible, correctly placed, correctly sized (44 px), and
completely dead.

Measured with `elementFromPoint` at the button's centre on `/health/sleep`:

```
hitsButton: false
topMost:    DIV.relative flex flex-col items-center justify-end pb-8 pt-16 z-10  [z=10 pos=relative]
```

After raising the header row to `z-20`, the same probe returns `hitsButton: true` with the chevron
`<svg>` topmost. This is why only the Android hardware back worked: that path is a raw
`window.history.back()` in `components/mobile-auth-handler.tsx:33`, which never touches the DOM.

Pre-existing — not introduced by #918 or #919; `git log` shows the hero layout unchanged since
v1.216.1.

### 2. `history.length > 1` is not "the app owns the previous entry"

`useBackOrFallback` gated on `window.history.length > 1`. That counts entries the app does not own
(the WebView's initial entry, the sign-in redirect). Cold-starting straight onto `/health/sleep`
reads `history.length === 2`, passes the test, and `back()` **leaves the app** — measured, landing on
`about:blank`.

Replaced with a session-scoped baseline: record `history.length` once per tab session in
`sessionStorage`, and treat only depth beyond it as app-owned. Cold start now correctly takes the
fallback branch.

### 3. The fallback went to the wrong screen

The fallback was hardcoded `/health`. Grepping every entry point to the four routes:

| route | reachable from |
|---|---|
| `/health/readiness` | Home circles **only** |
| `/health/activity`  | Home circles **only** |
| `/health/sleep`     | Home circles + Health screen (`health-sections.tsx:347`) |
| `/health/heart-rate`| Home circles + Health screen (`health-sections.tsx:565`) |

So the owner's premise ("you can only access it from home") holds for two of the four but not the
other two — which is exactly why `router.back()` is the right default: only history knows which
entry point was used. The fallback, which fires only when there is no in-app history, now goes to
Home rather than Health.

## Verified

Playwright, Chromium at 412×915, against `pnpm dev` and the local seed DB:

| case | result |
|---|---|
| Home → each of the four circles → UI back button | → `/` (all four) |
| Home → Sleep → hardware back | → `/` |
| Cold start on `/health/sleep` → UI back | → `/` (was `about:blank`) |

`pnpm tsc --noEmit` clean · `pnpm lint` 0 errors (119 pre-existing warnings) · 2785 tests pass ·
`pnpm build` exit 0.

## Not verified

- **Entry from the Health screen.** Could not drive the Health sleep-card from Playwright (selector
  never resolved), so "Health → Sleep → back → Health" is unexercised. That branch is untouched
  `router.back()` — pure history — so it is safe by construction, but it was not observed.
- **Device.** Chromium is not Samsung's WebView. The tap interception is a hit-testing fact that
  should hold identically, but the gesture behaviour below is not reproducible here at all.

## Left open deliberately

`activeTabIndex()` maps every `/health/*` path to the Health tab, so `TabSwipeNavigator` treats an
edge swipe on these detail screens as a tab flip — and on Samsung gesture nav the back gesture *is*
an edge swipe. This is the leading remaining candidate for the "sometimes home, sometimes health"
half of the report, and the fixes here may not have resolved it. Logged as a Known Issue in
`projectOverview.md` rather than patched: it is a shell-layer design question, not the tap-target
bug that was reported.
