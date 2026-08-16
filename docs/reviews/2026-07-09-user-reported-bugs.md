# TrainingAI — User-Reported Bugs (2026-07-09)

Seven issues reported by the user during hands-on use (Samsung S25 Ultra APK), captured as
findings **UB1–UB7**. Each was grounded against `main` @ `6264f16` by reading the code
(file:line cited). **Nothing has been fixed yet** — this doc is the spec source for the
implementation plans / backlog entries that a follow-up planning session will write.

**The through-line the user emphasised is reactiveness — "everything feels laggy."** UB2
(nav delay), UB3 (nav delay's cousin), and UB6 (workout repaint) are all facets of the same
"UI waits on the network / animation instead of painting from local state instantly" class
that CLAUDE.md's *Instant paint* / *Offline-first* rules exist to prevent. Treat the
perceived-latency items as the priority.

> **Verification caveat (read before planning).** The web/dev sandbox does **not** exercise
> the failure surfaces behind most of these: native BLE (UB4/UB5/UB6-live-HR), Capacitor
> deep-links (UB1), safe-area, or Samsung WebView rendering. `getLocalStore` returns null on
> web. Anything touching the ring, the mobile-auth deep link, or on-device paint is
> **unverifiable in-session** and must be checked on the APK per `docs/device-smoke-checklist.md`.

---

## UB1 — On first open, navigating away (e.g. to the admin panel) yanks you back to home

**Symptom (user):** "When I first open the app, if I navigate around and move to say the admin
panel, after a set loading time it brings me back to the home screen — like an initial load
finishes and refreshes back to home."

**Root cause:** the mobile OAuth deep-link handler does an unconditional hard redirect to `/`
after an async token exchange, regardless of where the user has navigated in the meantime.
`components/mobile-auth-handler.tsx:42-68` — on mount (mounted from the root layout
`app/layout.tsx:109`) it reads `App.getLaunchUrl()`; if the app was cold-launched from the
`trainingai://auth-complete` deep link it runs `handleAuthUrl`, which `await`s
`POST /api/auth/exchange-mobile-token` (the "set loading time") and then does
`window.location.href = "/"` with **no check of the current pathname**. If the user has
already navigated to `/admin` (or anywhere) while that fetch is in flight, they are thrown
back to home when it resolves.

**Secondary contributor (non-admin only):** `app/admin/page.tsx:11` server-redirects to `/`
when `isAdminUser` returns false, and `isAdminUser` (`lib/admin.ts:22-27`) does an
authoritative DB round-trip rather than trusting the JWT flag — that await is a visible delay
before the redirect. This only affects non-admin users hitting `/admin`; weaker match than the
deep-link handler but worth noting.

**Ruled out:** the service worker. `components/service-worker-registration.tsx:5-13` is a bare
`register("/sw.js")` with no `updatefound`/`controllerchange`/`reload` logic — no
reload-on-update path exists.

**Fix direction:** gate the `window.location.href = "/"` on the auth flow actually being the
active context — e.g. only redirect if still on the sign-in route, or route via the Next
router and skip the redirect when the user has already navigated. Consider not firing the
launch-URL handler at all once a session already exists. (Deep-link path — **APK-only**, not
reproducible on web.)

---

## UB2 / UB3 — Navigation feels laggy; tab switches don't load instantly

**Symptom (user):** "The app feels a little unresponsive — clicking through navigation tabs
has a small delay, it doesn't load instantly, which makes it feel laggy. Reactiveness is the
big one; everything feels laggy."

**Root cause — two compounding costs on every bottom-nav tap:**

1. **A View Transition animation wraps every tab navigation.** `bottom-nav.tsx:38-48` calls
   `e.preventDefault()` then `navigateWithTransition(...)` (`lib/navigate-with-transition.ts:14-30`),
   which calls `document.startViewTransition(() => router.push(href))`. The `router.push` is
   deferred *inside* the transition callback, so the perceived delay is the directional slide
   animation **plus** the RSC navigation running together. Same path drives edge-swipe
   (`tab-swipe-navigator.tsx:30`).
2. **Each tab is an async server component doing an `auth()` (and sometimes DB) round-trip
   before content renders.** `app/health/page.tsx:8-15` does `await auth()` **and** an extra
   `repo.getUserByEmail()`; `app/page.tsx:7-9`, `app/workout/page.tsx:12-16` all `await auth()`
   server-side on every dynamic render.

**What already mitigates it (so it's "small delay," not blank):** screens seed synchronously
from cache in a `useLayoutEffect` before paint (`session-select-content.tsx:200-348` via
`readCacheSync`/`readTodayCacheSync`), `SyncProvider` pre-mirrors SQLite → sessionStorage
(`components/sync-provider.tsx:93-100`), and tabs use `<Link prefetch>` (`bottom-nav.tsx:69,94`).
So the residual lag is the **transition animation + RSC round-trip**, not data fetching.

**Fix direction (planning should weigh these):**
- Consider committing `router.push` **before/without** blocking on `startViewTransition`, a
  shorter transition duration, or dropping the transition for tab-to-tab moves (keep it for
  deeper pushes) so the new screen paints immediately and animates over it.
- Reduce per-tab server work: the double `auth()` + `getUserByEmail()` on `/health` is a
  candidate to collapse to a single session read.
- Confirm prefetch is actually warming each tab's RSC payload on the APK.

This is the headline "reactiveness" item — UB3 is the same complaint stated generally.

---

## UB4 — Body/Health tab: ring battery and wear time look inaccurate

**Symptom (user):** "In the body/health tab I don't think the ring battery and wear time are
accurate."

**Root cause (battery) — sourced from the Oura *Cloud*, which is frozen post-re-key.** The
battery value comes from `app/api/oura/stats/route.ts:46-52` (`fetchLatestBatteryLevel(token)`,
an Oura Cloud call), displayed in `components/health/oura-section.tsx:120,161-168`. Per
CLAUDE.md's Direct-BLE section, since the Ring 5 was re-keyed to direct BLE (2026-07-07) *"the
Oura Cloud gets no new data from this ring, ever."* So the battery % is effectively frozen at
the last pre-re-key cloud value. **No BLE battery read is wired into this card at all.**

**Root cause (wear time) — the "wornHours partial-day" gotcha.** The "Time Worn" tile computes
`Math.max(0, 86400 - daily.nonWearTimeSec)` (`components/health/oura-section.tsx:123,170-171`).
Today is a **partial day**: `non_wear_time` has only accumulated over the hours elapsed so far,
so `86400 − nonWearTime` counts every not-yet-elapsed hour of the day as "worn," badly
overstating today's wear. This is the exact mistake CLAUDE.md flags ("Cumulative per-day fields
from an external API must treat 'today' as a partial day"). Compounding it, `nonWearTimeSec` is
itself Oura-Cloud-sourced and frozen post-re-key. The "Wear Time" sparkline
(`oura-section.tsx:187-188`, `field="wornHours"`) shares the same partial-day/staleness issue.

**Fix direction:** for battery, wire a BLE battery read (the ring is on our key now) instead of
the dead cloud value, or clearly mark the cloud value as stale/unavailable. For wear time,
clamp "today" to elapsed-seconds-so-far rather than 86,400, and prefer a BLE/local wear signal
over the frozen cloud `non_wear_time`. (Ring data — **APK-only** verification.)

---

## UB5 — Live-workout HR UI needs rework; move "Measure now" to Body/Health

**Symptom (user):** "The live workout HR UI is still really bad. The 'Measure now' button I
want in the body/health section instead — a one-off 'see my HR right now.' Don't need one in
the workout screen. The workout HR should show a minimal display during rest, with **no**
interactive buttons, and show the **last-seen** HR so it doesn't show null while waiting."

**Current state:** the workout screen renders the **full interactive** readout during rest —
`components/workout/live-hr-readout.tsx` has a **Measure** button (`:66-75`, handler
`:33-39` → `measureNow()`), a diagnostics toggle (`:76-86`), and a `DiagnosticsPanel`
(`:94-164`). It's mounted in the workout flow at
`components/workout/active-workout-screen.tsx:649` (rest phase) and
`components/workout/exercise-summary-screen.tsx:116`.

**Null-while-waiting root cause:** `lib/live-hr/use-live-hr.ts:48-49` returns
`bpm: live ? bpm : null`, where `live` is false once a sample is older than `STALE_MS` (8 s);
the readout then renders `'—'` (`live-hr-readout.tsx:49`). Because the ring only surfaces a
newer beat when its ring timestamp advances (`oura-ring-source.ts:96-105`), >8 s gaps are
normal, so the display constantly blanks to `—` instead of holding the last value. The raw
`bpm` state exists — it's the `live ? … : null` gate at `use-live-hr.ts:49` and the `live &&`
gate at `live-hr-readout.tsx:49` that discard it.

**Fix direction:**
- **Workout screen:** strip Measure + diagnostics; render a minimal, non-interactive HR chip
  during rest only. Retain and display the **last-seen** bpm (drop the `live ? … : null`
  blanking; optionally dim/timestamp it when stale rather than showing `—`).
- **Body/Health:** add a one-shot "Measure now" affordance (reuse `measureNow()` from
  `lib/live-hr/manager.ts:41-43` / `oura-ring-source.ts:145-148`) that triggers a live reading
  on demand. Natural home is next to the Oura/HR card in `components/health/oura-section.tsx`.
- The live-HR service (`lib/live-hr/*`) is reused as-is; this is a UI relocation + a display
  rule change. (BLE — **APK-only** verification.)

---

## UB6 — HR monitoring graph is messy (big swings — no averaging over a time window)

**Symptom (user):** "Our HR monitoring graph is very messy now; I'm guessing it's not taking
an average HR over a time period, so it's showing big swings in lows and highs — might need
calibration."

**Root cause:** two HR graphs plot **raw per-sample bpm** with no moving average / bucketing at
any layer:
- **Live workout sparkline** — `components/workout/live-hr-readout.tsx:21-27,56-57` pushes each
  surfaced beat straight into a rolling 40-point buffer and plots it via `<Sparkline>`. No
  smoothing.
- **Done-screen HR-recovery chart** — `components/workout/hr-recovery-chart.tsx:41`
  (`readings.map(r => ({ x, y: r.bpm }))`, rendered `:141`, used from `done-screen.tsx:387`) —
  only cosmetic `tension: 0.3`, underlying points raw.

The BLE source itself does no averaging either: `oura-ring-source.ts:80-106` emits the single
newest beat per drain (`:93` + `decode-live-hr.ts:33-45`), and `decode-live-hr.ts:9-16` returns
a single raw value filtered to 30–220 bpm. A single-beat near-live decode (which can be a
noisy outlier) plotted directly is exactly what produces the high/low swings.

**The fix pattern already exists in the codebase:** `components/health/hr-day-chart.tsx:46-56`
(`toBuckets`) averages into 5-minute buckets — the Oura 24h chart is smooth for this reason.

**Fix direction:** apply an N-second/minute rolling average or time-bucket (copy `toBuckets`)
to the live sparkline and the recovery chart before plotting, rather than plotting raw beats.
Consider light outlier rejection at the decode/source layer. Keep the raw archival samples
untouched (smoothing is display-only). (BLE — **APK-only** verification for the live path;
the recovery chart can be exercised with seeded readings.)

---

## UB7 — Opening/finishing a workout doesn't paint completed exercises immediately

**Symptom (user):** "When opening a workout or finishing a workout, it takes a second or a
reload to show the newly completed exercises — it's not painting as it happens."

**Root cause:** the completed-exercise "done today" state in `PreWorkoutScreen`
(`components/workout/pre-workout-screen.tsx:110-113,206-207`) is `todayLogged.has(ex.name) ||
ex.loggedTodayInSession`, and **both** sources lag on a fresh open:

1. **`todayLogged` is keyed by `programSessionId`, which is `undefined` on first paint.**
   `components/workout-screen.tsx:1075-1079` builds the Set from
   `store.todayLogged[programSessionId ?? sessionType.toLowerCase()]`. Completed exercises are
   written under `programSessionId` (`:859`), but on a fresh open `programSessionId` is
   undefined until `fetchExercises` resolves (`:222/229/248/267`), so the key starts as the
   session-name fallback and the Set is **empty** until the fetch flips the key — a ~1 s flash
   where prior completions are unmarked.
2. **`loggedTodayInSession` is a stale server flag from a 6-hour cache.** It's computed in
   `app/api/workout-data/route.ts:347` and baked into the cached payload; `fetchExercises`
   paints from `readCacheSync`/the `workout-card:<name>` seed first with a **6h TTL**
   (`workout-screen.tsx:205,210,215`). Because `cachedFetch` is stale-while-revalidate
   (`lib/sqlite/cache.ts:185-264`), the screen first paints the **stale** payload where
   `loggedTodayInSession` was false, and only repaints after the network revalidation lands.

**Why "finishing" also lags:** on remount after `mode === "done"` the reset effect wipes the
client Set (`workout-screen.tsx:324-330` → `resetSession()` clears `todayLogged`), so done-state
then relies entirely on the stale server flag until the revalidating fetch repaints.

Note the *logging* path itself is correctly local-first/optimistic
(`workout-screen.tsx:810-826,859`) — it is the **reopen/finish repaint** that depends on the
async `/api/workout-data` revalidation instead of local state. This is a direct instance of
CLAUDE.md's *Instant paint* / *Offline-first* rules.

**Fix direction:** make the reopen/finish paint read completions **local-first** rather than
waiting on the stale server flag — e.g. don't clear/blank `todayLogged` across the
open/finish transition, key it stably (avoid the `undefined` programSessionId window), and/or
derive done-state from the local set-log store instead of the 6h-TTL `loggedTodayInSession`.
Ensure invalidation fires before the repaint callback. (Cross-check both open *and* finish
transitions.)

---

## Suggested priority for the planning session

1. **UB2/UB3 (nav lag)** and **UB7 (workout repaint)** — the "reactiveness" theme the user
   called out as the big one; both are instant-paint / local-first regressions.
2. **UB2's AI-card overflow** is tracked separately below (UB-overflow) — cheap, high-visibility.
3. **UB5 (workout HR UI rework + Measure-now relocation)** — scoped UI change, no service rework.
4. **UB6 (HR smoothing)** — reuse the existing `toBuckets` pattern.
5. **UB4 (battery/wear-time)** and **UB1 (deep-link redirect)** — both need on-device data and
   verification; UB4 may fold into ongoing Oura BLE work (`docs/oura-ble-remaining-work.md`).

---

## UB-overflow (issue 2) — Home AI daily/weekly update card is wider than the screen

**Symptom (user):** "On the daily/weekly AI updates on the home screen, it's actually wider
than the screen, so it allows some horizontal scrolling."

**Root cause:** the AI markdown renderer has no word-break, and the home scroll container has no
`overflow-x` containment. Both AI cards render through `components/ai/response.tsx` (react-markdown
+ remark-gfm + **rehype-katex**). Its root wrapper (`response.tsx:369-374`) sets `w-full` but
**no `break-words`/`overflow-wrap-anywhere`/`min-w-0`**, and there is no CSS taming KaTeX display
math (`.katex-display` doesn't wrap; `app/globals.css` has zero `katex`/`break-word` rules). A
long unbreakable token or a KaTeX display block therefore forces content past the viewport.
Tables (`response.tsx:250`) and code blocks (`code-block.tsx:55`) are already wrapped in
`overflow-x-auto`/`overflow-hidden`, so they are **not** the culprit — it's plain paragraph text.

The overflow escapes to the page because the home scroll container
(`session-select-content.tsx:955`, the `PullToSync` `scrollClassName="flex-1 overflow-y-auto
pb-nav-safe"`, rendered at `pull-to-sync.tsx:190`) has `overflow-y-auto` with default
`overflow-x: visible` → per CSS this computes to `overflow-x: auto`, so the content area itself
scrolls horizontally. `body { overflow-x: hidden }` (`globals.css:303-306`) does **not** catch
it because the scroller is an inner element, not the body. The daily card's bottom sheet
(`day-review-sheet.tsx:56`, `SheetContent` with only `overflow-y-auto`) has the same gap; the
weekly inline card (`weekly-recap-banner.tsx:71`) happens to clip via its own `overflow-hidden`.

**Fix direction:** add `break-words`/`overflow-wrap: anywhere` (and `min-w-0`) to the `Response`
root (`response.tsx:369`) and a `.katex-display { overflow-x: auto }` rule; add
`overflow-x-hidden` to the home scroll container (`session-select-content.tsx:955`) and the
daily `SheetContent` (`day-review-sheet.tsx:56`). The `Response` fix is the root cause (fixes it
everywhere `<Response>` is used); the container `overflow-x-hidden` is the cheap belt-and-braces.
