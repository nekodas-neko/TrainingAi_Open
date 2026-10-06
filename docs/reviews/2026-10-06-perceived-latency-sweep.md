# Perceived-latency sweep — 2026-10-06

Issue #2101 (`OR-163`), built in PR #2431. The owner asked for it: *"Perceived latency is just as
important… find areas to increase latency or perceived latency."* This is the sweep, interaction by
interaction in the order he uses the app, with the three classes kept apart:

- **Class 1:** content that is already painted, hidden by a transition or a visibility toggle.
- **Class 2:** avoidable work on an interaction's critical path. Only the device can time it, so here
  it is a list of candidates for profiling, not findings.
- **Class 3:** a skeleton or loading state on a repeat visit, including the first paint.

A finding here has a before number. Anything without one is listed as a candidate.

## Results at a glance

| # | Interaction | Class 1 | Class 3 | Class 2 candidates (device) |
|---|---|---|---|---|
| 1 | Tab switch | clean — 0 ramps, 10 switches | clean on re-show; **first tap after a cold launch: #2442** | DV-12 / #2117 / #2145 already hold it |
| 2 | Open a workout | clean | **#2441**: 309 / 311 ms in 2 of 3 unprefetched repeat opens | D4 below |
| 3 | Log a set | clean | clean | **D1** below: 7–20 store rewrites per tap |
| 4 | Open Nutrition, add a food | clean | clean | **D2** below: serial awaits before the sheet closes |
| 5 | Open a day | clean | **#2441**: 33–38 ms on 3 of 3 repeat opens | **D4**: 198–844 ms before anything changes |
| — | Back to Home from any pushed route | **#2440, fixed here**: 232 ms → 0 | clean | **D3**: shell remount, 13 `/api` requests |
| 6 | Pull-to-sync | clean | clean | **D6** below |
| 7 | First paint (cold launch) | **#2440, fixed here** (same fade) | **#2443**: Home paints placeholders however warm the cache | **D5**: hydration time |

Filed: **#2440** (fixed in this PR), **#2441**, **#2442**, **#2443**, and **#2444** (a chore seen in
passing, not latency).

## Method

**Harness.** `pnpm dev` (Next 15.5 in dev mode with Turbopack, React in development mode) against a
database rebuilt from migrations plus `scripts/local-db/seed.sql`, signed in as the seed's test
user. The built-in browser was set to 384 × 832, dark. Every number below is from that harness.
**`next dev` timings are not production timings:** renders are slower, chunks compile on demand, and
**Next disables `router.prefetch` in development** (`createPrefetchURL` returns null under
`NODE_ENV=development`), so every navigation measured here is the unprefetched path. Durations are
evidence of a mechanism and of its rough size, not of what the S25 will show.

**The pane produced no frames, and the method is built around that.** The browser pane was not on
screen during the sweep. In that state `requestAnimationFrame` never fires (0 callbacks in 1.2 s),
the document's animation timeline stays at its start (a 1 s WAAPI fade read `currentTime 0` after
500 ms), and `document.startViewTransition` never runs its callback (still pending after 1.5 s). A
screenshot produces a burst of about seven frames and then production stops again. A frame-based
sampler is impossible, so the sweep measured what does not need frames:

1. **A between-task DOM sampler.** A `setTimeout` chain (median 5 ms between samples) recorded each
   sample's visible skeleton elements (`.animate-pulse`, `[data-slot="skeleton"]`, `[aria-busy="true"]`,
   inside the viewport and outside hidden tab panels), every opacity animation on visible content, and
   the active screen's text. **A state the sampler sees is one the browser could paint at its next
   frame; a state that starts and ends inside one task cannot be painted.** That gives class-3
   durations and the moment content mounts.
2. **Class-1 durations come from the animations themselves.** Each opacity animation found on
   visible content had its real keyframes and timing copied onto a paused probe element, which was
   seeked in 2 ms steps to the first opacity ≥ 0.99. These numbers come from the CSS or the animation
   definition, so they carry to the device unchanged.
3. **View transitions were stubbed** (`document.startViewTransition` shadowed) during navigation runs,
   because a pending one blocks the navigation inside it. Their timing is stated from `globals.css`.
4. **First paint was read from the server HTML.** Hydration after a full load waited for a frame in
   this pane: after 8 s with no screenshot, Home still showed the server-rendered placeholders. So
   cold-launch timing was not measured. What the first paint *contains* was measured, by fetching and
   parsing each tab route's HTML.
5. **Class-2 indicators, not timings:** the tap handler's synchronous time including React's flush
   (dev mode, so a pointer only), `Storage.prototype.setItem` calls counted and sized during the
   interaction, and `/api` requests counted with Resource Timing.
6. **Motion (framer-motion) animations run on `requestAnimationFrame`** and could not be timed. They
   are listed under "Candidates the harness could not time".

The sampler and a temporary `<head>` script (to start it before hydration on a full load) were
uncommitted measurement scaffolding, removed before commit. `app/layout.tsx` is byte-identical to
`main`.

## Per interaction

### 1. Tab switch (covered by RV-113, DV-12 and OR-162)
- **All five tabs mounted, Home → Health → Workout → Nutrition → More → Home:** 0 ms of skeleton and
  no opacity animation on the incoming panel, on all 5 switches. `ta-tab-enter` is transform-only,
  so **RV-113's fix holds.**
- **After a pushed-route round trip** (the shell remounts, but the tab modules are already
  resolved): the first activation of each of the 5 tabs showed 0 ms of skeleton.
- **First tap of each tab after a full load:** the chunk pulse showed for Health 676 ms, Workout
  341 ms, Nutrition 405 ms and More 317 ms, although the idle warm-up had fetched every chunk 8–42 s
  earlier. **→ #2442.**
- The tap's long task belongs to DV-12, #2117 and #2145. It was not re-measured here.

### 2. Open a workout
- **Home → Start Workout → `/workout?session=…`.** First open 312 ms of `TabLoading` (4 pulse blocks
  and a bottom nav) after the URL committed at 3.4 s (route compile). Repeat opens: **17, 309 and
  311 ms**; the 17 ms open reused the earlier visit's payload. On the device the *recommended*
  session is prefetched, so this half applies to other sessions and to stale prefetches.
  **→ #2441.**
- Pre-workout → warm-up → "Begin Exercises" → active: 0 skeleton and no opacity animation.

### 3. Log a set
- **Start Set → Log Set:** the UI flipped to the rest ring and "Start Set 2" within **7.6–10.6 ms**
  of the tap (synchronous, dev). The last set flipped to the exercise summary in 9 ms, and
  "Next Exercise" in 23 ms. No skeleton, no opacity animation. The summary's `pr-pulse` badge is new
  content arriving, not painted content being hidden.
- **Class 2:** see D1, the persisted workout store rewritten whole on every tap.

### 4. Open Nutrition and add a food
- Switching to Nutrition was clean, as in row 1.
- **Log Food sheet:** open at 43 ms (synchronous); 0 skeleton. The seed account has no recent foods,
  so the Recent list's own loading state was not exercised.
- **Add a food** (manual entry → assign → Log Food): 0 skeleton, no opacity animation on painted
  content. On the web the sheet stayed open **1.1 s** until the POSTs returned. That is the web-only
  fallback in `logFoodEntries`, not the device path, so it is not a finding. The device path is D2.

### 5. Open a day
- **Health calendar → `/health/day`:** the old screen stays unchanged until the payload arrives
  (never prefetched): **714, 762 and 844 ms** on the three timed repeat opens, and 198 and 526 ms on
  two earlier opens. Then `TabLoading` shows for **50 ms** on the first open
  and **38, 33 and 34 ms** on repeats. **→ #2441**, plus D4 for the wait itself.
- Day content uses `AnimatePresence initial={false}`, so there is no fade on open. The 160 ms
  crossfade runs only on a day swipe, where the content is new.
- Back to Health: 0 skeleton and no opacity animation, 3 of 3.

### Back to Home from any pushed route
- The tab shell renders inside each page, not a layout, so **every return to Home remounts it.**
- **Before:** Home's sections mounted 112–171 ms after the back tap and stayed under 0.99 opacity for
  **232 ms** more, 4 of 4 (`content-fade-in`). **→ #2440, fixed in this PR.**
- The remount re-runs all of Home's reads: **13 `/api` requests**, 2 of 2 measured. They are painted
  from cache first, so this is class 2 (D3), not a skeleton.

### 6. Pull-to-sync
- Home, Health (Training view) and Health (Body view), driven with synthetic touch events and
  screenshot frame bursts: **0 skeleton and no opacity animation** over the whole pull and refresh (a
  10.7 s window on Home). Nutrition has no pull-to-sync.
- The indicator holds for a fixed 1.12 s (120 ms in, a 650 ms hold, 350 ms out), by design. The
  refresh behind it is D6.

### 7. First paint — can a repeat visit show a skeleton?
- **Yes: every cold launch, and on every tab.** The APK cold-launches onto `/`, and the document is
  fetched network-first, so its server HTML is the first paint. For `/` that HTML is Home's empty
  state: "TrainingAI" for the greeting, "?" for the avatar, "Loading…", "— days", "— / 5", and
  "…kg / …Steps / …Calories". Until this PR it was also wrapped in the 250 ms fade from transparent.
  **→ #2443** (placeholders) and **#2440** (fade, fixed).
- `/health` and `/more` server-render 7 pulse blocks; `/workout` and `/nutrition` render 3. The APK
  only lands there on a reload of that URL, but the first *tap* of each tab after a cold launch shows
  the same pulse. **→ #2442.**

## Findings

| Issue | Class | Finding | Before | Status |
|---|---|---|---|---|
| **#2440** | 1 | Home's sections fade in from transparent on every mount | 232 ms under 0.99 opacity after mount, 4 of 4 returns; also on every cold-launch first paint | **Fixed in #2431**: 0 ms, 4 of 4; server HTML no longer carries the class |
| **#2441** | 3 | Pushed full-screen routes show the tab-shaped `TabLoading`, bottom nav included | day 50 → 38 / 33 / 34 ms; workout 312 → 17 / 309 / 311 ms (dev, unprefetched) | Filed, surface |
| **#2442** | 3 | First tap of each tab after a cold launch commits `TabChunkPulse` even with the chunk fetched | Health 676, Workout 341, Nutrition 405, More 317 ms (dev) | Filed, surface |
| **#2443** | 3 | Cold launch paints Home's placeholders however warm the cache | structural: the whole first paint is placeholders; duration is the device's | Filed, surface, `needs: device` |
| #2444 | — | `BodyMuscleCard` is unreachable (not in `TRAINING_ORDER`) | — | Filed as a chore; not latency |

### The fix in this PR (#2440)
`app/session-select/session-select-content.tsx` now adds `content-fade-in` only once the cold-cache
skeleton has actually been shown in that mount (`sectionsReplaceSkeleton`, set in an effect when
`showHomeSkeleton` is true). **After:** 4 of 4 returns to Home mounted the sections with no opacity
animation; a MutationObserver confirmed the sections were inserted without the class and the skeleton
was never inserted. The server HTML for `/` no longer carries the class. **Not exercised:** the path
where the skeleton *does* show. With the app's cache keys cleared, the Home skeleton still never
appeared in the harness, so the branch that keeps the fade was read, not run.

**A harness trap worth knowing:** Turbopack's dev chunk names are not content-hashed, and the
browser's HTTP cache kept serving the pre-edit chunk after the change compiled. The page ran the old
code until every chunk URL was re-fetched with `cache: 'reload'`. A before/after in this harness has
to confirm that the new code is the code running.

## Class 2: device checks needed

None of these was timed. Each is a candidate with the evidence that makes it worth the device's
time.

- **D1 · Log a set: the persisted workout store is serialised whole on every `set()`.** Per tap,
  `ta_workout_state` was rewritten **7 times (5.9 KB)** on a normal Log Set, **13 times (13.2 KB)** on
  the last set of an exercise, and **20 times (24.7 KB)** on Next Exercise. Desktop time was under
  1 ms. On the S25, take `perf.js longtasks` on Log Set and Next Exercise and the self-time of
  `JSON.stringify` and `setItem`. Code: `lib/stores/workout-store.ts` (surface). This is not #2145,
  which covers the cache layer's keys and says none of them is a Zustand store.
- **D2 · Add a food (APK path): the sheet closes after a serial chain of local awaits.**
  `logFoodEntries` in `packages/shared/src/nutrition/log-food.ts` (engine) awaits `resolveLocalEatenAt`,
  `upsertFoodItem`, `queueMutation(food_items)`, `upsertFoodLog`, `queueMutation(food_logs)`,
  `cancelMealReminder` (a native notification call) and `invalidateNutritionWrite` before the toast
  and the close. Time from the Log Food tap to the sheet closing on the S25.
- **D3 · Back to Home from any pushed route remounts the whole shell.** 13 `/api` reads, a full Home
  render, and every other tab's state is dropped. Time from the back tap to Home settling, plus long
  tasks.
- **D4 · Opening a pushed route waits on an unprefetched server round trip.** In dev, the day screen
  committed 198–844 ms after the tap (five opens); a workout without prefetch took 193–533 ms (three
  repeat opens). On the S25, time
  tap → first visible change for `/health/day` and for a non-recommended session, and check whether
  the view transition reaches its 300 ms cap (`lib/view-transition.ts`). At the cap it animates the
  old screen into itself, and the navigation then lands with no transition.
- **D5 · Cold launch: first paint to seeded Home.** That interval is hydration time; it is #2443's
  number. It overlaps #2142 (457 kB of first-load JS) and #2117 row 1.
- **D6 · Pull-to-sync: release → updated values.** Home's handler awaits `pushMutations`, then
  `pullDelta`, then three invalidation groups, then `refetchAll`. The indicator's fixed 1.12 s says
  nothing about when data actually changes.
- **D7 · #2442's real duration:** the chunk pulse on the first tap of each tab after a cold launch,
  on the production build.

## Candidates the harness could not time

These are motion-driven, so their timing needs frames. The numbers are the configured durations,
which is why none of these is filed.

- **More: Profile ⇄ Friends** (`components/ui/tab-panels.tsx`, `mode="wait"`): the outgoing view fades
  out for 150 ms *before* the incoming one mounts, then fades in for 150 ms. Both views re-seed
  synchronously from cache (per the comment in `more-content.tsx`), so the content is ready at the
  tap. The same primitive runs Friends' child views.
- **Workout tab, Start button on a session swipe** (`workout-select-content.tsx:458-474`,
  `mode="wait"`): 150 ms out, then 150 ms in, for a button whose label usually does not change.
- **Route view transitions** (`globals.css`, the M3 shared axis): the incoming screen is at opacity 0
  for the first 50 ms and full at 200 ms. That is a deliberate design, not a defect. It is listed
  because on an unprefetched route the screen it animates in is #2441's skeleton.
- **More's achievements preview** has no `initial={false}` on its `AnimatePresence`, but in the
  harness it mounted at opacity 1. No hold was observed, so it is not filed.

## Ruled out

- **The weather chip's pulse** (17–33 ms on every Home mount here): the sandbox has no saved
  location. On the device it seeds from the last-coordinates cache (`lib/weather/use-weather.ts`).
- **The food log's 1.1 s wait:** the web-only fallback (row 4).
- **A one-off URL change to `/nutrition`** on the first-ever navigation to `/health/day`, during that
  route's dev compile. It did not reproduce in 4 later attempts and is not filed.
- **Taps that a mouse click did not register** ("Know the numbers?" in Log Food): the #2398 shape. A
  DOM `.click()` worked, and it is not counted as latency.
- **`BodyMuscleCard`'s 400 ms fade on mount** would be class 1, but the card is unreachable
  (**#2444**).

## Not exercised

The S25 and the APK; native SQLite and the Capacitor plugins (`getLocalStore` returns null on the
web, so D2's real path never ran); production builds; prefetch (disabled in dev); real frame timing
of any animation; the Home skeleton's cold-cache branch; safe-area insets; production data.
