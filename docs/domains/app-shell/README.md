# App shell — domain index

**Owns:** the home layout and its widgets, the persistent tab shell and navigation, screen
transitions, UI primitives and theming, safe-area handling, backgrounds, and **perceived**
performance — first paint, cache-seeded instant paint, render discipline.

**Does not own:** server-side or data-layer performance ([`platform`](../platform/README.md)). The
split is "does it feel slow" vs "is it actually slow at the source".

## Code

| Area | Where |
|---|---|
| Shell & nav | `components/shell/`, `app/(home)/`, `app/more/`, `components/more/` |
| Home widgets | `components/home/`, `lib/home/` |
| Primitives | `components/ui/` — **grep here before writing any tab strip, dialog, empty state, collapsible or sparkline** |
| Theme & background | `components/dynamic-background/`, `app/globals.css`, `lib/ui/` |
| Health surfaces | `components/health/`, `app/health/`, `app/overview/` |

## Reference docs

- [`docs/app-responsiveness-investigation.md`](../../app-responsiveness-investigation.md) —
  **start here.** Why the app doesn't feel native; the investigation brief behind the current
  performance push.
- [`docs/overview/app-responsiveness-ai-optimization-closeout.md`](../../overview/app-responsiveness-ai-optimization-closeout.md)
- Reviews: [`docs/reviews/2026-07-21-ui-responsiveness-audit.md`](../../reviews/2026-07-21-ui-responsiveness-audit.md) ·
  [`docs/reviews/2026-07-11-offline-feel-performance-review.md`](../../reviews/2026-07-11-offline-feel-performance-review.md) ·
  [`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`](../../reviews/2026-07-20-wiring-caching-perf-audit.md)
- [`docs/handoff-phase-3-bundled-shell.md`](../../handoff-phase-3-bundled-shell.md) — the live
  Phase 3 baton (bundling the shell into the APK). Task 4 is now **decided** (option B).
- **[`docs/offline-first-target-architecture.md`](../../offline-first-target-architecture.md)** —
  the destination (owner, 2026-07-30): the app works fully offline except AI calls and older data;
  Railway keeps the DB for calculated data. Reframes Phase 3 as step one of a migration rather than
  a latency optimisation. Read before planning any shell work.
- [`docs/superpowers/plans/2026-07-30-phase-3-workspace-split.md`](../../superpowers/plans/2026-07-30-phase-3-workspace-split.md)
  — the Task 4 (option B) workspace-restructuring plan: workspace + shared `lib/` package → app
  split (`shell/` + `api/`) → the export flip.
- [`docs/handoff-2026-07-30-app-shell-perf-audit-auth-fixes-and-offline-direction.md`](../../handoff-2026-07-30-app-shell-perf-audit-auth-fixes-and-offline-direction.md)
  — navigation perf audit, two auth-boundary fixes, the Task 4 = option B decision (superseded on
  content by the 2026-07-30 consolidation handoff, kept for the gotchas it recorded).
- The **`mobile-app-design-standards`** and **`mobile-app-ui-design`** skills.

- **[`docs/superpowers/plans/2026-08-14-more-tab-information-architecture.md`](../../superpowers/plans/2026-08-14-more-tab-information-architecture.md)**
  — the target container structure for More / Devices / Settings / Data / About / Program / Admin,
  umbrella for Q-232…Q-237, carrying the Q-239 per-screen decisions and the build order. **Read
  before touching `app/more/**`, `components/more/**`, `app/admin/**` or `components/config-screen.tsx`.**
  **Fully implemented 2026-08-15** — `/more/{devices,settings,data,about}`, `/program`, and
  Settings → Developer. `components/more/sub-screen.tsx` is the navless takeover shell every More
  sub-route uses, and `components/more/more-row.tsx` is the grouped-list row. `profile-tab.tsx` went
  845 → 465 lines and is off the `check-component-size.js` baseline.
- Reviews: [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](../../reviews/2026-08-14-app-ui-flow-ia-review.md) — **UI / flow / information-architecture + caching review, 2026-08-14** (owner-requested; the full navigation map with a reachability count for all 39 page routes, the proposed target structure for More/Settings/Devices/Program/Admin, and 13 findings queued as Q-232…Q-244). Its prompt is [`2026-08-14-app-ui-flow-ia-review-prompt.md`](../../reviews/2026-08-14-app-ui-flow-ia-review-prompt.md). **§7 is the separate testing-capability measurement** — the 81 "NOT verified on device" rows split into five gates, only 25 of which need the device, queued as Q-249…Q-254.
- Handoff: [`docs/handoff-2026-08-14-app-shell-ui-flow-ia-review-and-testing-capability.md`](../../handoff-2026-08-14-app-shell-ui-flow-ia-review-and-testing-capability.md) — **2026-08-14**, both halves of that session: the IA/caching review and the agent-testing cluster, with the decisions (why Q-232 is an umbrella, why Q-249 sits above it, why the whole cluster precedes Q-49) and the traps.
- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

## Open issues

```bash
grep -n '^### .*\[app-shell\]' projectOverview.md   # 18 entries today
grep -n '\[app-shell\]' docs/implementation-backlog.md   # 2 queue items today
```

Live at the time of writing (2026-07-30):

- ⚠️ **Q-154 — three inline sparklines remain, and the primitive cannot draw them yet.** Half the
  original list turned out to be *time-axis* charts (the primitive projects x by index) and is now
  `EXEMPT` in `scripts/check-sparkline-primitive.js`; the rest need five new props on
  `components/ui/sparkline.tsx` first, one of which changes chart amplitude. Note there is a
  **second** primitive, `components/ui/sparkline-chart.tsx` (chart.js), which is not
  interchangeable. See
  [`the journal entry`](../../overview/entries/2026-08-09-sparkline-classification.md).

- ✅ **The `tap-dense` audit is complete** (Q-176, 2026-08-10, v1.277.2). Ten users, five different
  correct remedies — bare (inline text), self-restoring (`Switch`), a 24×44 dot box, a 44×44 box, or
  grown ink. What decides each is the clearance to the nearest interactive neighbour. See
  [`the journal entry`](../../overview/entries/2026-08-10-remaining-tap-dense-hit-areas.md).
- ✅ **Carousel dots were 7×7 px tap targets** (Q-160, fixed 2026-08-09, v1.276.4). Three
  byte-identical dot rows are now `components/ui/carousel-dots.tsx`, which owns the touch area and
  the spacing that keeps neighbouring hit areas from overlapping. Two remaining `tap-dense`
  controls with no touch area are queued as **Q-176**. See
  [`the journal entry`](../../overview/entries/2026-08-09-carousel-dot-hit-area.md).

- ⚠️ **A `useEffect(…, [])` fetch inside a tab runs once per app launch** — all five tabs stay
  permanently mounted, so mount effects never re-run. More was missed by the original plan and
  never refreshed at all until v1.257.0; use `useRefreshOnTabShow()` or thread `epoch` in any new
  tab-resident card. See
  [`docs/overview/entries/2026-08-05-more-tab-refresh-and-strap-retry.md`](../../overview/entries/2026-08-05-more-tab-refresh-and-strap-retry.md).
- **Edge-swipe tab navigation stays live on the four health detail screens** — open.
- **Screen transition timing + prefetch** (v1.241.1) — not device-verified.
- **Q-1, the native-feel performance push, is the live owner-directed initiative** — the network
  side is exhausted; remaining wins come from device Performance profiles, which only the owner can
  capture. Phase 3 (bundled shell) is the stated architecture and is owner-gated.
- **Home-day-timeline reads server-only** — a documented, sanctioned exception to offline-first.
- **Today's Timeline: meal and sleep cards are tappable, workout is not.** Meal jumps to
  `/nutrition?date=`; "Woke up"/"Fell asleep" jump to `/health?tab=body&openSleepDate=`, which
  pre-selects that night in `HealthMetricSheet`'s sleep sheet (not `/health/sleep`, which has no
  date-selection UI). Workout stays non-interactive — no historical HR-chart/exercise-detail screen
  exists yet — tracked as the remainder of backlog item Q-93-followup. See
  [`docs/overview/entries/2026-08-06-timeline-meal-tap-navigation.md`](../../overview/entries/2026-08-06-timeline-meal-tap-navigation.md)
  and [`docs/overview/entries/2026-08-07-sleep-timeline-detail-deeplink.md`](../../overview/entries/2026-08-07-sleep-timeline-detail-deeplink.md).

## History

- **[`docs/handoff-2026-08-15-app-shell-ia-cluster-complete.md`](../../handoff-2026-08-15-app-shell-ia-cluster-complete.md)**
  — 🆕 the 2026-08-14 UI/flow/IA cluster worked to completion: 11 PRs, v1.307.2→v1.314.0, closing
  Q-232/233/234/235/236/237/238/239/242/244 and Q-256. `profile-tab.tsx` 845 → 465 lines and off the
  size baseline; Custom Rules 33 → 35 steps. Records the decisions (why Q-238 was deleted rather than
  built, why five of Q-239's six screens are "leave", why `exercises`/`activities` stayed on
  `/admin`, why "Log Food" was not invented), the three follow-ups left open, and the gotchas —
  `pnpm build` corrupting a running dev server's `.next`, checks firing on comments, and an assertion
  that passed while the behaviour it guarded was broken.

- **[`docs/handoff-2026-08-08-app-shell-review-backlog-ui-batch.md`](../../handoff-2026-08-08-app-shell-review-backlog-ui-batch.md)**
  — 🆕 the Agent-2 half of that dispatch, worked to completion: 16 PRs (v1.270.x→v1.270.30) closing
  Q-119/120/121/123/125/126/127/132/133/135/136-pt1 and the Q-95/Q-97/Q-109 follow-ups, plus Q-148
  (client components could not read the user's timezone at all) and Q-111's ring half. Records four
  findings that contradicted the review, and the `color-mix(in oklch, …, <achromatic>)` hue bug that
  was silently miscolouring **26 shipped sites** — with `scripts/check-color-mix-hue.js` as its
  ratchet. Also the git/tooling traps that cost time: version collisions under a parallel agent,
  `reset --soft` leaving rebased copies of `main`, and `pkill -f "next dev"` killing its own shell.
- **[`docs/handoff-2026-08-07-cross-full-app-review-backlog-dispatch.md`](../../handoff-2026-08-07-cross-full-app-review-backlog-dispatch.md)**
  — 🆕 wrap-up for the 2026-08-07 full-app-review backlog drain (9 PRs merged this session,
  including Q-73's home hydration-mismatch fix and Q-118's navless safe-area sweep). Splits the
  remaining ~18 ready items into two parallel-agent pickup prompts by file territory; Agent 2 owns
  the app-shell/UI/cache-correctness half (`lib/cache-groups.ts`, `components/*`). Filed under
  `cross` because it also covers `platform`-territory items.
- Handoffs: `ls docs/handoff-*-app-shell-*.md`
- Journal: `grep -rl 'shell\|transition\|paint\|safe.area' docs/overview/entries/` — including
  [`entries/2026-08-07-home-hydration-mismatch.md`](../../overview/entries/2026-08-07-home-hydration-mismatch.md)
  (Q-73 — the home header's date string mismatched between server (UTC) and client (Australia/Brisbane)
  for 42% of every day; fixed with a fixed-timezone formatter instead of either side's ambient tz).
  Also [`entries/2026-08-07-navless-safe-area-sweep.md`](../../overview/entries/2026-08-07-navless-safe-area-sweep.md)
  (Q-118 — 6 navless takeover screens used the un-floored `pb-safe-action` instead of
  `pb-safe-action-lg`, the same on-device gesture-bar-overlap class already fixed once for workout
  screens; NOT device-verified).

## Gotchas specific to this domain

- **A bare `toLocaleDateString`/`toLocaleTimeString` call with no `timeZone` option is a hydration
  mismatch waiting to happen, not just a wrong-answer bug** — Railway sets no `TZ` env var, so the
  Node server renders in **UTC** while the S25 renders in the app's real timezone
  (**Australia/Brisbane**). Any such call in a render body (not gated behind a client-only effect)
  disagrees with itself for 42% of every day (00:00–10:00 AEST) and throws minified React error
  #418 — 283 occurrences on Home alone before this was root-caused (Q-73). The fix is not "use the
  user's real timezone" (still ambient-dependent, still mismatches) but **a timezone fixed
  identically on both sides** — `formatInTimeZone(new Date(), DEFAULT_TZ, '…')` — so server and
  client compute the same string by construction, not by coincidence. `pnpm dev` cannot catch this:
  the dev server and headless Chromium share one system timezone, so both sides always agree there.
  Grep `toLocaleDateString\|toLocaleTimeString` outside `components/oura-ble/` and
  `components/admin/` (the documented device-local exemption) before shipping any new render-body
  date/time string.
- **Safe-area insets: 10+ regressions.** There is **no native WindowInsets bridge** — bottom-anchored
  controls need the *floored* utilities (`pb-safe-action`, or `pb-safe-action-lg` for navless
  screens), never bare `pb-safe`/`env()`. The web sandbox renders insets as 0, so these bugs are
  invisible until on-device.
- **A skeleton flash on a repeat visit is a bug** — seed synchronously from cache in a `useEffect`
  (never a `useState` initializer, which caused hydration mismatches).
- **`React.memo` needs stable props** — both long-standing memos in the codebase were silently
  defeated by inline arrows/object literals at the call site.
- **Timers tick in leaves, not orchestrators** — a 1 Hz tick in a screen orchestrator re-renders
  everything below it every second.
- **Canvas can't resolve `var(--x)`** — passing a CSS custom property to chart.js renders black.
- **Never nest `<button>`s**; Samsung's WebView strips the inner one. Cards containing controls use
  `<div role="button">`.
- **A base class in a shared component can be silently overridden by its call sites.**
  tailwind-merge lets the later class win, so a `pr-*` in `SheetHeader`'s outer `cn()` is erased by
  any of the eight sheets that pass `px-*` — a fix written that way measurably changed nothing.
  Defaults a call site must not be able to break belong on an **inner** element it cannot reach;
  `components/ui/sheet.tsx` does this for the close button's 64px corner and says why. Related:
  `SheetContent side="bottom"` bakes the bottom inset and `p-0` does not strip it.
