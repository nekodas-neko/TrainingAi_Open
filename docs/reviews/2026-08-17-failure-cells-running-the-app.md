# Review — 2026-08-17 · the failure cells, exercised live

_Lens: **the failure cells** — the error path, the empty state, the first-run path, the entry point
reached out of order. Run, not read._

_Findings: **Q-450 … Q-455**. Two of them are silent data-loss / dead-primary-action bugs on paths a
real user reaches. Four areas came back **clean** and are recorded as such at the bottom._

## Why this lens

The six review rounds that closed on 2026-08-17 (`docs/handoff-2026-08-17-cross-comprehensive-review-six-rounds.md`)
state their own limit plainly: *"Nothing in six rounds was rendered — no device, emulator, browser,
or `pnpm dev` run. Every finding is from source reading, production queries, or the local load-test
harness."* Thirty-eight backlog entries came out of that, and none of them could have come from
watching the app behave. This sweep does only the thing those rounds could not.

Everything below was reproduced against `pnpm dev` on the seeded local Postgres, driven through
Playwright at the S25 viewport (412×915) using the repo's own harness config, or hit directly with
`curl` against a real signed-in session cookie. Line references are to `main` at `e3b3b86`.

## Method, and what it does not establish

Four passes:

1. **Date-param matrix.** The 11 `app/api` routes that read a `date`/`localDate` search param, each
   hit four ways with a live session cookie: `?date=2026-08-14` (dash), `?date=2026/08/14` (slash —
   what `localDateString()` actually emits), `?date=not-a-date`, and the param omitted entirely.
2. **Unauthenticated sweep.** All **122** `app/api` routes exporting a `GET`, called with no cookie.
3. **Zero-data account.** A second user (`fresh@local.dev`) inserted with no program, no logs, no
   metrics, `is_active=true`; all 122 GET routes called as that user and diffed against the seeded
   user's status codes.
4. **Rendered sweep.** 30 screens as the seeded user and 21 as the zero-data user, capturing console
   errors, uncaught page errors, failing `/api/` responses, rendered text length and screenshots.

**What this does not establish.** This is the **web** build. `getLocalStore()` returns null here, so
every offline-first domain took its web fallback and the device branch — the canonical runtime — was
never exercised. Nothing here was seen on the S25, so no safe-area, Samsung-WebView, native-plugin
or native-SQLite claim is made. Local Postgres is a *fresh correct seed*, so nothing here can speak
to prod data drift. Two routes returned environment-dependent failures locally
(`/api/download-apk` 502, `/api/oura-ble/decoder-constants` 500) that are almost certainly the
sandbox's missing `APK_RELEASE_REPO` and unreachable model-constants bucket rather than product
bugs — where I file something from those, the finding is about the **shape** of the failure, not its
trigger. The rendered sweep waited a fixed 6–12 s per screen; a screen slower than that would read
as sparse, so the two blank screens below were both re-checked warm, after compilation, and
reproduced.

---

## Q-450 — `/activity` reached without a type is a live data-loss trap: Start works, Finish works, Save silently does nothing

**Severity: high. This one loses a completed activity with no error message.** `[activity][cardio]`

`components/activity/activity-screen.tsx` renders `PreActivityScreen` whenever `mode === 'pre'`, with
no guard on `activityType`. The store's initial state (`lib/stores/activity-store.ts:71-74`) is
`activityType: null, activityLabel: '', activityIcon: ''`, and `resetSession()` (`:180`) restores
exactly that — so the untyped state is not exotic, it is where the store **sits between activities**:
`resetSession()` runs after every successful save, and again on the back button inside
`PreActivityScreen` itself (`pre-activity-screen.tsx:24`).

Reached in that state the screen renders, in full, the text **"Title / Start"**. The `<h1>` and the
type caption both bind `activityLabel`, which is `''`; the icon falls through `getActivityIcon('')`
to a placeholder ellipsis glyph. 58 KB of HTML, 11 characters of text. Screenshot evidence: a bare
back chevron, a green dotted circle, an unlabelled "Title" field and a full-width **Start** button.

Then the failure completes itself:

| Step | Observed |
|---|---|
| Tap **Start** | Works. Transitions to the active screen, timer running (`0:05 / Pause / Finish`) |
| Tap **Finish** | Works. Summary screen renders (`0.1 / min / Discard / Save`) |
| Tap **Save** | **Nothing.** No toast, no error, no navigation, no state change, **zero network requests** |

The dead end is `components/activity/done-activity-screen.tsx:167`:

```ts
async function handleSave() {
  if (!activityType || !startMs || !endMs || !draftSummary) return
```

`activityType` is null, so `handleSave` returns before `setSaving(true)` — before the local write,
before the outbox `queueMutation`, before the `/api/activity-logs` web fallback. The user's recorded
activity is unrecoverable; **Discard is the only control on that screen that works.** Confirmed:
`select count(*) from activity_logs` = 0 after the full run.

This is the `CLAUDE.md` **"No silent fallbacks on failure paths"** rule and the **"UI feedback fires
synchronously"** rule, in the same guard.

**Two in-app paths reach it** — `startActivity()` has exactly two callers repo-wide
(`components/workout/log-activity-sheet.tsx:42`, the picker, and
`components/running/running-plan-content.tsx:204`), and both correctly set the type before pushing.
The other two navigations to `/activity` do not:

- **`components/coach/handoff-card.tsx:16`** — `log_activity: { href: "/activity", … }`, a plain
  `<Link>` in the AI Coach's fixed destination map. Nothing sets a type. Any time the coach offers
  "Log an activity", tapping it lands here.
- **`components/guided-walk/walk-summary.tsx:286`** — `onClick={() => { onDone(); router.push('/activity') }}`,
  the only exit from the guided-walk summary. `onDone` is the *guided-walk* store's `reset`; nothing
  in `components/guided-walk/` touches the activity store at all (verified: zero `useActivityStore`
  imports in that directory). So this lands on whatever the activity store last held — `null` for
  any user who has completed or backed out of an activity before.

Plus the ordinary ones: a cold app open on `/activity`, `lib/native/run-status-chip.ts:73`'s
`window.location.assign('/activity')`, and any refresh of the URL.

**Not device-verified.** Reproduced in the web build only. `getLocalStore` returns null here, so the
run above exercised the web fallback; on device the guard at `:167` sits *above* the local-store
branch too, so the bail-out is if anything earlier, but that is reasoning, not an observation.

---

## Q-451 — a brand-new account's Workout tab is a giant empty card with a dead "Start Workout" button

**Severity: high on the first-run path — this is the app's primary tab and primary action.**
`[workouts][app-shell]`

Signed in as a zero-data account and opened `/workout-select` (the `Workout` bottom-nav destination,
and where `/workout` and `/session-select` both resolve). What renders, at the S25 viewport: a
~1,400 px tall empty peach card, a lone 💪 in its top-left corner, and a full-width green **Start
Workout** button at the bottom. Full rendered text of the screen: *"Workout / Choose a session to
start / 💪 / Start Workout / Cardio Hub / Run · Walk · Log anything"*.

**Tapping Start Workout does nothing.** Same URL, same DOM, no navigation, no toast, no console
error, no `/api/` request. `app/workout-select/workout-select-content.tsx:412`:

```tsx
onClick={() => currentSession && handleStart(currentSession)}
```

With no program there is no `currentSession`, so the expression short-circuits to `undefined`. The
button is not `disabled`, carries no empty state, and gives no hint that a program is the missing
prerequisite. The card body is the session carousel painting a session that does not exist —
`{currentSession?.icon ?? p.emoji}` at `:337`, where `p = getPaletteEntry(currentSession?.position ?? 0)`,
so the 💪 is position-0's palette decoration standing in for absent content. (That is
position-indexed, not a hardcoded session name, so the *No Hardcoded Session Names* rule is not
violated — but it is why the empty state looks like a rendering fault rather than an empty state.)

The comparison that makes this a bug rather than a gap: **`/program` gets it right** for the same
account — *"No programs yet. Create one to get started."* The screen a new user is actually dropped
on has no such affordance, and the one control it offers is inert.

Every other first-run screen was fine (see Clean, below) — this is the single first-run screen that
fails, and it is the worst one to fail.

---

## Q-452 — the AI insight card runs an LLM over a prompt of literal "no data" strings, and tells a day-one user their inactivity is a "significant gap"

**Severity: medium — wrong user-facing copy, and paid LLM calls with no possible signal.**
`[app-shell][platform][readiness][sleep][activity]`

`components/health/ai-insight-card.tsx:44-48` fires `POST /api/ai/health-insight` on every mount,
unconditionally — there is no check that the section has any data to talk about. The route
(`app/api/ai/health-insight/route.ts`) builds its prompt by substituting the literal string
`"no data"` for every absent field (`:102, :105, :116-119, :125-126, :157-158`) and then calls
`generateText` regardless. There is no sufficiency gate anywhere between the mount and the model.

Rendered, as the zero-data account, on its first ever visit:

- `/health/sleep` — *"Your current sleep dashboard is empty, which prevents us from identifying any patterns in your recovery or rest quality. Please ensure your wearable device is charged and pr…"*
- `/health/readiness` — *"Your readiness data is currently unavailable, which prevents me from providing a specific assessment of your recovery status…"*
- `/health/activity` — *"Your activity tracker currently shows **zero movement and no strength sessions** toward your goal of five per week. **This inactivity creates a significant gap** in your ph…"*

The first two are merely wasted calls that narrate their own emptiness. The third is the actual bug:
handed `Steps: no data`, the model does not report absence, it asserts **zero** — and then editorialises
about it. A user on day one, who has done nothing wrong, is told they have a significant fitness gap.
The model cannot distinguish "no data" from "measured zero" because the prompt does not distinguish
them either.

Bounded but not free: `rateLimit('ai-insight:${userId}', 10, 60*60*1000)` at `:64` caps it at 10/hour
per user, and the client caches for 6 h — so the cost is four calls per new user per day, not a
runaway. The copy is the problem, the spend is the aggravation.

Deliberately not filed as a *cost* finding: the six-round review already measured AI spend (~26k
tokens/day) and recorded a decision not to optimise it. This is about correctness of what is said.

---

## Q-453 — `/api/training-stress` silently answers for *today* when handed a malformed date; its ten siblings all reject it

**Severity: low-medium — wrong-day data returned as if correct.** `[platform][readiness]`

The date-param matrix, run live against all 11 date-taking routes:

| Route | `?date=2026-08-14` | `?date=2026/08/14` | `?date=not-a-date` | omitted |
|---|---|---|---|---|
| day-checkin, day-log, day-timeline, mood, nutrition/energy-balance, nutrition/food-logs, nutrition/plan-meal-answers, oura/hr-day, workout-sessions/day | 200 | 200 | **400** | 200 / 400 |
| **training-stress** | 200 | 200 | **200** | 200 |
| oura/hr-window | 400 | 400 | 400 | 400 (takes `start`/`end`, not `date`) |

`app/api/training-stress/route.ts:22`:

```ts
const date = (raw ? normalizeDateParamIso(raw) : null) ?? todayInTz(tz)
```

A malformed `date` normalises to `null` and falls through to *today*. The response carries no echo of
which date it answered for, so a caller that asks for the 10th with a typo gets the 17th's numbers
with nothing to indicate the substitution. Every sibling route treats the same input as a 400.

This is not the `[-/]` separator class from `CLAUDE.md` — **that class is clean** (see below). It is
the adjacent one: a normaliser whose `null` return is read as "use the default" rather than "reject".

---

## Q-454 — two routes validate their params before checking auth, out of 122

**Severity: low — no data leaks; it is the ordering that is wrong.** `[platform]`

Of 122 GET routes called with no session cookie, 120 answer without revealing anything about their
contract. Two answer the *parameter* question first:

- `GET /api/day-log` → `400 {"error":"Missing date"}`
- `GET /api/exercise-history` → `400 {"error":"Missing name"}`

Supply the missing param and both correctly return `401 {"error":"Unauthorized"}` — **verified, no
data is served** (`/api/day-log?date=2026-08-14` and `/api/exercise-history?name=Bench%20Press`, both
401 anonymous). So this is not a hole, it is an inconsistency that makes the auth check not the first
gate, in a codebase whose stated rule is that security checks fail closed and fail first. Cheap to
align; worth aligning before someone adds a param handler above the `auth()` call that does touch the
DB.

Adjacent, same class, filed here rather than separately: `GET /api/push/subscribe` returns
`503 {"error":"Push not configured"}` to an anonymous caller, disclosing deployment configuration
before authentication. (Q-285/Q-286 already record that web push has neither senders nor
subscribers; this is only about the pre-auth answer.)

---

## Q-455 — an unhandled throw in a GET route returns a bodiless 500, not a JSON error

**Severity: low.** `[platform][devices]`

`GET /api/oura-ble/decoder-constants` returned **500 with an empty body** — no JSON, no `error` key —
because `lib/.../constants.ts:62`'s `JSON.parse(fs.readFileSync(...))` threw straight out of
`app/api/oura-ble/decoder-constants/route.ts:29` with nothing catching it.

**The trigger here is environmental and I am not filing it as a product bug**: this sandbox cannot
reach the model-constants bucket (`SignatureDoesNotMatch (403)` at boot, logged by instrumentation),
which is the already-recorded Known Issue *"The bucket download path for the model constants has
never actually run (2026-08-15)"*. In production with working credentials the read succeeds.

What is filed is the **shape**: `CLAUDE.md` requires every route to return a JSON error rather than
throwing, and a client doing `res.json()` on this gets a parse exception on top of the original
fault. The route has a deliberate boot-time check so this becomes a deploy failure rather than a
first-request one — but the first-request path still exists and still answers with nothing.

---

## Clean — four areas checked and found sound

Recorded so the next sweep does not re-cover them.

**1. The date-param separator class is clean.** `CLAUDE.md` documents a dash-only regex having killed
`ai-chat` for a full release because `localDateString()` emits `YYYY/MM/DD`. All 11 date-taking routes
were hit with **both** separators live: **every one accepted both**. No route rejects the slash form.

**2. The unauthenticated surface is clean.** 122 GET routes, no cookie: **114 returned exactly
`401 {"error":"Unauthorized"}`**; 3 `app/api/admin/*` returned 403; `/api/status` and `/api/version`
returned 200 and are deliberately public (version string and `db: up` only); the remaining 3 are
Q-454 above. **No route served user data unauthenticated.**

**3. A zero-data account does not break the API.** All 122 GET routes as a brand-new user, diffed
against the seeded user: **exactly one route differs** —
`/api/ai-periodization/weekly-volume` returns `404 {"error":"No active program"}` where the seeded
user gets 200. That is a clear, correct answer. No 500s attributable to absent data.

**4. The rendered app is free of crashes and console errors.** 30 screens as the seeded user and 21
as the zero-data user: **zero uncaught page errors, zero console errors, zero failing `/api/`
responses, zero "Application error" boundaries** across all 51 renders. The empty states are, with
the single exception of Q-451, genuinely well built — *"No programs yet. Create one to get started."*,
*"Nothing logged on this day."*, *"No running plan yet…"*, *"Still learning your range — wear your
ring or strap for a few more days."*, *"Not enough data"*. Several were near-misses I checked and
cleared: `/session-explain` (64 chars) correctly says *"No explanation is available for this
session."*; `/config` and `/program` both render the program screen (`/config` redirects, by design);
`/stats` redirects to `/health?tab=training`, and `/profile` to `/more`.

## Reproduction

```bash
pnpm db:local && env -u DATABASE_URL -u DATABASE_SSL pnpm dev
# zero-data account:
psql "$DATABASE_URL" -c "insert into users (email,name,password_hash,timezone)
  select 'fresh@local.dev','Fresh User',password_hash,'Australia/Brisbane'
  from users where email='test@local.dev';"
psql "$DATABASE_URL" -c "update users set is_active=true where email='fresh@local.dev';"
```

Q-450, in a browser, is the fastest to see: sign in, go straight to `/activity`, and read the screen.
