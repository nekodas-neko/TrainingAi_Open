# App review — information architecture, UI flow, caching, and the standing lenses

**Date:** 2026-08-14 · **Against:** `main` at `4a038e0` (v1.306.x) · **Type:** review, docs-only
**Prompt:** [`2026-08-14-app-ui-flow-ia-review-prompt.md`](2026-08-14-app-ui-flow-ia-review-prompt.md)

Owner's framing: *"a good review on the ui and flow/location mainly … a lot of pages/settings etc
that are just placed randomly (i.e. admin tools, more screen, nutrition buttons) … alongside that
have a look at caching and cache busting … then all the other angles."*

**Verdict on the owner's premise: correct, and narrower than it sounds.** The app's *screens* are
mostly well built. What is disorganised is the **container layer** — five bottom-nav tabs plus a
"More" tab that has absorbed thirteen unrelated kinds of thing, and a set of standalone screens
reachable from exactly one card each. Nothing is missing; a lot of it is unfindable.

**Verdict on caching: the codified rules hold, the uncodified ones don't.** All 33 Custom Rules
steps pass (`Ran 33 of 33`), `invalidateCache()` has **zero** call sites outside
`lib/cache-groups.ts`, 69 of 73 cache keys sit in an invalidation group, and the four that don't are
correctly covered by a prefix. The four caching findings below are all at call sites the mechanised
checks cannot see — one of them leaves a real setting stale for 30 minutes.

---

## 1. What was checked

| Area | How | Verdict |
|---|---|---|
| 39 page routes | reachability grep per route (`href`/`router.push`/`redirect`) | **4 findings** — 1 orphan, 2 shims, 6 single-entry screens |
| 5 tab containers + Admin | contents enumerated and classified by *kind* of item | **5 findings** |
| 73 cache keys / 34 multi-site keys | AST-ish scan of every `cachedFetch`/`cachedFetchToday` call | **4 findings** |
| Invalidation groups | every key ↔ every writer | 69/73 in a group; 4 covered by prefix — clean |
| Cache busting (SW, deploy) | `public/sw-template.js` read end-to-end | clean — see §5 |
| API `Cache-Control` | `node scripts/check-api-no-store.js` | clean — 204 routes, none cache |
| Route auth | every `app/api/**/route.ts` grepped for an auth gate | clean — 5 unauthenticated routes, all legitimately public |
| Admin gating | every `app/api/admin/**` grepped for `requireAdmin` | clean — 0 missing |
| Raw body → Drizzle `.set()` | grep | clean — 0 |
| All repo rules | `pnpm check:rules` | **Ran 33 of 33, all passed** |
| Component size | `node scripts/check-component-size.js` | clean — no new file over 800 lines |
| Theme tokens | hex-literal count under `app/`+`components/` | **regressing** — 471 vs 430 on 2026-08-09 |

**Not checked** (cannot be, here): native SQLite / Capacitor plugin paths (`getLocalStore` returns
null in the sandbox), safe-area insets on device, Samsung WebView rendering, real ring/strap/scale
pairing, drifted production data. Every finding below is from source reading and static analysis;
none was exercised on the S25.

---

## 2. The navigation map

Reachability = number of distinct in-app `href` / `router.push` / `redirect` sites pointing at a
route (excluding the route's own files).

| Entry points | Routes |
|---|---|
| **0** | `/overview` ⚠️ · `/(home)`, `/offline`, `/pending`, `/mobile-signin`, `/auth-mobile-bridge` (system/entry routes) · `/sheet/[id]/{config,overview,workout}` (legacy shims, themselves unreachable) |
| **1** | `/admin` (bottom of the Profile scroll) · `/admin/{cadence,data-capture,oura-ble}` (inside Admin → Tools) · `/baselines` · `/overview`'s only referrer · `/session-explain` · `/stats` · `/year-review` · `/health/{activity,day}` · `/register` · `/coach/confirm/[toolCallId]` |
| **2–3** | `/cardio` · `/running` · `/session-select` · `/health/{heart-rate,readiness,sleep}` · `/nutrition` · `/profile` · `/workout-select` · `/activity/guided-walk` |
| **4+** | `/coach` (4) · `/config` (4) · `/more` (4) · `/activity` (8) · `/workout` (10) · `/health` (18) · `/sign-in` (21) |

Three classes fall out:

- **Orphan.** `/overview` renders `components/overview-screen.tsx` — 543 lines, its own fetches, its
  own cache reads (`workout-card:`, `body-metadata`, `readiness-score`) — and **nothing in the app
  links to it**. Its only referrer is `app/sheet/[id]/overview/page.tsx`, itself unreachable. It is
  a second implementation of the Home screen. → **Q-236**
- **Shims.** `/profile` → `/more`, `/stats` → `/health?tab=training`, `/config` → `/more?tab=workout`,
  `/sheet/[id]/*` → three targets. The first three are load-bearing (external links, Coach handoff
  cards, muscle memory). The `/sheet/[id]/*` trio has zero referrers and can go with `/overview`.
- **Single-entry screens.** `/baselines`, `/year-review`, `/session-explain`, `/health/day`,
  `/admin/*` each hang off exactly one card, usually deep in a scroll. Reachable ≠ findable.

---

## 3. Information architecture — findings

### 3.1 More → Profile is thirteen kinds of thing in one 845-line scroll — **Q-232**

`components/more/profile-tab.tsx` renders, in order:

| # | Section | Kind |
|---|---|---|
| 1 | Avatar, name, title, friend code, level badge, XP bar (`:353-470`) | identity + gamification |
| 2 | `StatsGrid` (`:476`) | content |
| 3 | `TrophyCase` (`:487`) | gamification |
| 4 | `AchievementsSection` (`:490`) | gamification |
| 5 | "Your Year" → `/year-review` (`:500`) | content |
| 6 | Season badges (`:508`) | gamification |
| 7 | `GoalsSection` (`:530`) | settings |
| 8 | `OuraConnectionSection` (`:533`) | device |
| 9 | `ChestStrapPairing` (`:536`) | device |
| 10 | `ScalePairing` (`:539`) | device |
| 11 | `BackgroundLocationCard` (`:542`) | permission |
| 12 | Settings: Preferences (6 switches) · Theme & Appearance · Home Widgets (`:545+`) | settings |
| 13 | About: version · update check · SW status · **APK download** · **Sync now** · **Restore from cloud** · **Export my data** · changelog (`:700+`) | about + data actions |
| 14 | `FeedbackSection` | support |
| 15 | Admin Console entry (`:800`) | admin |
| 16 | Edit Profile · **Sign Out** (`:820+`) | destructive |

No other app puts "Restore from cloud" and "Trophy Case" in the same scroll. The standard shape —
iOS Settings, Android Settings, Strava's "You", Garmin Connect's "More" — is a **short grouped list
of rows, each opening its own screen**.

**Target structure** (each row a real sub-route, so it is deep-linkable, back-navigable, and gets
its own header):

```
More
├─ [avatar header]  Name · Level · friend code        → /more/profile   (identity, edit profile)
├─ Achievements & Stats                                → /more/achievements  (2,3,4,5,6)
├─ Program                                             → /program        (see Q-235)
├─ Devices                                             → /more/devices   (8,9,10,11 + battery, see Q-233)
├─ Goals                                               → /more/goals     (7)
├─ Settings                                            → /more/settings  (12; Notifications · Appearance · Home layout)
├─ Data & Sync                                         → /more/data      (Sync now · Restore · Export · storage)
├─ About                                               → /more/about     (version · update · changelog · APK)
├─ Send Feedback                                       → sheet (14)
├─ Admin                                    admin only → /admin          (15)
└─ Sign Out                                            (16)
```

Cost: no new logic — every section is already an extracted component (`more/*.tsx`,
`profile/*.tsx`), so this is a routing + composition change. It also retires the 845-line file
(currently one of the six recorded size hotspots) without an artificial split, and gives Q-138 one
of its extractions for free.

### 3.2 Four device cards live inline in a profile scroll; there is no Devices screen — **Q-233**

Ring (`OuraConnectionSection`), chest strap (`ChestStrapPairing`), scale (`ScalePairing`) and
background-location permission (`BackgroundLocationCard`) are stacked between "Goals" and
"Settings". Every wearable app has a single **Devices** screen: what is paired, connection state,
battery, last sync, unpair. Today the answer to "is my ring connected and what is its battery?" is
"scroll two-thirds of the way down More → Profile". Cross-reference **Q-111** (Home header battery
chips) — the same information, being solved at the opposite end of the app.

### 3.3 Admin mixes user administration with developer diagnostics, behind a scroll — **Q-234**

`app/admin/admin-content.tsx` has nine tabs (`users`, `invites`, `exercises`, `activities`, `tools`,
`day-review`, `feedback`, `errors`, `ai-usage`), three sub-consoles reachable only from inside Tools
(`/admin/oura-ble`, `/admin/cadence`, `/admin/data-capture` — `:262`, `:273`, `:284`), and a nested
"Additional tools" collapsible inside that. Its only entry point is `profile-tab.tsx:800`, a row at
the bottom of §3.1's scroll — and `app/admin/page.tsx` renders `<BottomNav isAdmin />`, so the
console presents as a peer of the five tabs while being reachable from none of them.

Two different audiences are stacked in one console:

- **User administration** — users, invites, feedback triage. Rare, deliberate, legitimately "admin".
- **Developer diagnostics** — BLE debug, cadence calibration, device data capture, redecode, vacuum,
  HR backfills, time audit, error log, AI usage, model assets, three calibration cards. These are
  *debug tools for the owner's own device*, used far more often than user admin, and they are the
  deepest-buried things in the app.

**Target:** keep `/admin` for user administration. Move device/data diagnostics to
**Settings → Developer** (the standard place — a screen that only appears for an admin/debug flag),
with the three sub-consoles as rows on it rather than buttons inside a tab inside a console.

### 3.4 The Program Builder lives in More under a sub-tab named "Workout" — **Q-235**

`app/more/more-content.tsx:150` renders three segmented tabs — `profile | friends | workout` — and
the third mounts `components/config-screen.tsx` (997 lines, the Program Builder).
`app/config/page.tsx` redirects `/config` → `/more?tab=workout`.

So the app has a bottom-nav tab called **Workout** (`/workout-select`, what you train today) and,
inside **More**, a second tab also called **Workout** (how your program is structured). Q-223
already had to fix a link that broke on this exact ambiguity. Program structure is the most
workout-central configuration surface in the app and it is two containers away from the Workout tab.

**Target:** a `/program` route reachable from the Workout tab (and from More → Program), with
`/config` and `/more?tab=workout` kept as redirects for the Coach handoff card
(`components/coach/handoff-card.tsx:15`) and the recommendation card
(`app/session-select/components/recommendation-card.tsx:197`).

### 3.5 `/overview` — a 543-line screen nobody can reach — **Q-236**

See §2. Decide deliberately: delete `app/overview/`, `components/overview-screen.tsx` and the three
`app/sheet/[id]/*` shims, or give it an entry point. Leaving it is the worst option — it is a second
Home screen that will drift from the real one, and it holds live cache reads that make it look
maintained.

### 3.6 Nutrition's actions are placed by scroll depth, not by grouping — **Q-237**

`app/nutrition/nutrition-content.tsx`, top to bottom: a **gear icon** in the header opening a
"Nutrition Settings" sheet (`:518`, `:725`) · calorie balance · macro ring · meal-plan cards ·
a **Water** button mid-scroll (`:612`) · TDEE card · every meal card · then a 2-column grid of
**Saved Meals** and **End of Day** (`:651`, `:659`) *below all the meals* · weekly chart ·
supplements.

Three problems, in order of how much they cost:

1. **"End of Day" is a daily-review feature living in Nutrition**, behind a moon icon, below the
   fold. Its sibling ("Your Day in Review") is a Home banner. Already recognised as **Q-112** —
   this review adds the *placement* argument to that entry rather than re-raising it.
2. **Water is a nutrition concept with three entry points** — Home (`session-select-content.tsx:1427`),
   Health (`health-content.tsx:882`) and Nutrition (`:679`) each mount their own `WaterLogSheet`.
   Convenient, but see **Q-243**: the three mounts do not behave the same after the write.
3. **"Saved Meals" is a library, not an action**, and it is only reachable after scrolling past
   every meal. It belongs next to the logger, or in the header alongside the gear.

**Target:** one persistent action affordance (header actions or a compact row directly under the
macro ring) holding Log Food · Water · Saved Meals; End of Day moves to the daily review per Q-112;
the gear stays where it is (that part matches convention).

### 3.7 Health card ordering is read-only — the writers have no callers — **Q-238**

`lib/health-card-order.ts` exports `saveHealthCardOrder` (`:47`) and `saveHiddenHealthCards`
(`:60`). **Neither has a caller outside `lib/__tests__/health-card-order.test.ts`.** The readers are
live: `app/health/health-content.tsx:195-199` seeds `bodyOrder`, `trainingOrder`, `progressOrder`
and `hiddenCards` from them on every mount, and `health-sections.tsx` branches on `hiddenCards` in
six places.

So the Health tab has a complete card-customisation *mechanism* — three order keys, a hidden set, a
one-time-reset migration (`:17-30`), passing tests — and **no UI can change any of it**. Meanwhile
Home *does* have a customiser (`components/more/home-widgets-section.tsx`, 347 lines, in
More → Settings → Home Widgets) and the Home tab has an in-place edit mode
(`session-select-content.tsx:697`). Same shape as **Q-180** (`getOuraTimeseriesDelta`: no callers,
passing tests).

Either build the Health customiser to match Home's, or delete the dead half. Do not leave it: it
reads as a shipped feature in every grep.

### 3.8 Six screens hang off exactly one card each — **Q-239**

`/baselines` (only `components/fitness-tests/latest-baseline-card.tsx:39`), `/year-review` (only
`profile-tab.tsx:501`), `/session-explain` (only `recommendation-card.tsx:173`), `/health/day` (only
`health-content.tsx:550`), and the `/admin/*` trio. `/running` is three taps deep — Workout tab →
Cardio card (`workout-select-content.tsx:440`) → modality picker (`modality-picker.tsx:78`) →
running plan.

Each is individually defensible; together they are the shape of the owner's complaint. The
deliverable here is a decision per screen — promote to a real destination, or accept it as a
detail view of the card that owns it — not a refactor.

---

## 4. Caching and cache busting — findings

### 4.1 What is healthy (measured, not assumed)

- **Zero** `invalidateCache()` call sites outside `lib/cache-groups.ts` — the hand-rolled-key-list
  bug class that shipped #1279 is genuinely gone.
- **73 distinct cache keys**, 34 fetched at ≥2 sites. Every key is reachable from an invalidation
  group; the four that are not named literally (`friends-list`, `friends-feed`,
  `more-seasons`, `year-review`) are either covered by the `friends-` prefix
  (`cache-groups.ts:317`) or are annual/seasonal payloads where a TTL is the right answer.
- **One fetch variant per key** — the scan found no key fetched as both `cachedFetch` and
  `cachedFetchToday`.
- **Today-payload guards are consistent**: all four `body-metadata` read sites gate on
  `isBodyMetadataFresh` (`health-content.tsx:226`, `session-select-content.tsx:514`,
  `nutrition-content.tsx:140`, `:326`), covering both the seed path and the `onData` hit path.
- **API responses stay out of the browser HTTP cache**: `check-api-no-store` passes over 204 route
  files, and the client bypass is intact on both sides (`cachedFetch` sends `cache: "no-store"`;
  `public/sw-template.js:127-128` re-fetches every `/api/` request with `cache: "no-store"`).
- **Cache busting across deploys is sound.** The SW cache name is build-stamped, `activate` retains
  exactly the current and previous generation (`sw-template.js:18-37`) and `matchLiveCaches`
  (`:71-82`) refuses to serve a document from any older generation — which is the specific failure
  that makes a deployed build hand a client chunks that no longer exist. No finding here.

### 4.2 Editing a goal never busts the goal cache — **Q-240** 🟠

`components/profile/goals-section.tsx:177-186`:

```ts
function patchGoalsDebounced(partial: Record<string, unknown>) {
  …setTimeout(() => {
    fetch('/api/user/goals', { method: 'PATCH', … }).catch(() => {})
  }, 1000)
}
```

No invalidation. Its sibling `patchProfile` (`:123-140`) — same file, same screen — does call
`invalidateGoalRecommendations()`, and **that group already contains
`invalidateCache('user-goals')`** (`lib/cache-groups.ts:176`). So the group is right and the call
site was never wired to it.

`user-goals` is fetched by the Health tab at `TTL_MEDIUM` (30 min) — `health-content.tsx:454` — and
seeded synchronously from cache at `:242`.

**User-visible consequence:** change your steps, sleep, calorie, water, target-weight or target-BF
goal in More → Profile → Goals, switch to the Health tab, and its goal-driven cards keep rendering
against the **previous** goal for up to 30 minutes. On the next cold start the stale seed paints
first. The seven handlers affected are `handleStepsGoalChange`, `handleStepsGoalTypeChange`,
`handleSleepGoalChange`, `handleCalorieGoalChange`, `handleCalorieGoalTypeChange`,
`handleWaterGoalChange`, `handleWaterGoalTypeChange`, `handleTargetWeightChange`,
`handleTargetBfChange` (`:192-235`).

**Fix:** `await invalidateGoalRecommendations()` after the PATCH resolves, exactly as `patchProfile`
does. One line.

### 4.3 Goals have two sources of truth, and the Health tab reads the device-local one — **Q-241** 🟠

Every handler in §4.2 writes the value **twice**: to `localStorage` *and* to the server.

```ts
localStorage.setItem('ta_steps_goal', value)        // goals-section.tsx:194
patchGoalsDebounced({ stepsGoal: n })               // :196
```

And `app/health/health-content.tsx:202-214` reads three of them back from `localStorage` **only** —
water goal (default 2500), target weight, target body-fat — while reading the rest from the server's
`user-goals` payload (`:242`). `components/profile/goal-recommendation-sheet.tsx:125-126` writes the
localStorage copy too, after applying an AI recommendation.

**User-visible consequence:** the localStorage copy is device-local and never syncs. On a second
device, a re-install, a browser-data clear, or the web surface vs the APK, the server holds the
user's real goals while the Health tab shows defaults — and the two copies can disagree
indefinitely with nothing to reconcile them. This is squarely against the CLAUDE.md *Canonical
Runtime* amendment ("no user-visible surface should assume the owner's own device") and the
offline-first rule that the *local store* — not `localStorage` — is the local source of truth.

**Fix:** server payload is the source; hydrate `localStorage` from it on read as a synchronous seed,
never the other way round.

### 4.4 Logging water invalidates a different set of caches depending on which tab you were on — **Q-243** 🟢

`components/profile/water-log-sheet.tsx` already invalidates correctly on **both** write paths —
local (`:77`) and API fallback (`:98`) — via `invalidateBodyMetricWrite()`. The three call sites then
each add their own, differently:

| Mount | `onLogged` |
|---|---|
| Home — `session-select-content.tsx:1427` | `invalidateBodyMetricWrite(); invalidateReadinessInputs(); fetchMeta()` |
| Health — `health-content.tsx:882` | `invalidateBodyMetricWrite(); fetchMeta()` |
| Nutrition — `nutrition-content.tsx:679` | `setTodayWaterMl(v => (v ?? 0) + ml)` |

Nothing is *stale* here — the sheet covers it. The cost is the other direction: **Home's extra
`invalidateReadinessInputs()` drops `readiness-score`, `weekly-stats`, `progress-summary`,
`muscle-recovery` and `body-battery`** (`cache-groups.ts:114-123`) after a water log — and water
feeds none of them (no reference to `waterMl`/`water_ml` exists anywhere under the readiness or
body-battery paths). So logging water on Home makes five instant-paint cards refetch for nothing,
against the rule that a repeat visit must not flash a skeleton.

**Fix:** delete the redundant invalidation from all three call sites and let the sheet own it —
which is the mutation-callback contract the rulebook already states.

### 4.5 One key still has two TTL expressions — **Q-242** 🟢

`day-log:${date}` is fetched with a literal `TTL_MEDIUM` at `app/health/health-content.tsx:539` and
with `DAY_LOG_TTL` at `app/session-select/components/week-day-sheet.tsx:34`. The values are equal
today (`DAY_LOG_TTL = TTL_MEDIUM`, `packages/shared/src/cache-ttl.ts:38`) so nothing is broken — but
that constant was created *specifically* so the two sites could not drift, and its own comment says
so. One site was never converted. A future change to `DAY_LOG_TTL` reaches one caller.

---

## 5. Security, performance, UI — the standing lenses

**Security: nothing new found, by the checks available here.** Every `app/api/**/route.ts` has an
auth gate except five that are legitimately public (`auth/[...nextauth]`, `auth/register`,
`auth/exchange-mobile-token`, `version`, `status` — the last rate-limited at 30/min/IP and leaking
no connection detail). Every `app/api/admin/**` route calls `requireAdmin`. No raw request body
reaches a Drizzle `.set()`. This lens was swept in depth on 2026-08-07 and again adversarially on
2026-08-08; this pass adds no findings and should not be read as a fresh deep audit.

**Performance: no new findings.** `check-component-size` is clean (no new file over 800 lines; the
six recorded hotspots are unchanged). Instant-paint seeding is present on the tab screens and their
today-guards are consistent (§4.1). §3.1's split would remove the largest hotspot as a side effect.

**UI: one measurable regression.** Hex literals under `app/`+`components/` `.tsx`: **471**, against
430 measured 2026-08-09 and 455 on 2026-08-07. CLAUDE.md records this as trending down; it is
trending **up** — +41 in five days. The rule ("new UI uses tokens") is not mechanised, unlike
component size and `color-mix` hue, both of which have shrink-only CI baselines. → **Q-244**

(One measurement discrepancy worth recording rather than acting on: CLAUDE.md's "9 hand-rolled
chevron toggles ship no `aria-expanded`" does not reproduce with a file-level scan for
`ChevronDown` + `rotate-180` outside a `CollapsibleTrigger`, which finds one —
`components/health/day-overlay-sheet.tsx`. The two counts use different methods; the CLAUDE.md
figure was per-site, this one per-file. Not a finding either way, but the next person to re-count
should know why the numbers disagree.)

---

## 6. Findings index

| Q | Severity | Domain | Finding |
|---|---|---|---|
| Q-240 | 🟠 stale UI | platform, app-shell | Editing a goal never invalidates `user-goals` — Health shows the old goal for 30 min |
| Q-241 | 🟠 wrong data | platform, body | Goals dual-written to `localStorage` + server; Health reads three from `localStorage` only |
| Q-232 | 🟠 IA | app-shell | More → Profile is 13 kinds of thing in one 845-line scroll |
| Q-234 | 🟠 IA | app-shell, platform | Admin mixes user admin with developer diagnostics, behind that scroll |
| Q-235 | 🟠 IA | app-shell, workouts | Program Builder lives in More → "Workout", colliding with the Workout tab |
| Q-233 | 🟡 IA | devices, app-shell | Four device cards inline in a profile scroll; no Devices screen |
| Q-237 | 🟡 IA | nutrition, app-shell | Nutrition actions placed by scroll depth, not grouping |
| Q-238 | 🟡 dead code | app-shell | Health card order/hide is read-only — writers have no callers |
| Q-236 | 🟡 dead code | app-shell | `/overview` — 543-line screen with zero entry points |
| Q-239 | 🟢 IA | app-shell | Six screens reachable from exactly one card each |
| Q-243 | 🟢 perf | app-shell | Water log over-invalidates from Home; three divergent call sites |
| Q-242 | 🟢 hygiene | platform | `day-log:` fetched with `TTL_MEDIUM` at one site, `DAY_LOG_TTL` at the other |
| Q-244 | 🟢 hygiene | app-shell | Hex literals 430 → 471 in five days; nothing mechanises the token rule |

**Cross-references, deliberately not re-raised:** Q-112 (Day in Review + End of Day merge — §3.6
adds the placement argument to it), Q-111 (Home battery chips — §3.2 is the other half of the same
question), Q-138 (component-size extractions — §3.1 supplies one), Q-154 (sparkline primitive),
Q-180 (dead code with passing tests — §3.7 is the same shape).

---

## 7. Addendum — what is actually gating the owner, and what would close it

Added 2026-08-14 after the review, at the owner's question: *"is there any other form of access I
could give to the agents for better testing … we gave the Railway API key over and it allowed for
much better triage. I want more like that."* This section is the measurement behind the Q-249…Q-254
cluster in the backlog.

### 7.1 The 81 rows are five different gates

`grep -cE '^### .*(NOT verified on device|NOT device-verified)' projectOverview.md` → **81**.
Bucketed by what each row actually needs:

| Waiting on | Rows | Closed by |
|---|---|---|
| Nothing but somebody running the app | **~25** | Browser E2E — needs no new access (**Q-249**) |
| An Android runtime (local SQLite, offline, notifications, back button, deep links, PiP) | **17** | Emulator in CI (**Q-250**) |
| Real data (a real night, real HR, the owner's live program, real zone data) | **~10** | Staging + scrubbed prod-shaped snapshot (**Q-251**) |
| Real hardware (BLE ring/strap/scale, GPS, safe-area, Samsung paint) | **25** | Mostly nothing — see §7.3 (**Q-253** covers a minority) |
| Perceived performance ("does it feel fast") | ~4 | The owner's own device |

**Method, stated so it can be checked:** the split is keyword bucketing over the 81 headings
(hardware terms → hardware; SQLite/offline/notification/back-button/deep-link/PiP → Android; the
rest → app-logic), then a manual pass moving the data-gated rows out of the app bucket. It is
directionally sound and **not** authoritative per row. Q-254 re-tags them properly.

### 7.2 The largest bucket needs no new access at all

There are **466 test files and none of them runs the app.** Chromium and Playwright's browsers are
installed in every session (`/opt/pw-browsers`, with `PLAYWRIGHT_BROWSERS_PATH` pre-set), Postgres
is seeded locally, `pnpm dev` runs — and Playwright is not a dependency, so there is no harness and
no `e2e/` directory.

The consequence is visible in the rows themselves. "Bodyweight sets no longer count as zero volume",
"Injury workout warning", "Rest timer on the All sets done! screen" — none of those need Android.
They were marked unverified because the rule says device-verify and **no session had a way to verify
anything at runtime**, so the honest fallback was to write the row and move on. The rule worked as
designed; it had no cheaper tier beneath it. Some of these rows are more than a hundred versions
old and the code beneath them has been rewritten since.

Two data points from this repo's own history that this is not theoretical: the 2026-08-08 entry
*"The first review to RUN the app"* found two live bugs source-reading had repeatedly missed, and
Q-226 shipped a week ago conceding *"this rests on reading the source, not on observing the fix
work"*.

### 7.3 What no amount of access buys

Roughly **15–18 of the 25 hardware rows are BLE** — the Ring 5 on our own re-keyed protocol, the
Polar H10, the Renpho scale. No emulator and no device farm produces those. Real safe-area insets on
the S25, Samsung's own WebView compositor, and real push delivery are the same. **The device gate in
`CLAUDE.md` should keep saying exactly what it says today** — this cluster shrinks what falls under
it, it does not remove it.

Separately, a set of ⛔ items are not testing-gated at all: Q-72, Q-4, Q-3b, the Q-49/Q-50 deletion
calls and the P-F P3 go/no-go want an owner **decision**. No infrastructure moves them, and counting
them with the device queue makes both look larger than they are.

### 7.4 Sandbox limits, verified rather than assumed

- **No Android emulator here, ever.** `/dev/kvm` does not exist; `/proc/cpuinfo` reports neither
  `vmx` nor `svm`. The sandbox is a Firecracker microVM (`Linux 6.18.5-fc-v20`), so nested
  virtualisation is unavailable. GitHub's `ubuntu-latest` runners do expose KVM — that is where
  Q-250 has to live.
- **Chromium is present and usable** (`/opt/pw-browsers/chromium`), which is what makes Q-249 free.
- **`getLocalStore` returns null outside the APK**, so a browser harness proves the *web* fallback
  branch and never the device branch. Q-249's harness must say so in its own README, or it will be
  over-trusted in exactly the way "works locally" has been.
