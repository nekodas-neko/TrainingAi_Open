# Q-112 — the unified day review

**Status:** plan · **Date:** 2026-08-25 · **Author:** Implementation Lane B (planning pass, no code)
**Backlog entries:** Q-112 (umbrella) · Q-112a · Q-112b · Q-112c · Q-112d · Q-112e
**Source direction:** [`2026-08-05-owner-ui-bug-batch.md`](2026-08-05-owner-ui-bug-batch.md) Task 27
**Owner ask, 2026-08-06:** merge Home's "Your Day in Review" with Nutrition's "End of Day" into one
richer daily review, nutrition's visual language as the base, richer stats, a nicer banner *or* a
notification, a read-through → missed-meals → wrap-up flow, a ~7-day lookback, and the same
treatment for the weekly recap. **Explicit: primarily a UI/design uplift.**

---

## 1. The direction has to change, because the app moved under it

Task 27 was written on **2026-08-06**. Two days later **Q-110 shipped `/health/day`** — a
swipeable, per-date day screen with a week strip. Most of the "richer read-through of the day" this
entry asks to build now exists there, built by someone else, against the same sources this entry
names.

Re-verified against `main` @ `56b1ba3` (2026-08-25), reading the files rather than the entry:

| Task 27 asks for | Where it is today | Verdict |
|---|---|---|
| Body composition | `BodySection` — weight plus 14 rows: body fat, skeletal muscle, muscle mass, water, visceral fat, bone mass, protein, BMR, metabolic age, subcut. fat, fat-free mass, RHR, HRV, SpO₂ | **built** |
| Calories burned / expended | `EnergySection` + `EnergyTimelineChart` (intake, resting base, active kcal through the day) | **built** |
| Total weight lifted per session | `TrainingSection` — per-session volume, duration and est. kcal, grouped by session **id** | **built** |
| Steps | `BodySection` rows (steps, distance) | **built** |
| Scores | The four-cell `ScoreCell` row — readiness, RHR, sleep, move | **built** |
| "Something like the timeline for the day" | `EnergyTimelineChart` on the day screen; the *event* timeline is Home's `HomeDayTimeline` | **partly** |
| Swipe between days | `WeekStrip` + `bindDateSwipe` on `/health/day`, `touchAction: pan-y` | **built** |
| Daily min/max HR | `DayHrTrace` draws the trace. No min/max **stat** anywhere | **missing** |
| Body temperature | Nowhere on the day screen | **missing** |
| The AI digest text | `DayReviewSheet` only (`/api/daily-digest`) | **elsewhere** |
| 7-day rolling lookback | Nowhere | **missing** |
| Meal backfill · wellness scales · journal | `EndOfDayReview` only | **elsewhere** |
| A banner **or** a notification | **Both already exist** — see §2 | **built** |

**So building the merged screen as written would give the app a third day surface**, beside
`/health/day` and the nutrition day screen — and would re-implement seven sections that already
render correctly. That is the outcome the "One Formula, One Place" rule exists to prevent, arriving
through duplicated *assembly* rather than duplicated arithmetic.

### The reframe

**`/health/day` is the read-through. The evening review is a flow, not a screen.** What Q-112 is
actually missing is (a) one entry point instead of two, (b) three stats, (c) a 7-day comparison, and
(d) the wrap-up steps continuing from the read-through rather than living in a disconnected sheet.

**The enabler is already in place and is what makes this cheap.** `components/health/day-detail/day-sections.tsx`
exports `TrainingSection`, `ActivitySection`, `EnergySection`, `SleepSection`, `BodySection` and
`DayHrTrace` as standalone `memo` components taking plain props, fed from `/api/day-log` through
`useCachedValue` on the key `day-log:<date>`. They can render inside the evening sheet unchanged.
One set of section components, two hosts — and because the cache key is shared, opening the evening
review paints instantly from whatever `/health/day` already fetched, and the reverse.

---

## 2. The "banner vs. notification" decision is already made — by what shipped

Task 27 lists this as open. It is not:

- **The notification exists.** `lib/day-review-reminders.ts` schedules a local notification
  **50 minutes before the estimated bedtime** ("Bedtime approaching · Begin your wind-down and
  complete your end-of-day review"), plus a Sunday-18:00 weekly one. Both are scheduled from
  `sync-provider.tsx` and are native-only (`Capacitor.isNativePlatform()` guards them).
- **The banner exists**, on Home, gated to `hour >= 17` with a per-day dismiss flag.
- **The gap is one string.** Both notifications carry `extra: { route: '/' }`, and the tap handler in
  `capacitor-native-init.tsx:191-197` pushes exactly that. So tapping "complete your end-of-day
  review" lands the user on Home and asks them to find the banner. Deep-linking is a route string
  and a query-param handler, not a new surface.

**Recommendation: keep both, and make them the same door.** The notification is the *reminder* — the
only thing that reaches the user when the app is closed, which a banner by definition cannot. The
banner is the *in-app* entry for someone who already opened the app. Replacing the banner with a
notification would lose the second case; replacing the notification with a banner would lose the
first. What has to stop is their leading to two different places.

---

## 3. The flow

**Recommendation — one stepped sheet, three steps, sections skipped when they have nothing to ask.**

1. **The day** — the `day-sections` components above, rendered from `day-log:<today>`, plus the AI
   digest at the top. This is the "read-through", and it is the same markup `/health/day` draws.
2. **Missed meals** — the existing `MealBackfillSection`. **Skipped entirely when no meal type is
   empty**, rather than rendered as an empty prompt.
3. **Wrap-up** — the existing `WellnessSection` + `JournalSection`. **Rendered as a filled summary
   with an edit affordance when a `day_checkin` for the evening phase already exists**, as a form
   when it does not.

**The skip rule, stated once so it is not decided per section:** a step renders as a *prompt* when
it has an unanswered question, as a *summary* when it does not, and is *omitted* when it has neither
— i.e. when the domain has no data and nothing to ask for. Step 1 is never omitted.

### Why a stepped sheet and not the alternatives

- **A "Finish your day" footer on `/health/day`** would put the flow on the read-through itself,
  which is the fewest hops and closest to the owner's one-thing mental model. It loses on the
  screen's own terms: `/health/day` browses **any** date and swipes between them, while the evening
  flow is today-only, so the footer would have to appear and vanish as the user swipes — and the
  route sits outside the tab shell, so a user who wandered in from the calendar would meet a wrap-up
  prompt they did not ask for. Worth revisiting if the stepped sheet feels like a detour in use.
- **Building the merged screen as Task 27 describes** is the third day surface argued against above.
  It is better at exactly one thing — total freedom over the layout, with no obligation to keep
  `/health/day` looking the same — and that is not worth the duplication.

**Reversal cost is low.** Steps 2 and 3 are existing components being re-hosted; step 1 is existing
components being re-hosted. Backing out means pointing the two entry points at the old sheets again.

---

## 4. Phases

Each is one PR. **Lane is decided by path, not by subject** (`docs/agents/README.md` §3).

### Q-112a — one evening flow, one door (Lane B)

`EndOfDayReview` becomes the single destination. The Home banner opens it instead of
`DayReviewSheet`; Nutrition's End of Day button already does. Both notifications' `extra.route`
becomes a deep link (`/?review=day` and `/?review=week`) and Home opens the matching surface from
the query param. `components/day-review-sheet.tsx` is deleted and its digest fetch moves in — it is
the *only* consumer of `/api/daily-digest`, so nothing else breaks.

**Carry the digest's fetch defects across rather than the fetch:** its `POST /api/daily-digest` has
a `.finally()` and no `.catch()`, and its `cachedFetch` calls pass no `onError` — a failure makes
the content vanish silently, which is Q-499's class exactly. The new home gets an error state.

**Rename `chatOpen`.** `nutrition-content.tsx:684` reads `onEndOfDay={() => setChatOpen(true)}`; it
opens the review, not a chat. The name is a leftover and it will mislead the next reader.

### Q-112b — the read-through becomes step 1, and gains the three missing stats (Lane B)

Render `day-sections` inside step 1 from `day-log:<today>` — the shared key means no second fetch.
Add:
- **HR min/max** — derived from the `data.hr` points `DayHrTrace` already receives. A stat pair
  beside the trace, not a new fetch.
- **Body temperature** — through the derived-first precedence Q-105 established, never
  `oura_daily.temperature_deviation` directly: the Cloud column is frozen at the BLE re-key and
  would print a months-old figure as today's.
- **The AI digest**, at the top of step 1.

The same three stats belong on `/health/day` itself, since it is the same component set — which is
the point of hosting them once.

### Q-112c — the 7-day comparison window (Lane A)

One route returning the prior-7-day series for the stats that get a trend. **Lane A** because it is
`app/api/**`, and it comes first because the render has nothing to draw without it.

Reuse, do not re-derive: `computeActiveEnergy()` (`packages/shared/src/health/daily-energy.ts`) for
energy, `/api/workout-load-history` for session volume, `body_metrics` for composition and steps,
and `buildDayAudit`'s BLE-re-key-aware precedence for scores. **Anchor every window at
`todayMidnightUtc(tz)`, never `Date.now() − N × 86 400 000`** — six copies of that banned pattern
have shipped in this repo before.

### Q-112d — draw the trends (Lane B) · `Needs: Q-112c`

**Not every stat gets one.** Recommendation: **HR (resting), steps, session volume, and weight** — the
four that move day to day and where "against the last week" answers a question the user actually has.
Body composition percentages move too slowly for a 7-day sparkline to read as anything but noise;
scores already carry their own band language (`scoreBand()`), and a delta beside a band is two
answers to one question.

Use `components/ui/sparkline.tsx`. **Check Q-154 first** — the primitive is short six props the three
inline polyline implementations need, and that is an open `Gate: owner` decision. If those props have
not landed, draw a **delta chip** (`+1.2 kg vs. 7-day avg`) rather than adding a fourth inline
polyline. Pair every colour with a word or symbol; a coloured delta alone is the colour-only-state
violation.

### Q-112e — the weekly recap, same treatment (Lane B) · `Needs: Q-112d`

`weekly-recap-banner.tsx` + `/api/weekly-digest` get the pattern Q-112a–d proves out, at the owner's
"monthly scale" lookback. **Deliberately last**, so the daily version settles the layout first —
Task 27 says the same.

---

## 5. Constraints a build will hit

- **`app/nutrition/nutrition-content.tsx` is 786 lines against the 800-line ceiling**
  (`scripts/check-component-size.js`), and `app/session-select/session-select-content.tsx` is 1,456
  and on the hotspot list. Q-112a touches both. Extract into `components/` children; do not append.
- **BF-24 and Q-395c are in flight on the nutrition screens** (PR #474 was open on 2026-08-25).
  Q-112a's edit to `nutrition-content.tsx` is a one-line rename plus a prop; sequence it after
  whichever of those lands, and re-read the file rather than trusting these line numbers.
- **`/health/day`'s sections must keep working unchanged.** Q-112b adds to them; it must not change
  their props in a way that only the sheet needs. `e2e/day-detail-sheets.spec.ts` and
  `e2e/day-entry-edit-delete.spec.ts` guard that screen — run both.
- **The evening flow writes.** `day_checkin` (evening phase), meal backfill and the journal all
  mutate. Every write goes through its named group in `lib/cache-groups.ts` — `day-log:` and
  `home-day-timeline` among them — and the meal backfill needs its outbox domain, because logging a
  meal is reachable offline.
- **Safe area.** The stepped sheet's action row is inside a `SheetContent side="bottom"`, which owns
  its bottom inset — **do not add `pb-safe*` inside it**. If any step becomes a full-screen takeover
  instead, it needs `pb-safe-action-lg`.
- **Device gate.** Notification deep-linking, the sheet's insets and the swipe interaction are all
  in the device-verification categories. None of it is provable in the web harness.

---

## 6. Deliberately not in this plan

- **A new day screen.** Argued in §1.
- **Re-opening which stats the owner asked for.** The list is theirs; §4's judgement is only about
  which of them earn a *trend*, and that is stated as a recommendation to overrule.
- **Merging `/health/day` and the nutrition day screen.** Two screens with different jobs. BF-24 owns
  the nutrition one's layout.
- **Any scoring change.** Nothing here re-scores anything, and it must not start to — that is
  Tuning's to propose and Lane A's to build.
