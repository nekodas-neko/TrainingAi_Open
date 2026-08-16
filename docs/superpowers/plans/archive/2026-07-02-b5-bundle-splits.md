# B5 — Bundle splits (plan 3 of 3)

> Source: `docs/planned_upgrades.md` § B5 "Remaining bundle splits (post-#91)" (audit 2026-07-02). One PR; tasks 1–8 are mechanical, task 9 is the only one needing design care. Re-grep anchors before editing.
>
> Goal: no route's initial chunk carries chart.js, the markdown/KaTeX stack, or dnd-kit unless its first paint renders them. Copy the pattern PR #91 established (`const X = dynamic(() => import(...).then(m => m.X), { ssr: false })`).

## Task 1 — `DoneScreen` out of the `/workout` initial chunk

`components/workout-screen.tsx:11` statically imports `DoneScreen`, which statically imports `HrRecoveryChart` (chart.js) at `done-screen.tsx:8`. DoneScreen renders only in `"done"` mode. Dynamic-import `DoneScreen` in `workout-screen.tsx` (`ssr:false`, no loading component needed — the mode flip can render `null` for one frame). Leave `HrRecoveryChart` static *inside* done-screen; splitting the parent is enough.

## Task 2 — `/chat` stops eager-loading chart.js + markdown/KaTeX

`components/chat.tsx:58-59` statically imports `ChartMessage` and `Response`. Dynamic both, exactly as `ai-chat-overlay.tsx:10-11` already does. Keep `parseChartBlocks` (line 58) as a static import if it's a plain function — split it out of the `chart-message` module first if importing it drags chart.js in (check what `parseChartBlocks` pulls).

## Task 3 — Full-language Prism barrel → `prism-light`

`components/ai/code-block.tsx` imports `Prism` from `react-syntax-highlighter` (every language, hundreds of KB — lazy behind Response since #91, but still huge when loaded). Switch to `react-syntax-highlighter/dist/esm/prism-light` (or `/prism-async-light`) and register only plausible languages for a gym app's AI chat: ts/js, json, sql, bash, python. Unregistered languages fall back to plain text — acceptable.

## Task 4 — One dynamic wrapper for `TrendSparkline`

chart.js is static on all 4 health detail pages via `components/health/trend-sparkline.tsx` (`sleep-content.tsx`, `heart-rate/page.tsx`, `readiness-content.tsx`, `activity-content.tsx`). Create `components/health/trend-sparkline-lazy.tsx` exporting the dynamic wrapper once (with a fixed-height skeleton to avoid layout shift) and swap the 4 import sites. Don't hand each page its own `dynamic()` call — one wrapper, per the shared-primitive rule.

## Task 5 — `MealTypeManager` (dnd-kit) off nutrition's first paint

`app/nutrition/nutrition-content.tsx:11` statically imports `MealTypeManager` (`@dnd-kit/react` + sortable) — an occasional edit sheet. Dynamic-import it; the same file already does this for its chart (lines ~12-16).

## Task 6 — `motion`-bearing cards off first-paint chunks

`components/body-battery-card.tsx` (home) and `components/readiness-card.tsx` (overview) statically pull `motion`. Dynamic-import the two cards at their call sites with a fixed-height skeleton. Do **not** convert `PullToSync` — it must be live before first interaction. If this lands awkwardly (visible pop-in), the fallback is `LazyMotion`/`m` inside the cards instead; pick whichever reads cleaner on the dev server.

## Task 7 — TTL constants out of `components/sync-provider`

Screens import `TTL_*` constants from `components/sync-provider` (`session-select-content.tsx`, `chat.tsx`, grep for others) — a mini-barrel coupling every screen to the sync-engine module graph. Move the constants to `lib/sqlite/cache.ts` (or a new `lib/cache-ttl.ts`), re-export from sync-provider temporarily if needed, and update all import sites in the same commit. Verify with a grep that no screen imports anything from `components/sync-provider` afterwards.

## Task 8 — Delete dead `components/chat-overlay.tsx`

Zero importers (verified 2026-07-02); statically imports chart.js — a re-import trap. Re-verify with grep, then delete.

## Task 9 — `cachedFetch` freshness short-circuit + drop the home prefetch wave

The only non-mechanical task; keep it minimal and behind explicit opt-in:

1. `lib/sqlite/cache.ts` `cachedFetch` always fires the network even when the cached value is within TTL. Add an opt-in option (`{ freshWithinTtl: true }` or similar): if the cached entry is younger than its TTL, return it and **skip the fetch**. Default behaviour unchanged — do not flip existing call sites wholesale; stale-while-revalidate is correct for most screens. Apply the option only to the endpoints where a TTL-fresh skip is safe and the payload changes rarely: `workout-card:*`, `progression-styles`, `activity-types`, the exercise library. Anything invalidated by a write group is safe by construction (the group delete makes the next read miss).
2. Home fires a per-session `workout-card:<id>` prefetch wave on every visit (`session-select-content.tsx`, `fetchWorkoutData` second stage) even though the workout screen fetches the same data on entry. Drop the wave (or fire it only on a cache miss once `freshWithinTtl` covers it).
3. Add one unit test for the short-circuit (fresh hit → no fetch call; stale → fetch fires; invalidated → fetch fires).

**Risk note:** this task touches the shared cache layer — a mistake here is a stale-data bug of the exact class the Cache Invalidation rules exist for. The invariant to preserve: a write-group invalidation must always force the next read to fetch. If the implementation can't guarantee that cleanly, ship tasks 1–8 without it and return it to the backlog.

## Wrap-up

- `pnpm build` before/after and record the route-level first-load JS deltas in the PR description (`/`, `/workout`, `/chat`, `/nutrition`, `/health/*`) — this PR's whole point is measurable chunk shrinkage.
- `pnpm tsc --noEmit && pnpm lint && pnpm test`; on `pnpm dev` visit every touched route and open every dynamized surface (done screen, chat message with code block + chart, meal-type manager, health detail sparklines, body-battery/readiness cards) — a wrong dynamic export shape fails only at render.
- Not exercisable in sandbox (declare in PR): real WebView load timing; `sw.js` cache interaction on device (deploy lands via Railway, next app launch).
- Version: patch bump + `lib/changelog.ts` entry.
- On ship: tick the B5 bundle bullets in `docs/planned_upgrades.md`.
