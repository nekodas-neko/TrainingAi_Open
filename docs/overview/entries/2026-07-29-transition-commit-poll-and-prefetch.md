## 2026-07-29 — The screen transition's early-resolve was dead code; every push paid the full cap

Owner feedback after #918 shipped: *"its not very smooth at all - there is a small delay it doesnt
seamlessly lift up as if a page was opened."*

Not a tuning problem. Three separate defects, one of them a real bug that had been present since the
transition was introduced.

### 1. The early-resolve path never ran — every navigation paid the timeout cap

`lib/view-transition.ts` held the outgoing screen frozen inside the `startViewTransition` callback
until the route committed, with a timeout as a backstop. The commit was detected by a `useEffect` on
`[pathname, searchParams]` that called a resolver stored in `pendingRef`.

**That effect can never fire.** `pendingRef` lives on the component that called `push()`, and that
component unmounts as the route changes — so the effect never re-runs and the ref goes with it. The
resolver was only ever invoked by the `setTimeout`.

Instrumented, tagging each resolve with the path that produced it. Every single one was `timeout`:

| Run | Route committed | Transition resolved | By |
|---|---|---|---|
| 1 | 224 ms | 189 ms | `timeout` |
| 2 | **67 ms** | 200 ms | `timeout` |
| 3 | **51 ms** | 184 ms | `timeout` |

Run 3 is the shape of the complaint: the destination was ready at 51 ms and the screen stayed frozen
until 184 ms. ~130 ms of dead frame *after* there was something to show.

This also means the two previous attempts to fix the felt delay — 1000 ms → 150 ms in
`2026-07-29-transition-freeze-and-local-store-n1.md` — were both tuning the wrong number. The cap was
never a backstop; it was the only path. The comment claiming "a fast route settles first" described
behaviour that never happened.

Commit is now detected from `location.href` on a timer poll, which has no React lifecycle coupling
and so survives the unmount that broke the effect. Deliberately a timer and **not**
`requestAnimationFrame`: the browser suppresses frame production while a view-transition callback is
pending, so a rAF loop would never tick and would deadlock into the cap. The cap is raised to 300 ms
because it is now genuinely a "this navigation never landed" backstop rather than the normal path.

Push/replace to the URL you are already on now skips the transition — the URL would never change, so
the poll would have nothing to detect and the screen would eat the full cap on a no-op.

### 2. The four home health cards had no prefetch

`<Link>` prefetches on viewport entry; a `<button onClick={() => router.push(href)}>` gets nothing.
All 21 `useTransitionRouter` call sites are buttons, so the RSC payload fetch started at tap time and
the transition sat frozen waiting for it. The four score circles are on screen from first paint and
are the reported flow, so they now `router.prefetch` on mount, as do the sibling surfaces pushing the
same four detail routes (`sleep-card`, `rhr-hrv-spo2-card`, `oura-section`).

### 3. The cross-fade was simultaneous, so two dense screens superimposed

Found while verifying, not reported. Both keyframes faded across the full 200 ms, which puts the
outgoing and incoming screens at ~50% each for most of the animation — text over text. Visible in a
slowed capture of the push: the Sleep detail page drawn over a still-legible Health screen.

M3's shared axis **sequences** the fade for exactly this reason. Stops added so the outgoing clears by
40% and the incoming starts at 25% — a ~15% overlap, enough that the screen is never empty mid-
transition, short enough that the two never read as superimposed.

### Measured

Chromium at 412×915, CDP-throttled to 150 ms RTT / 4 Mbps to stand in for a mobile link to Railway.
Warm navigations, three runs each, same script against both trees:

| | time to motion | route committed |
|---|---|---|
| before (`main`) | 190 / 213 / 211 ms | 217 / 61 / 60 ms |
| after | 118 / 129 / 118 ms | 49 / 100 / 49 ms |

The point is not only that it halved — it is that "time to motion" now tracks the route commit
instead of sitting on a fixed floor regardless of it.

`pnpm tsc --noEmit` clean, `pnpm lint` 0 errors (119 pre-existing warnings), `pnpm build` exit 0,
2785 tests pass.

### Not verified on device

Chromium is not Samsung's WebView, and the compositor difference is the whole reason this uses the
View Transitions API rather than Framer Motion. The 150 ms RTT throttle is a stand-in for the real
link to Railway, not a measurement of it. The 25%/40% fade split is a judgement call made against a
slowed desktop capture; it and the 200 ms / 30 px figures are all one-line changes in `globals.css`.
Known-Issues row added to `projectOverview.md`.
