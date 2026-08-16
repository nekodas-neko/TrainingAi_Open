# TrainingAI — User Review Round 2 (2026-07-04)

Hands-on user review of the running app (Samsung S25), captured as 13 findings (U1–U13)
across Home, Health, the Workout page, the training calendar, and Nutrition. Each was verified against `main`
@ `1ebe968` by reading the code (file:line cited). **Nothing has been fixed yet** — this
doc is the spec/backlog source for the entries added to `docs/implementation-backlog.md`.

Every finding here is **new to the queue** — the pre-existing review block
(`2026-07-04-post-update-review.md`, backlog items 1–8) came from a diff-based audit and
covers different specifics. A few of these sit adjacent to queued work (noted inline) but
are distinct.

Design decisions taken with the user during this review:
- **Mood check-in and morning check-in stay separate.** Rename the mood sheet to
  "Exercise Readiness" (energy + soreness) and restyle it; separately restyle the morning
  dials. Do **not** merge the two surfaces.
- **"Why this" rework direction left open** — captured as a design item (U6), not locked to
  a specific layout yet.

---

## HIGH — real bugs (data looks lost / silently missing)

**U1. Nutrition: food total flashes in, then disappears until you leave and return.**
Symptom: log a saved meal (screenshot shows "Protein Shake + Rice thins logged") and the
kcal/macros update for ~1s then revert to 0; correct totals only appear after navigating
away and back.
Root cause: totals are derived each render from `logs` (`app/nutrition/nutrition-content.tsx:273-276`).
The direct scan/manual/describe path is optimistic-safe — it returns the optimistic log and
appends it (`lib/nutrition/log-food.ts:154-235`, `food-logger-sheet.tsx:232` →
`nutrition-content.tsx:233-234`). But the **saved-meal** and **end-of-day** paths call
`onLogged()` with **no argument** (`food-logger-sheet.tsx:155`; also `:362`,
`nutrition-content.tsx:494`), which takes the `else` branch → `fetchData` → `loadFoodLogs`,
whose `setLogs` (`nutrition-content.tsx:176`, fallbacks `:133`/`:180`) **overwrites the
optimistic state with a read that doesn't yet contain the new rows**. Two compounding causes:
(1) `invalidateNutritionWrite()` clears the food-logs cache so the refetch hits the network,
but `pushMutations` is fire-and-forget so the server still returns the pre-write list; (2) the
saved-meal local write (`lib/nutrition/log-meal.ts:18-31`) **never mirrors `food_items`**, and
`getFoodLogsWithItems` uses an INNER `JOIN food_items` (`lib/local-store/sqlite-backend.ts:1036`),
so the new rows are joined out of the local read too. Violates CLAUDE.md:83 ("after an
optimistic local write, never apply or cache a server response that would replace it with
null/absent data").
Fix direction: make the saved-meal/EOD paths return optimistic logs like `log-food.ts` (and
mirror `food_items` in `log-meal.ts`), and/or make `loadFoodLogs` never overwrite a non-empty
optimistic `logs` with an emptier read. (The `food_items`-mirror half overlaps M21 in the
prior review / backlog item 2's territory; the optimistic-overwrite half is distinct.)

**U2. Calendar workout: "No HR data" on a session where the ring was worn.**
Symptom: the Health day-detail sheet's HR RECOVERY block shows "No HR data — ensure Oura was
worn and synced" for a workout that had ring data available.
Root cause: the day-detail sheet lives inline in `app/health/health-content.tsx` (the
`dayOverlay` Sheet, `:848`). On expand it calls `loadSessionHr` (`:498-512`), which does a
**read-only** `GET /api/oura/hr-data?sessionId=…` (`:502`) and stores the `'none'` sentinel
when no readings come back (`:507` → renders the message at `:933`). The route joins HR
**purely by time window** with no session FK (`app/api/oura/hr-data/route.ts:19-34` →
`lib/data/postgres/slices/oura.ts:342-352`), and rows only exist in `ouraHeartrate` if
something previously **pulled them from Oura** via `syncHrForSession` (`lib/oura/hr-sync.ts:8-32`,
triggered by `POST /api/oura/hr-sync`). The calendar sheet **never triggers that sync** — unlike
the Done screen, which POSTs `hr-sync` before reading (`components/workout/done-screen.tsx:97-103`).
So if the one-shot completion sync missed/failed, the workout predates the feature, or Oura
backfilled the readings later, the window stays empty **forever**.
Fix direction: have `loadSessionHr` POST `/api/oura/hr-sync` (like the Done screen) before/alongside
the GET. Secondary hardening: sessions with `completedAt == null` also fall into `'none'`; and
verify the ±10-min window join isn't losing readings to timezone skew.

**U3. Home: Heart-Rate "Today" chart still missing the overnight sleep band.**
Symptom: the sleep-region colour band under the HR curve is absent.
Root cause: the band is inferred purely client-side from readings tagged `source === 'sleep'`
with ≥20 contiguous minutes (`components/health/hr-day-chart.tsx:128` →
`findSourceWindows` `:58-78`; gated by `hasSleep` `:181,183`). On any night whose synced
readings carry no `sleep`-tagged samples (or <20 min of them), `sleepWindows` is empty → no
band, no legend. PR #185 narrowed the filter from `['sleep','rest']` to `['sleep']` (killing
phantom daytime bands) which made this **worse**; the intended fix — source the band from the
actual `sleep_sessions` bedtime interval — was written up in PR #191's follow-up doc
(`docs/superpowers/plans/2026-07-04-ui-bugfixes-hr-restday-charts.md:45-90`) but **never
implemented**. `app/api/oura/hr-day/route.ts:22-29` returns only `{date, readings}` — no sleep
interval.
Fix direction: return the primary sleep session's `bedtime_start`/`bedtime_end` from
`/api/oura/hr-day` (clipped to `[0,1440]` local minutes) and draw the band from that interval
instead of from per-reading `source`. Keep a `source`-based fallback for nights with no sleep
session.

**U4. Strength Trend pager renders as a row of huge grey circles (on-device only).**
Symptom: ~8 large solid grey circles under the sparkline (screenshot). Previously mis-diagnosed
as a "stale build — no change needed" because it only reproduces on mobile.
Root cause: the pager buttons intend 6px pills (`components/health/strength-trend-card.tsx:107-125`,
`h-1.5` + inline `width:6px/16px` + `rounded-full`), but a global mobile tap-target rule
`@media (max-width:640px) button { min-height:44px; min-width:44px }` (`app/globals.css:462-472`)
floors every `<button>` to 44×44 on the actual phone. With `rounded-full` each becomes a 44px
grey circle. Desktop (>640px) is unaffected — hence the earlier misread.
Fix direction: add the existing `tap-dense` opt-out class (`globals.css:474-476`) to the pager
buttons. Near one-line.

---

## MEDIUM — UX gaps & perf

**U5. Opening the app in the morning doesn't trigger a background sync of sleep/HR.**
Root cause: `components/sync-provider.tsx` never calls `/api/oura/sync` on mount or `resume`
— its effects only do `pushMutations`/`pullDelta` (server⇄device mirror) and reminder
reconciliation. `pullDelta` only propagates Oura data the **server already has**; it does not
pull from the Oura cloud. The only app-open Oura pull is a >6h-throttled auto-sync that fires
when the user lands on the **Health tab** (`app/health/health-content.tsx:472-481`) — Home
has manual refresh / pull-to-refresh only (`session-select-content.tsx:509,958`).
Fix direction: add one throttled `useEffect` in `SyncProvider` (mirror the reminder-reconcile
pattern `:142-174`): on mount + `App.addListener('resume')`, if `localStorage 'ta_oura_last_sync'`
is >N h old, `POST /api/oura/sync` then invalidate the biometric/Oura caches. Reuse the 6h
window already established in `health-content.tsx:475-478`.

**U6. "Why this?" (recommended-workout explanation) is slow to open, has bad safe-area, and
is hard to follow.** *(design item — layout direction left open)*
Slow: `app/session-explain/page.tsx:22` `await`s a full `getNextSession` recompute server-side
before paint, then `ai-insight-card.tsx:11-34` fetches `/api/session-explain/insight` which
runs `getNextSession` **a second time** (`insight/route.ts:19`) and cold-streams Gemini
(`:56-62`) on the first open of the day. No cache seed (contrast the Home card). The
`?sessionId=` param the card passes is ignored — the page recomputes from scratch.
Safe-area: `session-explain-content.tsx:72-86` uses plain `pt-4`/`pb-10`, **no** `pt-safe`/`pb-safe`
(utilities exist at `globals.css:301-342`) — header sits under the status bar. Note this page is
**not** covered by queued Safe-area round 3 (backlog #4).
Hard to follow: the plain-language AI narrative renders **last and slowest**
(`session-explain-content.tsx` bottom), above a long undifferentiated list of jargon-y
`SignalCard`s ("58% of baseline ↓", weighted %) with no grouping/prioritisation.
Fix direction (to be finalised in a plan): seed the page from the Home recommendation cache +
honour the passed `sessionId` to avoid the double recompute; add `pt-safe`/`pb-safe`; lead with
the readable synthesis (cache/prewarm the AI insight) and demote/​group the raw signals.

**U7. Health: "AI Periodization" and "Muscle Volume This Week" flash a skeleton on every visit.**
Root cause: both cards *have* cache seeds, but they're gated behind
`next/dynamic({ ssr:false, loading:<skeleton> })` (`app/health/health-sections.tsx:35-42`), so
the loading skeleton paints before the JS chunk (and thus the seed) arrives on cold/relaunch
loads. The AI card also seeds in `useEffect` rather than `useLayoutEffect`
(`ai-periodization-status-card.tsx:55-58`), adding a one-frame skeleton even warm. Both cards
are lightweight (no chart.js/KaTeX), so the `dynamic` wrapper buys little. Violates CLAUDE.md:191
("a skeleton flash on a repeat visit is a bug").
Fix direction: static-import these two small cards; move the AI card's seed to `useLayoutEffect`.
(Adjacent to backlog #6 render/store discipline but a distinct cause.)

**U8. Morning check-in dials should match the end-of-day review dials.**
Root cause / current state: the morning check-in **already shares** the `ScaleSelector`
component with end-of-day (`components/morning-checkin-sheet.tsx:135-144`;
`components/nutrition/end-of-day/scale-selector.tsx`) and **already auto-selects** to recorded
data. Two gaps vs. the evening dials: (1) `MORNING_SCALES` (`lib/types/day-checkin.ts:42-48`)
has no per-scale `color` and the sheet passes no `color` prop, so morning dials fall back to
grey while evening dials render coloured (`EVENING_SCALES` `:30-36` + `wellness-section.tsx:31`);
(2) neither shows a **word label per rung** — `ScaleSelector` renders the digit `1–5` plus
low/high endpoint labels only.
Fix direction: add a `color` to each `MORNING_SCALES` entry; add a per-rung word label to
`ScaleSelector` (one file — updates morning **and** evening at once).

---

## UI polish / small features

**U9. Calendar day-detail: show average sets/reps, not every set concatenated.**
Current: `app/health/health-content.tsx:914-919` maps every set and joins with `" | "` →
"6 × 55kg | 6 × 55kg | 6 × 55kg | 7 × 55kg". Compact helpers already exist but are
module-private in `components/workout/pre-workout-screen.tsx`: `modalWeight()` (`:28-38`),
`avgReps()` (`:40-44`), representative line assembled `:282-290`.
Fix direction: export the two helpers (or lift to a shared util) and render one representative
line here (the `ex` object exposes `reps`/`setWeights`/`weightKg`).

**U10. Nutrition "Log Food" sheet: add Saved Meals as a grid button and reorder.**
Current: a Recent/Saved-Meals `SegmentedTabs` bar (`components/nutrition/food-logger-sheet.tsx:251-259`)
plus a `grid grid-cols-2` of tiles in `components/nutrition/capture-step.tsx:156-177`: Scan Photo,
Barcode, Describe it, History, Manual Entry.
Requested order (grid): **Scan Photo, Barcode → Describe it, Manual Entry → History, Saved Meals.**
Fix direction: reorder the `tiles` array and add a sixth "Saved Meals" tile wired to a new
`onSavedMeals` callback (`SavedMealsSheet` already exists at `food-logger-sheet.tsx:359-363`).
Decide whether the Recent/Saved-Meals `SegmentedTabs` is still needed once Saved Meals is a
grid button.

**U11. "Exercise Readiness" rename** *(design item — kept separate from morning check-in per
user).* Rename the emoji/chip `MoodCheckInSheet` (`components/mood-checkin-sheet.tsx`, currently
titled "Daily Check-in") to something like "Exercise Readiness", scoping it to energy level +
muscle soreness. Its store stays `mood_logs` (`lib/types/mood.ts`). Trigger sites:
`home-card-widget.tsx:243` (`card_moodWidget`) and `session-select-content.tsx:1087`. Needs a
small design pass on copy/fields before implementation.

**U12. Calendar day-detail: add whole-session edit/delete (with delete confirmation).**
Current: per-**exercise** pencil/trash exist with confirm dialogs (`health-content.tsx:921-926`,
`:793-835`), but there is **no** edit/delete affordance for the whole session — the session
header (`:887-907`) only expands/collapses. A reusable `ConfirmDialog` primitive exists
(`components/ui/confirm-dialog.tsx`, `variant="destructive"`) — the sheet currently hand-rolls
its confirms with raw `<Dialog>`, so a new session-delete confirm should reuse `ConfirmDialog`.
Fix direction: add a session-level edit/delete control opening a dialog; delete requires
confirmation; wire a whole-session delete handler (none exists today).

**U13. Workout carousel: no clear indicator of the day's recommended session.**
Symptom: Home shows a prominent gold "RECOMMENDED TODAY · Pull" card, but the Workout page
carousel just shows Pull as the first card with nothing marking it as the recommendation —
the user can't tell which session is recommended.
Current state: `app/workout-select/workout-select-content.tsx` already reads the recommendation
(`readCacheSync('next-session')` / `cachedFetch('next-session', …)`, `:124-128`, `:147-157`) but
uses `rec.session.id` **only** to set the default carousel index — it never passes an
"isRecommended" flag to the card. The card render (`:290-358`) shows name/last-trained/phase/
exercise-count/muscle-diagram/Start button with no recommended badge; the dot indicators
(`:365-378`) don't distinguish it either.
Fix direction: render a "Recommended today" badge/pill on the card whose `id === rec.session.id`
(data is already in scope), and optionally highlight its dot indicator. Low-risk — no new fetch.

---

## Grouping into backlog entries

| Entry | Findings | Kind | Notes |
|---|---|---|---|
| Nutrition food-log live-update | U1 | bug | overlaps #2/M21 on the `food_items` half |
| Calendar workout HR sync | U2 | bug | |
| HR sleep band from interval | U3 | bug | implements PR #191's unbuilt note |
| Review-round-2 UI polish (one PR) | U4, U7, U8, U9, U10, U13 | small/mechanical | all low-risk, high-visibility |
| App-open Oura sync | U5 | UX | throttled |
| "Why this" overhaul | U6 | perf+safe-area+design | needs a plan doc |
| Exercise Readiness rename | U11 | design | needs copy/fields decision |
| Calendar session edit/delete | U12 | feature | |

Device-gated (sandbox can't verify): U4 (mobile-only CSS rule), U2/U3/U5 (real Oura data +
native sync), U7 (Samsung WebView chunk timing). Run `docs/device-smoke-checklist.md` for each.

---

# Addendum — meta-review (2026-07-04, second pass)

A second pass over the 13 findings asking three questions: *why did existing rules/checks
miss these*, *is this doc sufficient for an implementer*, and *what did the review not cover*.

## Review conditions (context an implementer needs)

- Device: Samsung S25 Ultra APK, **dark theme only** — no light-mode screens were reviewed.
- Session: morning (screenshots timestamped ~7:30–9:15am AEST), all online — offline
  behaviour was not exercised.
- Screenshots live only in the session chat, not in-repo. The findings' "Symptom" lines are
  the durable record.
- Interpretation flag on **U6**: the user's phrasing was "safe space no accurate on the why
  this card" — read as *safe-area insets wrong on the why-this page*, corroborated by code
  (the page really has no `pt-safe`/`pb-safe`). If the user meant spacing on the Home
  recommendation card instead, re-check with them before planning.

## U4 — deepened root cause (supersedes the section above)

The `tap-dense` opt-out class is defined in `globals.css` but has **zero adopters anywhere
in the codebase** (grep confirms 0 usages). So the 44px floor applies to *every* `<button>`
under 640px with no exceptions in practice — the strength-trend pager is just the most
visible casualty. A quick scan finds ~15 files containing buttons with intended tiny
dimensions (`h-1.5`/`h-2`/`w-2`) that are candidates for the same silent inflation:
`calendar-widget.tsx`, `oura-section.tsx`, `injury-card.tsx`, `achievements-grid.tsx`,
`exercise-manager.tsx`, `goal-spectrum.tsx`, `warmup-screen.tsx`, `food-logger-sheet.tsx`,
`assign-step.tsx`, `review-step.tsx`, `profile-tab.tsx`, `health-metric-sheet.tsx`,
`builder-wizard.tsx`, `ai-periodization-status-card.tsx`, plus the strength-trend card.
**Fix scope correction:** not a one-line `tap-dense` on one pager — audit all sub-44px
buttons at a ≤640px viewport and either apply `tap-dense` or (better) move the tap-target
floor out of the bare `button` element selector into the shared `<Button>` component
variants, where dense controls simply don't inherit it.

Why the earlier "stale build — no change needed" verdict happened: the rule is inside
`@media (max-width: 640px)`, so any check at a desktop-width viewport renders the pills
correctly. The user report was dismissed without reproducing at the device viewport against
current `main`. (Local git can't date the rule's landing — the sandbox clone's history
boundary swallows it — but the mechanism is fully explained by viewport width alone.)

## Root-cause patterns across the 13 findings

1. **Sibling-surface drift** — U1 (`log-meal.ts` lacks the `food_items` mirror that
   `log-food.ts` has), U2 (calendar HR block lacks the `hr-sync` POST the Done screen has),
   U8 (`MORNING_SCALES` lacks the `color` field `EVENING_SCALES` has), U9 (calendar shows
   raw sets while pre-workout got compact helpers in PR #192), U13 (Home card shows the
   recommendation badge, the carousel doesn't). Five of thirteen findings are the same
   shape: a pattern landed on one surface and its sibling was never swept. CLAUDE.md
   mandates this sweep for offline-sync write paths ("sync-push must mirror the web route,
   same PR") but has **no equivalent rule for UI surfaces rendering/writing the same
   domain**.
2. **Global element-selector CSS with an unadopted opt-out** — U4. A generic best practice
   (44px tap targets) was implemented as a blanket `button {}` selector inside a media
   query, with an escape hatch (`tap-dense`) that nothing ever adopted. A global rule whose
   opt-out has zero usages was never audited against existing dense UI.
3. **User reports dismissed without device-condition repro** — U4's earlier "stale build"
   verdict. CLAUDE.md's "never mark an issue fixed from intent" covers *fixes*; there is no
   mirror rule for *invalidating reports*.
4. **Documented findings that never enter the queue evaporate** — U3. PR #191 wrote up the
   sleep-band fix; `projectOverview.md` even said "Not yet added to the backlog queue"; it
   then sat unbuilt until the user re-reported it from the app.
5. **Rule tension resolved the wrong way** — U7. "Heavy widgets load via `next/dynamic`"
   was over-applied to two lightweight cards, where the `loading:` skeleton structurally
   defeats the "instant paint / seed from cache" rule. The two rules currently give no
   guidance on which wins for small components.
6. **Callback signatures that invite the forbidden refetch** — U1. The no-arg `onLogged()`
   variant *means* "refetch after write", which is exactly the optimistic-overwrite
   anti-pattern CLAUDE.md already bans — but the callback contract made it the path of
   least resistance.
7. **CI checks assert absence-of-bad, never presence-of-good** — U6's missing `pt-safe`
   passes the "No hand-rolled safe-area insets" grep precisely because the page uses
   *nothing at all*. Same blind spot class as C4 in the previous review (FAB under nav).

## Proposed CLAUDE.md / CI additions (feed into backlog item 8)

- **Sibling-surface sweep rule:** when fixing or adding a pattern on one surface (a write
  path, a fetch+sync pairing, a display format, a scale/dial config), grep for every other
  surface handling the same domain and update them in the same PR — the UI analogue of the
  existing sync-push mirroring rule. Would have prevented U1, U2, U8, U9, U13.
- **No global element-selector styling:** tap-target floors, focus rings, etc. belong in
  the shared component (`components/ui/button.tsx` variants), never in a bare `button`/`a`
  selector in `globals.css`. Any unavoidable global rule with an opt-out class must land
  with the opt-outs applied (audit sub-size controls in the same PR). CI candidate: fail on
  new bare element selectors inside media queries in `globals.css`.
- **Report-invalidation rule:** never dismiss a user-reported visual bug as "stale build" /
  "can't reproduce" without reproducing at the S25 viewport (≤640px Playwright context)
  against freshly-pulled `main`. The mirror of "never mark an issue fixed from intent".
- **No orphaned findings:** any bug/gap written into a plan, review, or journal doc gets a
  backlog entry or `projectOverview.md` Known-Issues row **in the same PR** — a documented
  finding without a queue entry is a dropped finding (U3's failure mode).
- **`next/dynamic` clarification:** `dynamic({ssr:false})` is only for genuinely heavy deps
  (chart.js, KaTeX, markdown, the AI overlay). Lightweight data cards are static-imported;
  a `loading:` skeleton on a cache-seeded card is a contradiction (the skeleton wins).
- **Mutation-callback contract:** completion callbacks must carry the written entity
  (`onLogged(log)`); a parameterless "please refetch" callback fired after a local write is
  the U1 anti-pattern and is banned.
- **CI candidate — safe-area presence check:** new `app/**/page.tsx`/full-screen content
  components must reference a `pt-safe*` utility (allowlist for sheet-hosted content).

## Acceptance criteria for the queued entries

- **#9 (U1):** log a saved meal offline-capable path → totals update instantly and **stay**
  correct through the refetch settling, on web and APK; EOD-review logging same.
- **#10 (U2):** expanding a past workout with ring worn triggers a sync; HR chart renders
  on second expand at latest; null-`completedAt` sessions show a distinct message, not
  "ensure Oura was worn".
- **#11 (U3):** band renders on a night with zero `sleep`-tagged readings but an existing
  sleep session; no daytime phantom bands regress (PR #185's fix preserved).
- **#12 (U4):** all 15 candidate files audited at 412px viewport; pager pills ≤8px tall.
  (U7): zero skeleton frames on a warm revisit of Health → Training. (U8): morning dials
  coloured + every rung shows its word on both sheets. (U9): one representative line per
  exercise. (U10): six tiles in the specified order. (U13): recommended card visibly
  badged.
- **#13 (U5):** cold-open after >6h → sleep/readiness data appears without visiting Health
  or tapping refresh (verify on APK with real token).

## Coverage gaps — surfaces this review did not touch

Highest-value candidates for review round 3, roughly ordered by risk:

1. **Supersets end-to-end** — sub-PR 3 (PR #209) just landed: the workout orchestrator now
   alternates exercises by group. Brand-new, zero on-device exposure, touches the
   highest-regression-risk screen in the app.
2. **Active workout flow** (set logging, rest timer, RPE, warmup, 1RM sheet) — not
   exercised this round at all.
3. **Light theme** — every screenshot was dark mode; queued item 5 already documents known
   light-mode breakage, and a 10-minute light pass would likely surface more.
4. **Offline round-trip** — airplane-mode logging (food, sets, mood) → relaunch → sync;
   the entire review ran online. This is where the queue's data-loss cluster (#2) lives.
5. **Recently-shipped Batch I features** — injury swap sheet, TDEE adaptation card,
   Year-in-Review page: all new, none user-reviewed yet.
6. **End-of-day review flow** (evening dials, wellness section) — only the morning path
   was reviewed; U8's dial changes touch both.
7. **Stats / Overview / More / Profile / Achievements** — unvisited.
8. **Food scan paths** (photo, barcode, describe) — only saved-meal logging was exercised;
   U1's fix touches these paths' callback contracts too.
9. **Program editor / workout builder** — superset linking UI shipped in sub-PR 2,
   unreviewed on device.
10. **AI chat overlay** — the FAB-under-nav bug is queued (block-1 C4) but the chat flow
    itself is unreviewed.
