# Proactive Recaps (Daily + Weekly) & AI Chat Analytics — Design

> Source: user request (2026-07-05/06), brainstormed interactively. Follow-up to the
> same-session work that redesigned the weekly digest (`/api/weekly-digest`) and
> shipped `components/weekly-recap-banner.tsx` as an in-app, dismiss-once-per-week
> banner on Home. This spec extends that pattern with a real device notification
> trigger (reusing existing local-notification infrastructure — see "Revision"
> below), a new daily "End of Day Review", and a batch of new AI-chat analytics
> tools. It does **not** re-litigate anything already shipped this session — it
> builds on it.

## Motivation

The user wants three things, confirmed interactively:

1. A **daily recap** ("End of Day Review") that nudges them ~45-60 minutes before
   their usual bedtime to wind down and review the day — and this must actually land
   as a phone notification even with the app closed, not just "whenever I next open
   the app" (the weekly recap's current behavior).
2. The existing **weekly recap** retimed from "the day after the week ends" to
   **Sunday evening, recapping the week so far** (Mon–now, not a fully-elapsed week).
3. A set of **AI-chat-callable analytics tools** so the user can ask for useful
   stats/comparisons on demand, beyond what the chat can already answer from its
   default context + existing tools.

## Revision note (kept for the record, not deleted)

This spec originally proposed a GitHub Actions cron hitting a secret-protected
endpoint that would call the existing (but currently uncalled) VAPID web-push
sender (`lib/push.ts`'s `sendPushToUser`) — reasoning that no scheduling
infrastructure existed in this app. **That premise was wrong.** The user pointed
out `lib/meal-reminders.ts` already solves this exact problem for the meal-logging
reminder: `scheduleEndOfDayReminder` computes an estimated bedtime and schedules a
**Capacitor local notification** (a native OS-level scheduled notification, not a
server push) for bedtime − 30 minutes, wired up via `SyncProvider`'s mount/resume
reconcile effect and a generic tap-to-deep-link handler already registered in
`capacitor-native-init.tsx`. This needs **zero server infrastructure** — no cron, no
secret, no migration, no push-subscription send path — because the OS handles
delivery timing natively once the app schedules it.

This was a real research gap, not a "the codebase changed" excuse: `lib/meal-
reminders.ts` had already surfaced in an earlier grep this session (checking whether
`sendPushToUser` had callers) and was never opened before Part 1 was first drafted.
Caught here, before any implementation — Part 1 below is rewritten around the
existing pattern instead.

---

## Part 1 — Scheduling via existing local-notification infrastructure (revised)

### Reuse, don't parallel-build

`lib/meal-reminders.ts` already establishes the exact pattern needed: a per-domain
lib file exporting a notification-channel constant + a `scheduleX()` function,
called from `SyncProvider`'s existing mount/resume reconcile effect (`components/
sync-provider.tsx`), tap-to-navigate handled generically by the existing
`LocalNotifications.addListener('localNotificationActionPerformed', ...)` listener
in `components/capacitor-native-init.tsx` (any notification with `extra.route` just
works — no new listener needed). New file `lib/day-review-reminders.ts` follows this
shape exactly:

- **`DAY_REVIEW_CHANNEL`** — new Android notification channel (registered in
  `capacitor-native-init.tsx` alongside the existing three), shared by both
  notifications below (both are low-importance informational nudges, unlike the
  higher-importance workout-timer channel).
- **`scheduleEveningReminder()`** — fetches `/api/user/bedtime-estimate` (see
  consolidation note below), schedules a **one-shot** local notification at
  bedtime − 50 minutes (a single concrete point inside the requested 45-60 minute
  window — LocalNotifications needs an exact `at`, not a range), titled "Bedtime
  approaching — begin your wind-down and complete your end-of-day review,"
  `extra: { route: '/' }`. Skips scheduling if that time has already passed today
  (mirrors `scheduleEndOfDayReminder`'s existing `if (at <= new Date()) return`).
  Dedupes via a `localStorage` "last scheduled date" key, exactly like the existing
  `EOD_REMINDER_KEY`/`lastScheduled === today` pattern — no duplicate scheduling on
  every app open/resume that day.
- **`scheduleWeeklyRecapReminder()`** — same one-shot-per-period shape, computes the
  upcoming (or today's, if it's already Sunday and not yet 18:00) Sunday 18:00 local,
  dedupes via a `localStorage` key storing the ISO date of the Sunday already
  scheduled for. Deliberately a one-shot re-scheduled on each app open rather than a
  Capacitor recurring (`on: { weekday, hour, minute }`) schedule, to match every
  other reminder in this codebase using the same one-shot style — one pattern, not
  two.
- Both call sites added to `SyncProvider`'s existing meal-reminder reconcile effect
  (same mount + `resume` triggers, same `Capacitor.isNativePlatform()` gate). A new
  Profile toggle ("Day & week review reminders") mirrors the existing "Meal
  reminders" opt-out — a separate preference, since a user might want one but not
  the other.
- Tapping either notification routes to `/` (Home) — no special deep-link parameter
  needed. The Home screen's own banner logic (Part 2/3 below) independently checks
  "is there an unreviewed day/week digest," regardless of whether the user arrived
  via a notification tap or an ordinary app open. The notification's only job is
  getting the OS to surface something at the right time; content-readiness is
  Home's concern, exactly like the already-shipped weekly-recap-banner.

**Accepted limitation (pre-existing in this app, not introduced by this work):**
`Capacitor.isNativePlatform()`-gated — APK only. Web/PWA users get no scheduled
nudge at all, same as the meal reminders today; they'd still see the Home banner
passively on next open, same as the currently-shipped weekly-recap-banner's
fallback behavior.

### Consolidate the duplicate bedtime calculation

Two independent implementations of "average bedtime from sleep history" existed
before this spec even started touching anything — a real "one formula, one place"
violation, found while investigating this reuse:
- `/api/user/bedtime-estimate` (existing route backing `scheduleEndOfDayReminder`):
  minutes-since-midnight with a manual "<6am treated as +24h" wraparound hack,
  falls back to 22:00 if no sleep history.
- `computeSleepStartConsistency` (`lib/health/sleep-consistency.ts`): minutes-from-
  noon reference point (cleaner wraparound handling), returns `null` under 2 samples
  — no fabricated fallback.

Fix: `/api/user/bedtime-estimate` calls `computeSleepStartConsistency` and converts
`meanMinutesFromNoon` back to an hour/minute, keeping its own `FALLBACK_HOUR`/
`FALLBACK_MINUTE = 22:00` default only for the `null` case (existing callers —
`scheduleEndOfDayReminder` — depend on always getting a concrete hour/minute back,
so the route keeps that contract; only its internal math is deduplicated). Deletes
the route's own hand-rolled minutes-since-midnight logic entirely.

### `lib/push.ts` / VAPID — untouched, not part of this work

`sendPushToUser` stays exactly as it is today (built, zero callers) — this spec
doesn't add a caller, since the local-notification path covers the requirement
without needing it. It remains available for whatever eventually does need a true
cross-platform server-push (e.g. a future web/PWA-specific notification, or an
anomaly alert that must fire regardless of the app ever having been opened that
day) — not invented a use for here just because it exists.

---

## Part 2 — Daily "End of Day Review"

### Content (all deterministic, computed server-side; the LLM only narrates)

New `app/api/daily-digest/route.ts`, mirroring the shape of the already-redesigned
`/api/weekly-digest/route.ts` (cache-first by `(userId, 'daily-digest', date)` in
`ai_health_insights`, same rate-limit pattern):

- **Training**: today's session name + exercise count + total volume (via the
  existing `getDaySessionSummaries(userId, date)` + exercise logs), or "rest day."
  Any PR achieved today (`listRecentPersonalRecords` scoped to today).
- **Nutrition**: today's calories/protein/carbs/fat vs. targets (same
  `listFoodLogs`/`getNutritionTargets` pair the `getNutritionDay` chat tool already
  uses) — omitted entirely if nothing was logged.
- **Calorie projection**: today's calorie delta (actual − target) × 7 ÷
  `KCAL_PER_KG` (7700 — the existing constant in `lib/nutrition/tdee-adaptation.ts`,
  exported for reuse rather than redefined) = projected weekly kg change **"at
  today's rate"** — explicitly framed as based on today's numbers, not a hidden
  rolling average, to keep the math honest and simple.
- **Steps**: today's steps (`body_metrics.steps`) vs. the user's `stepsGoal`
  (`UserGoals`, already exists). If `stepsGoalType === 'weekly'`, also compute
  `(weeklyTarget − stepsThisWeekSoFar) / daysLeftInWeek` = "walk ~N tomorrow to stay
  on pace." If `'daily'`, just today vs. today's target, no catch-up math. Omitted
  if no goal is configured.
- **Morning check-in recap**: today's `day_checkins` (morning) energy/soreness, so
  the narrative can close the loop ("this morning you felt low-energy, and still
  hit a solid session").
- **Phase status**: only shown when a session was actually trained today (phase
  tracking is per-session-type via the existing `PerSessionPhaseStatus`, so there's
  no single unambiguous phase to report on a rest day — skip rather than guess which
  session type's phase to surface), and only if the active program's
  `phaseMode !== 'manual'`. Reuses the existing `PhaseStatus` shape
  (`app/api/workout-data/route.ts`) for the session type trained today —
  `cycleInPhase`/`totalPhaseCycles` narrated as "N more sessions of continued
  progress and you'll move to `<next phase>`."
- If literally nothing was logged all day (no training, no food, no check-in), skip
  digest generation — the evening reminder notification still fires with the plain
  wind-down copy, but there is no sheet content to open.

### AI narrative

2-3 sentences, not bullets (a day is a much smaller scope than a week) — prompt
explicitly asks for a short check-in tone, reusing the holistic-cross-referencing
framing already added to the main chat's system prompt this session (e.g., closing
the loop between the morning check-in and the day's training).

### UI: tapping the notification (or the Home banner) opens a Sheet, not an inline expand

Unlike the plain-text weekly banner, the daily review has real charts — cramming
those into a small inline-expanding card would feel cramped. Reuses the existing
`Sheet`/`SheetContent` pattern already used everywhere else in the app for detail
views (health-metric-sheet, etc.), not a new UI primitive.

Sheet contents, top to bottom:
1. AI narrative (leads, per the "narrative-first" pattern already established this
   session on the session-explain page).
2. **HR chart for the day** — embeds the existing `HrDayChart` component as-is (no
   new charting code); hidden entirely if no Oura HR data synced that day.
3. **Workout load comparison** (only if trained today) — a small Chart.js bar chart:
   today's session's total volume plotted alongside the last 4-5 sessions of the
   *same session type* (matched by `sessionName`), today's bar visually highlighted,
   with a one-line callout below ("+12% volume vs. your last 3 Pull sessions,
   similar time-to-complete" — time-to-complete = `completedAt − startedAt`).
4. Phase status line (if applicable).
5. Nutrition + calorie projection, steps + pace, morning check-in — plain text
   lines, not charts (a single day's numbers don't gain clarity from a chart here).

The Home banner itself (small teaser card, matching the existing weekly-recap-banner
visual convention) stays simple; all the richness lives in the sheet it opens.

---

## Part 3 — Weekly recap retiming

Change from "recap of the fully-elapsed week, first shown the following Monday" to
**"recap of Monday-through-now, first shown Sunday evening"**:

- `/api/weekly-digest`'s window shifts back to the *current* ISO week (Monday to
  "now") instead of the prior one — effectively reverting the "shift back 7 days"
  change made earlier this session, since the trigger timing now supplies the
  "wait until the week is basically over" semantics instead of the data window doing
  it.
- Triggered by the same `scheduleWeeklyRecapReminder()` local notification as Part 1
  (Sunday 18:00 local, deduped per week via `localStorage`).
- Accepted tradeoff: a session logged late Sunday night, after the user already read
  the recap, won't be reflected until it's folded into general history — not
  re-surfaced. This was explicitly accepted as acceptable noise in exchange for a
  much more natural "here's your week" moment while the user is actually reflecting
  on it.
- The existing `components/weekly-recap-banner.tsx` UI (dismiss-once, localStorage
  keyed by week) is unchanged — only the timing/data-window of what it fetches
  changes, and it's now also notification-triggered on native, not just "next app
  open" (which remains the fallback on web/PWA, same as today).

---

## Part 4 — New AI-chat analytics tools

Added to `lib/ai-chat/tools.ts`, following the existing pattern (one focused tool
per concern, Zod input schema, short description the model uses to pick the right
tool). All correlation/trend math is computed in code and handed to the model as
numbers to narrate — never "here's raw data, you figure out the relationship,"
per the project's existing rule that deterministic math lives in code.

**Trend & correlation**
- `getRecoveryVsPerformance(days)` — for each day in the window with both a
  recovery signal (sleep hours / HRV / readiness) and a same-or-next-day training
  session, returns the paired series plus a deterministic Pearson correlation
  coefficient. Also folds in morning check-in soreness/energy as additional paired
  points rather than a separate tool.
- `getDayOfWeekTrends()` — historical average volume/RPE per weekday across all
  logged sessions.

**Progress & plateau**
- `getPlateauReport()` — per exercise with ≥3 logged sessions, a trend
  classification (improving / plateaued / declining) from the estimated-1RM slope,
  plus days-since-last-PR. Sorted most-stalled first.
- `getProgressVsPast(period: 'month' | 'quarter')` — volume, top-lift 1RMs, body
  weight, and average sleep now vs. N period ago. Implemented by extracting a
  shared `buildPeriodComparison(userId, windowDays)` helper reused by **both** this
  tool and `/api/weekly-digest` (which is really just `buildPeriodComparison` with
  `windowDays = 7`) — avoiding a third copy of "this period vs. the period before"
  math.

**Load & milestones**
- `getTrainingLoadRisk()` — exposes the existing `computeVolumeAcwr` result and the
  existing HRV-baseline-deviation calc (both already built for other cards) as a
  single tool, so "am I at risk of overtraining?" gets real numbers.
- `getMilestones()` — all-time totals: workouts logged, total volume lifted, PRs
  this year, longest training streak.

**Explicitly out of scope for v1** (flagged during brainstorming, not silently
dropped): a fully generic "any metric vs. any metric" correlation engine. The six
tools above cover every concrete case discussed; a generic engine is more complex to
build correctly and isn't needed yet.

---

## Testing approach

Consistent with this project's existing convention (`app/api/**/route.ts` files are
never unit-tested directly; logic is extracted into small pure `lib/` functions and
tested there):

- `computeVolumeAcwr`, `computeSleepStartConsistency`, deterministic-math helpers
  used above already have their own tests where they already exist; new pure helpers
  introduced by this work (the calorie projection, the steps-pace calc,
  `buildPeriodComparison`, the plateau-classification slope logic, the
  Pearson-correlation helper, and `computeMealReminderActions`-style pure scheduling
  logic for the two new reminders) each get their own unit tests at the point
  they're implemented, mirroring `lib/__tests__/workout-reminders.test.ts`'s
  existing pattern for the sibling reminder domains.
- No cron route to verify — the scheduling logic is client-side and native-only, so
  it's verified the same way the existing meal/workout/supplement reminders already
  are: pure-function unit tests for the scheduling decision, plus an on-device pass
  for actual OS-level delivery (see below).

## Not exercised in this sandbox (declare explicitly, don't silently skip)

- Real on-device local-notification delivery / lock-screen behavior — this sandbox
  has no Capacitor/native runtime (same caveat every existing reminder in this app
  already carries).
- On-device Samsung WebView rendering of the new Sheet + embedded charts.
- Confirming `/api/user/bedtime-estimate`'s consolidated output is byte-identical to
  its pre-refactor output across the historical data already in production (verified
  against fresh local-dev-seeded data instead).

## Suggested implementation chunking

This spec covers one coherent user request, but it's too large for a single
implementation plan/PR — following this project's existing convention of splitting
multi-area work into chunks (e.g. Batch N's 3 chunks), the eventual plan should
split roughly as:
1. Bedtime-calculation consolidation (small, standalone, zero risk to ship alone)
   + the two new `lib/day-review-reminders.ts` scheduling functions + `SyncProvider`/
   `capacitor-native-init.tsx` wiring + the new Profile toggle. Nothing user-visible
   shows content yet (no digest route exists), but the notifications themselves can
   ship and be verified independently.
2. Daily digest route + End of Day Review sheet (charts, Home banner wiring).
3. Weekly recap retiming (small — reverts one recent change, retimes the trigger).
4. The six new AI-chat analytics tools (independent of 1-3; could even land first
   or in parallel).
Chunks 2 and 3 depend on chunk 1's notifications actually routing somewhere
meaningful to feel complete, but both can be built and manually-triggered/tested
before chunk 1 exists.

## Open items intentionally deferred, not forgotten

- `getRecoveryVsPerformance`/`getDayOfWeekTrends` etc. becoming candidates for a
  Health-tab card in addition to being chat-callable — not requested, not designed
  here; the request was specifically "through the chat."
- "Consistency & adherence" tools (training/nutrition/sleep logging adherence over
  time) — deliberately scoped out of v1 during the brainstorm's category vote; cheap
  to add later since most of the underlying computation already exists elsewhere in
  the app.
