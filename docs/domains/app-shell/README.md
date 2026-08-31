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
| Theme & background | `components/dynamic-background/`, `app/globals.css`, `packages/shared/src/ui/` |
| Health surfaces | `components/health/`, `app/health/` — there is no `app/overview/` route (the row named one until 2026-08-18) |

## Reference docs

- [`docs/superpowers/plans/2026-08-25-unified-day-review.md`](../../superpowers/plans/2026-08-25-unified-day-review.md)
  — **Q-112, the unified day review.** Relevant here for the entry points: Home's day-review banner,
  the two local reminders in `lib/day-review-reminders.ts` (which deep-link to `/`, not to the
  review), and the argument for `/health/day` being the read-through rather than a third day surface.
- [`docs/app-responsiveness-investigation.md`](../../app-responsiveness-investigation.md) —
  **start here.** Why the app doesn't feel native; the investigation brief behind the current
  performance push.
- [`docs/overview/app-responsiveness-ai-optimization-closeout.md`](../../overview/app-responsiveness-ai-optimization-closeout.md)
- Reviews: [`docs/reviews/2026-07-21-ui-responsiveness-audit.md`](../../reviews/2026-07-21-ui-responsiveness-audit.md) ·
  [`docs/reviews/2026-07-11-offline-feel-performance-review.md`](../../reviews/2026-07-11-offline-feel-performance-review.md) ·
  [`docs/reviews/2026-07-20-wiring-caching-perf-audit.md`](../../reviews/2026-07-20-wiring-caching-perf-audit.md)
- [`docs/handoff-phase-3-bundled-shell.md`](../../handoff-phase-3-bundled-shell.md) — the live
  Phase 3 baton (bundling the shell into the APK). Task 4 is now **decided** (option B).
- [`docs/overview/entries/2026-08-19-cache-invalidation-signal.md`](../../overview/entries/2026-08-19-cache-invalidation-signal.md)
  — **Q-402: the shell has no unmount, so a fetch-once effect in it never fetches again.** All six
  write groups evicted `energy-balance:` correctly and the owner still had to restart the app,
  because invalidating a key and re-rendering the component reading it are two different things and
  the repo had no mechanism for the second. `subscribeToInvalidation` + `useCachedValue` are that
  mechanism. **Read before adding any self-fetching card to Home** — the shape that is fine on a
  screen you navigate away from is a bug here. 36 sibling sites are latent, filed as Q-359.
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
  845 → 465 lines and is off the `check-component-size.js` baseline. **Its 2026-08-16 owner decision
  is still binding and is the one people re-open by accident:** `GoalsSection`, `StatsGrid`,
  `TrophyCase`, `AchievementsSection`, "Your Year" and the season badges **stay inline on More**, and
  `/more/goals` and `/more/achievements` were never built and are not going to be.
- [`docs/overview/entries/2026-08-31-nutrition-sheet-surface.md`](../../overview/entries/2026-08-31-nutrition-sheet-surface.md)
  — **BF-75: `SheetContent` gained an opt-in `surface="page"`.** The app-wide sheet primitive changed,
  so this is app-shell's as much as nutrition's. Two things bind any future work on it: the layer is
  `-z-10` because `SheetContent` is `fixed z-50` and therefore a stacking context — without it the
  gradient paints over every row of the sheet — and **a hit test cannot detect that**, because the
  layer is `pointer-events-none` and `elementFromPoint` skips it whatever its paint order. Assert the
  computed z-index. Five nutrition sheets opt in; a test holds that nothing else does.
- **[`docs/superpowers/plans/2026-08-31-more-page-grouping-and-interaction-model.md`](../../superpowers/plans/2026-08-31-more-page-grouping-and-interaction-model.md)**
  — **BF-82: what that migration left behind.** The rows are right; the container around them is
  degenerate — **eight `MoreRowGroup`s wrap exactly one row each**, and the only two that group
  anything are on the Developer sub-screen. Proposes seven headings → two, each covering three or
  more rows, and one interaction model. Carries three corrections to the entry's premises: the
  navigate-vs-expand affordance already exists (`ChevronRight` vs a rotating `ChevronDown`); the real
  defect is that `goals-section.tsx` **re-implements** `MoreRowGroup` rather than using it; and there
  are no sliders on the screen — five `Switch`es, all booleans, all correct — so the control question
  is the owner's and the plan decides none of it. **The build is parked behind BF-79 → BF-78 (Lane
  A)**; §3–§4 are separable if the screen needs fixing sooner.
- Reviews: [`docs/reviews/2026-08-14-app-ui-flow-ia-review.md`](../../reviews/2026-08-14-app-ui-flow-ia-review.md) — **UI / flow / information-architecture + caching review, 2026-08-14** (owner-requested; the full navigation map with a reachability count for all 39 page routes, the proposed target structure for More/Settings/Devices/Program/Admin, and 13 findings queued as Q-232…Q-244). Its prompt is [`2026-08-14-app-ui-flow-ia-review-prompt.md`](../../reviews/2026-08-14-app-ui-flow-ia-review-prompt.md). **§7 is the separate testing-capability measurement** — the 81 "NOT verified on device" rows split into five gates, only 25 of which need the device, queued as Q-249…Q-254.
- Handoff: [`docs/handoff-2026-08-14-app-shell-ui-flow-ia-review-and-testing-capability.md`](../../handoff-2026-08-14-app-shell-ui-flow-ia-review-and-testing-capability.md) — **2026-08-14**, both halves of that session: the IA/caching review and the agent-testing cluster, with the decisions (why Q-232 is an umbrella, why Q-249 sits above it, why the whole cluster precedes Q-49) and the traps.
- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

- [`docs/reviews/2026-08-18-offline-read-surfaces.md`](../../reviews/2026-08-18-offline-read-surfaces.md) — **offline read surfaces, driven for real, 2026-08-18** (**both paths work** once the SW controls the page: a reload serves the precached offline document, and an offline tab tap paints **2515 chars vs 2486 online, ~101%**. Q-555 — in the **uncontrolled** state, which is the first-ever load, the same tap is a **silent no-op**: no navigation, no offline page, no feedback). **Web only** — `cachedFetch` falls back to `localStorage` there, so the seed path was verified, not the native SQLite store.
- [`docs/reviews/2026-08-18-card-429-reproduction.md`](../../reviews/2026-08-18-card-429-reproduction.md) — **Q-499 reproduced in a browser, 2026-08-18** (`/api/weights-summary` forced to 429 by route interception at the S25 viewport: **`Estimated 1RM` went 1 node → 0, no error wording anywhere**; **control holds** — blocking a different endpoint left it at 1). **The vanish is invisible on a warm cache and visible on a cold one**, so it reads as intermittent. Also **Q-552** — the Q-number block ledger omitted 544–551, so the README's own *"next block of 50 above 529"* instruction would have collided with fourteen live numbers; claimed 552–601 and added the missing grep-before-claiming step.
- [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](../../reviews/2026-08-17-failure-cells-running-the-app.md) — **the failure-cells lens, run against a live app, 2026-08-17** (Q-451 dead first-run CTA, Q-452 AI insight generated over "no data"). Findings Q-450…Q-455; four areas recorded **clean**.

- [`docs/reviews/2026-08-17-repo-migration-architecture.md`](../../reviews/2026-08-17-repo-migration-architecture.md) — **the repo migration reviewed as an architecture change, 2026-08-17** (Q-457 — `lib/github-release.ts` defaults to the archived private repo, so the update card and More → Download APK break silently if the env var is ever unset). Findings Q-456…Q-459; **no credentials leaked and the public-repo CI posture is correct**, plus five more clean results.

- [`docs/reviews/2026-08-18-silent-card-failures.md`](../../reviews/2026-08-18-silent-card-failures.md) — **three lenses: leaked error text, AI rate-limit coverage, and cards that vanish, 2026-08-18** (Q-499 — 78 components call `cachedFetch`, **18** reference its `onError` hook; two verified by hand conflate "fetch failed" with "no data" and simply disappear, including on a **429 from the app's own limiter**. **Corrects `CLAUDE.md`'s premise**: `cachedFetch` does *not* unconditionally swallow `!res.ok` — `cachedFetchCore` takes `onError` and swallows only when the caller declines it.) **Two lenses came up clean:** every route returning `err.message` is admin- or session-gated (and `admin/db-query` doing so is correct by design), and every route that actually calls an LLM has a rate limit — the 7 that looked unlimited make **zero** LLM calls.
- [`docs/reviews/2026-08-18-workout-write-path.md`](../../reviews/2026-08-18-workout-write-path.md) — **the workout write path, driven live and probed cross-user, 2026-08-18** (Q-461 — the infinite `animate-bounce` on Start Set blocks Playwright's stability check, so no E2E spec can drive a workout past set 1). Findings Q-460…Q-462; **cross-user write protection holds across the whole workout surface** (verified against a second live account, with a control for every probe), plus three more clean results.

- [`docs/overview/entries/2026-08-18-training-load-day-flag-inline.md`](../../overview/entries/2026-08-18-training-load-day-flag-inline.md)
  — **Q-390, the Training Load bars were not on a common baseline (v1.321.2).** A deload/testing flag
  rendered as a *sibling* of the day label became an extra row, and in an `items-end` row that pushes
  the bar up: two days of identical volume drew **12 px** apart, measured. Carries the correction that
  `D` and `T` are mutually exclusive at the data level, and a geometry-asserting E2E guard.
- [`docs/reviews/2026-08-17-score-presentation-audit.md`](../../reviews/2026-08-17-score-presentation-audit.md) — **every surface rendering a pillar score, audited (Q-281), 2026-08-17.** Fourteen surfaces scored for contributors / trend / action: **nine render a score with no contributors and no trend**, and exactly one has all three. One real colour-only-state violation found and fixed (Home "accentring" band dot); `FactorBar` inspected and deliberately left alone. Also carries three corrections to **Q-278**'s premises — `score-audit/` has zero user-facing consumers, `scoreAvailability` has one, and daytime stress + resilience have no score surface at all.

- [`docs/reviews/2026-08-18-coach-apply-path.md`](../../reviews/2026-08-18-coach-apply-path.md) — **the AI Coach's write path, reviewed for the first time, 2026-08-18** (Q-467 — the Coach's undo subsystem is fully built, `coach-history.tsx` already styles undone changes, and **nothing calls the undo route**). Findings Q-467/Q-468; the **apply** path came back clean and is documented at length as the reference for LLM-initiated writes.

- [`docs/reviews/2026-08-18-aria-expanded-collapsibles.md`](../../reviews/2026-08-18-aria-expanded-collapsibles.md) — **the `aria-expanded` list re-checked, 2026-08-18** (Q-491 — still nine, but **not the same nine**: one fixed, one never listed, two moved). Names the broader pattern: three hand-maintained counts in `CLAUDE.md` found stale this run, while every **ratcheted** count is current.
- [`docs/reviews/2026-08-18-render-hot-paths.md`](../../reviews/2026-08-18-render-hot-paths.md) — **the other four render rules, 2026-08-18**: index keys in editable lists, the orchestrator's timer, Zustand selector breadth, `readCacheSync` in a render body. **All held.** Records that every mechanical check over-reported — 85 index keys are all on static lists, the 62-field `useShallow` pick contains actions not hot-path values, and the cache-read grep flagged the comment that states the rule.
- [`docs/reviews/2026-08-18-memo-stability-audit.md`](../../reviews/2026-08-18-memo-stability-audit.md) — **are the memos actually memoising? 2026-08-18**. All 66 `memo(...)` declarations collected and every call site scanned: **64 hold**, no inline arrows anywhere. Q-490 — `MealMacroBars`/`DayMacroTotals` are called with an inline `target={{…}}` inside `variant.meals.map(...)`, so every keystroke in the meal-plan edit sheet re-renders every meal row. Also notes the rule's *"both long-standing memos"* count is stale (66, not 2).
- [`docs/reviews/2026-08-18-server-only-writes-to-local-first-domains.md`](../../reviews/2026-08-18-server-only-writes-to-local-first-domains.md) — **staleness outside Q-262's test, 2026-08-18** (Q-488 — the activity delete updates the server and the caches but never the local store, so three local-first screens keep showing it until the next pull; self-heals via the tombstone, so a visible inconsistency rather than data loss). Records the unwritten inverse of the offline-first rule.
- [`docs/reviews/2026-08-18-timezone-non-default-user.md`](../../reviews/2026-08-18-timezone-non-default-user.md) — **the app driven as a user who is not in Brisbane, for the first time, 2026-08-18** (Q-477 — the Profile "Auto-detect timezone" button is what breaks dates: the server honours the new zone, 100 of 125 client call sites do not, and the Health calendar marks the wrong day as today; Q-478 — `isWorkoutDataToday`/`isBodyMetadataFresh` compare a server-stamped date to a client `DEFAULT_TZ` date, so they are false for up to 14 hours a day and session-select's Home skeleton lingers for a network round trip instead of clearing on the cache hit — the review's "never clears" was corrected in place on 2026-08-18; a second unconditional clear runs after the await). **Every API route threads the user's timezone** — all findings are client-side. **Q-478 shipped 2026-08-18** (v1.324.8): both guards take a `tz`, all nine call sites pass one, and `scripts/check-tz-aware-cache-guards.js` keeps it that way — [`the journal entry`](../../overview/entries/2026-08-18-tz-aware-cache-guards.md). Q-477 is still open, including its ratchet on bare `todayInTz()` in client code.
- [`docs/overview/entries/2026-08-24-memo-call-site-stability.md`](../../overview/entries/2026-08-24-memo-call-site-stability.md) — **Q-357, the memo baseline emptied, 2026-08-24** (four defeated call sites cleared; the `SavedMealCard` one was inside a `.map()`, so its callbacks now take the meal and hand it back rather than being closed over per row). **Render saving not measured.**

- [`docs/reviews/2026-08-18-production-verification.md`](../../reviews/2026-08-18-production-verification.md) — **this run's own findings checked against production, 2026-08-18** (Q-472 — `coach_changes` is empty: the Coach's write capability has produced zero writes, which re-prices Q-467/Q-468 to zero production exposure). Filed Q-472; **amended Q-460, Q-465, Q-467, Q-468** — one refuted, two re-scoped to zero exposure, one shown unprovable either way.

## Open issues

```bash
grep -n '^### .*\[app-shell\]' projectOverview.md   # 18 entries today
grep -n '\[app-shell\]' docs/implementation-backlog.md   # 2 queue items today
```

Live at the time of writing (2026-07-30):

- ⚠️ **Three calorie budgets were live on one screen; there is now one** (Q-415/Q-417, fixed
  2026-08-23, v1.335.0). Home's nutrition card and the Nutrition ring both read
  `budgetProvenance(...).total` rather than composing `nutrition_targets.calories` — the **rest-day
  floor** — plus a separately-sourced burn. Follow-up **LB-4** (food logs invalidate before their
  push) and **not device-verified** —
  [`journal`](../../overview/entries/2026-08-23-one-calorie-budget.md).

- ✅ **`components/health/day-overlay-sheet.tsx` is gone** (LB-3, 2026-08-24). LB-1 took its
  edit/delete controls onto `/health/day` and left the file because it still owned three affordances
  that screen had not got. Two were ported — tap an exercise name for its history, tap an activity
  for its detail — and the per-session HR recovery chart was dropped, since `done-screen` still
  reaches it at the moment it means something. `health-content.tsx` lost 167 lines with it —
  [`journal`](../../overview/entries/2026-08-24-retire-day-overlay-sheet.md).

- ⚠️ **Q-154 — three inline sparklines remain, and the primitive cannot draw them yet.** Half the
  original list turned out to be *time-axis* charts (the primitive projects x by index) and is now
  `EXEMPT` in `scripts/check-sparkline-primitive.js`; the rest need five new props on
  `components/ui/sparkline.tsx` first, one of which changes chart amplitude. Note there is a
  **second** primitive, `components/ui/sparkline-chart.tsx` (chart.js), which is not
  interchangeable. See
  [`the journal entry`](../../overview/history-2026-08-08.md).

- ✅ **The `tap-dense` audit is complete** (Q-176, 2026-08-10, v1.277.2). Ten users, five different
  correct remedies — bare (inline text), self-restoring (`Switch`), a 24×44 dot box, a 44×44 box, or
  grown ink. What decides each is the clearance to the nearest interactive neighbour. See
  [`the journal entry`](../../overview/history-2026-08-08.md).
- ✅ **Carousel dots were 7×7 px tap targets** (Q-160, fixed 2026-08-09, v1.276.4). Three
  byte-identical dot rows are now `components/ui/carousel-dots.tsx`, which owns the touch area and
  the spacing that keeps neighbouring hit areas from overlapping. Two remaining `tap-dense`
  controls with no touch area are queued as **Q-176**. See
  [`the journal entry`](../../overview/history-2026-08-08.md).

- ⚠️ **A `useEffect(…, [])` fetch inside a tab runs once per app launch** — all five tabs stay
  permanently mounted, so mount effects never re-run. More was missed by the original plan and
  never refreshed at all until v1.257.0; use `useRefreshOnTabShow()` or thread `epoch` in any new
  tab-resident card. See
  [`docs/overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md).
- **Edge-swipe tab navigation stays live on the four health detail screens** — open.
- **Screen transition timing + prefetch** (v1.241.1) — not device-verified.
- **Q-1, the native-feel performance push, is the live owner-directed initiative** — the network
  side is exhausted; remaining wins come from device Performance profiles, which only the owner can
  capture. Phase 3 (bundled shell) is the stated architecture and is owner-gated.
- **Home-day-timeline reads server-only** — a documented, sanctioned exception to offline-first.

## Decided

- **Today's Timeline: five of seven card types navigate; `bedtime` and `tag` deliberately do not
  (Q-93-followup, closed 2026-08-25).** Meal jumps to `/nutrition?date=`; "Woke up"/"Fell asleep"
  jump to `/health?tab=body&openSleepDate=`, which pre-selects that night in `HealthMetricSheet`'s
  sleep sheet (not `/health/sleep`, which has no date-selection UI); workout and walk jump to
  `/health/day?date=`. A bedtime is a projection and a tag is a marker — neither has a detail view
  to reach, so both stay inert rather than being given a destination that would only repeat the
  card. The workout card was the last one wired: it waited on a screen to land on, which Q-110
  shipped on 2026-08-08, and then sat inert for another seventeen days because nothing tracked the
  dependency clearing. Guarded by
  [`e2e/timeline-card-navigation.spec.ts`](../../../e2e/timeline-card-navigation.spec.ts), which
  asserts the destination URL — a row wired to nothing renders identically to a wired one. See
  [`docs/overview/entries/2026-08-25-timeline-workout-day-detail.md`](../../overview/entries/2026-08-25-timeline-workout-day-detail.md).

- **The Coach KEEPS its write capability — but undo gets wired before anything drives adoption
  (owner, 2026-08-24 — Q-472, removed from the queue).** Production measured **0 applied Coach
  changes, ever**, across five domains, apply/preview/undo and ~1,230 lines under `lib/coach/domains/`.
  The question filed was *"keep and drive adoption, or narrow?"* — the answer is **keep**.
  - **The zero was the wrong number to decide on.** The Coach is used (17 calls in 30 days; **8 of 8**
    assistant messages carried a tool call), but only **1** of those 8 carried a `change_preview`.
    The model reaches for the write path roughly **once in eight replies**, and that one proposal was
    declined. "Nobody wants this" and "it is almost never offered" both produce a zero, and this data
    cannot separate them — so narrowing would have deleted a working capability on evidence that
    mostly measures under-triggering. **Apply is not broken**: a previous sweep applied a patch
    through the real route, and all four client call sites are wired.
  - **The ordering is the load-bearing half of the decision, not a caveat.** **Q-467** (the Coach can
    rewrite your programme with no in-app undo, while a complete undo subsystem sits there with no
    caller) is currently *theoretical* only because writes never happen. Driving the proposal rate up
    is precisely what makes it real. So Q-467 ships first — it is mostly wiring what already exists —
    and **PS-5** (why the model rarely proposes) is explicitly gated behind it.
  - **Scope caveat that governs every number above:** `claude_ro` is row-scoped to one user, so these
    are *the owner's* counts. Never restate them as "no user has ever applied a Coach change".
  - **Revisit if** PS-5 finds the rate is correct and proposals are genuinely being declined — that
    would be the evidence narrowing needed and never had.

## History

- **[`docs/overview/entries/2026-08-30-apk-banner-tap-target.md`](../../overview/entries/2026-08-30-apk-banner-tap-target.md)**
  — 🆕 **LB-26**: Home's APK-banner link was 258×33 against the 48 dp floor. **⚠ The rule to carry:
  do not raise an undersized `<a>` by adding `a` to `globals.css`'s `button, [role="button"]` floor**
  — the exclusion is deliberate, and a link that IS a control takes `min-h-[48px]` at its own call
  site. `e2e/touch-target-size.spec.ts`'s allowlist is empty now, so a new one fails the spec.
- **[`docs/overview/entries/2026-08-30-sparkline-primitive-props.md`](../../overview/entries/2026-08-30-sparkline-primitive-props.md)**
  — 🆕 **Q-154**: `components/ui/sparkline.tsx` gained the six props that were blocking three callers
  from using it (`pad`, `valuePadding`, `strokeWidth`, `gridLines`, `emphasizeLast`, `valueLabel`),
  all defaulted. **⚠ `valuePadding` defaults to 0.5 and that changes what a chart says** — it halves
  the amplitude of a small spread; pass `0` for exact min/max. Projection extracted to
  `sparkline-geometry.ts` so it is testable in node. Two callers converted;
  `workout/active-workout-screen` stays inline deliberately and is not a to-do.
- **[`docs/overview/entries/2026-08-25-back-dismiss-sweep.md`](../../overview/entries/2026-08-25-back-dismiss-sweep.md)**
  — 🆕 **BF-27**: the Android back gesture now closes the sheet or dialog on top rather than
  navigating the page underneath away. It reached 5 of 45 sheet files and 0 of 6 dialog files
  before. The hook is no longer wired per call site — `SheetContent` and `DialogContent` render
  [`components/ui/back-dismiss.tsx`](../../../components/ui/back-dismiss.tsx), which closes through
  Radix's own `onOpenChange` so every existing guard and cancel arm still runs. **The one thing to
  know before touching it:** the hook must be a *child* of `Content`, never a call in
  `SheetContent` — that body runs whenever a caller renders it, and every tab screen renders its
  sheets unconditionally with a null prop, so a hook one level up pushes a history entry for every
  closed sheet on the page. **And the second thing — LB-17, found while shipping Q-395c (v1.382.0):** the hook decides
  "my entry is gone" by **depth**, not by an id mismatch. It used to compare the arriving state's
  `sheetId` against its own, so every sheet that was not the one landed on closed itself — right at
  two layers by accident, wrong from three, where back lands on the *middle* sheet's entry and the
  *bottom* one reads a foreign id and closes. Each entry carries the depth it was pushed at now.
  [`2026-08-26-one-food-list.md`](../../overview/entries/2026-08-26-one-food-list.md) has the trace.
  **And the third — BF-34 (v1.383.1):** the decision logic no longer lives in this hook at all. It is
  [`lib/hooks/sheet-back-stack.ts`](../../../lib/hooks/sheet-back-stack.ts), with the hook reduced to
  React wiring, because all three failures were in *when to close* and none was reachable from a test
  while it sat inside an effect. The flag marking one of our own `history.back()` calls is
  **module-level** now: a sheet closing and a dialog opening in the same tick are different
  instances, so a per-instance flag was invisible to the one that received the pop and the dialog
  closed on the frame it opened.
  [`2026-08-26-sibling-sheet-back-dismiss.md`](../../overview/entries/2026-08-26-sibling-sheet-back-dismiss.md).

- **[`docs/handoff-2026-08-25-platform-lane-b-nineteen-prs.md`](../../handoff-2026-08-25-platform-lane-b-nineteen-prs.md)**
  — Lane B, 2026-08-25. The shell-relevant half: **LB-10**, `use-sheet-back-dismiss` was not
  StrictMode-safe, so a sheet mounted already-open closed itself on the frame it opened and five
  sheets looked unopenable in `pnpm dev` while production was fine. **Q-477 completed** — the
  client-timezone ratchet is at zero, and the workout day-rollover moved to
  [`components/shell/workout-day-rollover.tsx`](../../../components/shell/workout-day-rollover.tsx)
  in the root layout, because the rehydrate check it replaced ran on every app open. And the trap
  worth knowing before writing any Home spec: **Home's Morning Check-in is a modal**, so Radix
  `aria-hidden`s `<main>` and every `getByRole` on Home returns 0 — the failure reads as *"the
  affordance does not exist"* on correct markup.
- **[`docs/overview/entries/2026-08-17-radiogroup-keyboard-nav.md`](../../overview/entries/2026-08-17-radiogroup-keyboard-nav.md)**
  — 🆕 Q-350: all eight `role="radiogroup"`s now share
  [`lib/hooks/use-roving-radio-group.ts`](../../../lib/hooks/use-roving-radio-group.ts) for arrow keys
  and a roving tabindex. **A hook, not the `components/ui/` component the entry proposed** — the
  eight sites render five different shapes, so behaviour is what they share. Writing the guard turned
  up **Q-355**: the three goal groups pass `disabled={saving}` and PATCH on change, so the browser
  drops focus mid-save and ejects the user from the group on every keypress.

- **[`docs/overview/entries/2026-08-17-nutrition-tap-refuted.md`](../../overview/entries/2026-08-17-nutrition-tap-refuted.md)**
  — 🆕 Q-309 **refuted**: a real touch tap on Nutrition's action row works. `.click()` in Playwright
  dispatches a *mouse* sequence with no touch events, so the suspected `useDrag`/`filterTaps`
  tap-swallowing cannot be the cause; `page.touchscreen.tap()` opens the sheet every time. The spec
  now taps that way instead of `dispatchEvent`. Residue filed as **Q-354** (mouse click reaches the
  element, handler does not run, this screen only) — low priority on a touch-only target, and its
  entry says not to touch gesture code without a *touch* failure first.

- **[`docs/overview/entries/2026-08-17-ai-insight-sufficiency-gate.md`](../../overview/entries/2026-08-17-ai-insight-sufficiency-gate.md)**
  — 🆕 Q-452: `AiInsightCard` fired on every mount and the route feeds the model the literal string
  `"no data"` for absent fields, which it reads as a measured zero. The card now takes a **required**
  `hasData`. The heart-rate gate reads the trend series because that mirrors what the *prompt* reads
  (`body_metrics.restingHeartRate`/`hrvMs`). **A correction rides in the entry**: it first claimed
  `data.hrMin`/`recentHrv` were live-ring-only and would have hidden the card — re-measured,
  `recentHrv` is 65 for the seeded user and that gate works too; the earlier reading was a
  cold-compile timing artifact. The prompt half is **Q-353** (Lane A).

- **[`docs/overview/entries/2026-08-17-scroll-panel-page-jump.md`](../../overview/entries/2026-08-17-scroll-panel-page-jump.md)**
  — 🆕 Q-532: `scrollIntoView` on a sentinel scrolls **every** scrollable ancestor including the
  document, so a panel appending content drags the whole page. Use
  [`lib/hooks/use-scroll-to-bottom.ts`](../../../lib/hooks/use-scroll-to-bottom.ts) instead — the ref
  goes on the `overflow-y-auto` element. The sibling sweep found a second, unreported instance in
  the workout-builder chat, and confirmed `coach-content.tsx` is correct as written. Not
  device-verified, and no automated guard is possible today — the entry records why.
- **[`docs/overview/entries/2026-08-17-profile-group-labelling.md`](../../overview/entries/2026-08-17-profile-group-labelling.md)**
  — 🆕 Q-261, the tail of the Q-258 sweep: the six `<Label>`s in `components/profile/` that front
  button groups rather than controls. Five became `role="radiogroup"` + `aria-labelledby` following
  the three sites that already used that shape; Timezone dropped `<Label>` entirely because nothing
  was being labelled. Guarded by `e2e/profile-group-labelling.spec.ts`, whose two assertions were
  each proven lethal by mutation. Left open as **Q-350**: none of the app's eight radiogroups
  implements arrow-key navigation, which wants one shared primitive rather than eight copies.
- **[`docs/handoff-2026-08-16-app-shell-goal-cache-and-e2e-findings.md`](../../handoff-2026-08-16-app-shell-goal-cache-and-e2e-findings.md)**
  — 🆕 what came after the IA cluster: 6 PRs closing Q-255, Q-232-followup, Q-258, Q-259, Q-260 and
  Q-262. **Q-260 is the substantive fix** — `user-goals` was fetched by the Progress tab's group
  while the water goal renders on a `BODY_GROUPS` card, and because every tab stays mounted for the
  app's life nothing ever re-read it. Also two corrections to standing beliefs: Q-240's "renders the
  old one for 30 minutes" was never right for that path (`cachedFetchCore` always revalidates), and
  `invalidateGoalRecommendations()` is inert for all six keys. Records a **withdrawn** finding
  (Playwright's `:visible` is not "on screen"), three attempts at one guard of which none is one, and
  the parallel-lane trap that cost two complete pieces of work.

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
  [`docs/overview/history-2026-08-04.md`](../../overview/history-2026-08-04.md)
  (Q-73 — the home header's date string mismatched between server (UTC) and client (Australia/Brisbane)
  for 42% of every day; fixed with a fixed-timezone formatter instead of either side's ambient tz).
  Also [`docs/overview/history-2026-08-07.md`](../../overview/history-2026-08-07.md)
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
