# Full-app deep review — saving · caching · performance · logic

**Date:** 2026-08-07 · **Base:** `main` @ `891ffc8` (v1.267.15) · **Type:** review/planning, docs-only
**Prompt:** [`2026-08-07-full-app-review-prompt.md`](2026-08-07-full-app-review-prompt.md)
**Prior comparable sweep:** [`2026-07-20-wiring-caching-perf-audit.md`](2026-07-20-wiring-caching-perf-audit.md)

**Scope:** 201 API routes, 40 page routes, ~182k lines TS/TSX, 169 Postgres migrations, local SQLite
v21. Eight lenses run as parallel sweeps, plus two production passes (`error_events`, and 91 days of
`/api/admin/day-review`).

**Verification key used throughout:** **[V]** = verified in source by the review author during
synthesis. **[S]** = single-sweep claim, not independently re-checked.

---

## Coverage ledger

All 201 routes were enumerated and grouped. Every group was reached.

| pillar | routes | called | admin-only | external | dead |
|---|---|---|---|---|---|
| sleep | 5 | 4 | 1 | 0 | 0 |
| readiness | 7 | 5 | 1 | 0 | 1 |
| heart-rate | 11 | 9 | 2 | 0 | 0 |
| cardio | 10 | 10 | 0 | 0 | 0 |
| activity | 4 | 3 | 1 | 0 | 0 |
| workouts | 62 | 52 | 8 | 0 | 2 |
| nutrition | 20 | 20 | 0 | 0 | 0 |
| body | 6 | 6 | 0 | 0 | 0 |
| devices | 32 | 24 | 1 | 5 | 2 |
| app-shell | 16 | 16 | 0 | 0 | 0 |
| platform | 28 | 16 | 7 | 3 | 2 |
| **total** | **201** | **165** | **21** | **8** | **7** |

Subtracting the 13 routes reachable only through the BLE debug consoles at `/admin/oura-ble`, the
"reachable by a normal user" count is **152**.

---

## 1. Production reads (ran before any code was read)

### 1.1 `error_events`, 30 days

| signature | hits | latest | status |
|---|---|---|---|
| React #418 `args[]=text` on `/` | 138 (35 in last 8d) | 2026-08-06 | **root cause found, §2.1** |
| React #418 `args[]=HTML` | 116 | 2026-07-14 | stopped — different, fixed bug |
| `Failed query` (sync/pull, readiness-score, body-battery, complete-workout, log-exercise) | ~50 | 2026-08-06 | **§2.9** |
| `/api/complete-workout#hr-sync` "fetch failed" | 9 (5 in last 8d) | 2026-08-06 | **§3.5** |
| `SpeechRecognition not implemented on android` | 3 | 2026-08-06 | APK never installed, §5 |
| `oura-ble/samples#aggregate` failed query | 19 | 2026-07-28 | stopped, unexplained |
| `Cannot read properties of null (reading 'x')` | 20 | 2026-07-12 | stopped, unexplained |
| `.reduce is not a function` on `/workout` | 10 | 2026-07-21 | stopped, unexplained |

The three "stopped, unexplained" signatures are recorded as such deliberately — *something that
stopped is not something that was fixed*, and `error_events` prunes at 30 days.

### 1.2 Write-path liveness

No 100%-null column found in the tables checked. `sleep_sessions.onset_latency_sec` is now **23%**
null (historically 100%) — that bug is genuinely fixed. Referential integrity clean: zero orphans
across `set_logs`, `food_logs`, `set_hr_stats`. No duplicate-row classes.

**Checked and explained — not faults:**
- `daily_zone_minutes` last written 2026-07-23 — it is a reconcile-on-read cache; staleness is correct.
- `oura_workouts` stopped 2026-07-05 — Oura Cloud gets no data since the BLE re-key, by design.
- Duplicate `day_checkins` on 3 dates — `morning`/`evening` phases, by design.
- Duplicate `sleep_sessions` per day — naps, by design.
- `heartRate` pillar scoring `null` — the pillar declares `"no weighted model"` and reports
  measurement-vs-baseline instead.

**Open question for the owner** (recorded, not diagnosed): `supplement_logs` (1 row ever, none since
2026-06-21), `food_logs` (none since 2026-07-26), `step_live_windows` (2026-07-28),
`oura_accel_chunks` (2026-07-15) have all gone quiet. §3.7 gives a plausible mechanism for the
supplements case; the others need owner input to separate "stopped logging" from "broken".

---

## 2. Findings — Tier 1 (user-visible, fix first)

### 2.1 Home-screen hydration error — root cause **[V]**
`app/session-select/session-select-content.tsx:1063`
```tsx
{new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
```
No `timeZone` — the pattern CLAUDE.md's Timezone section bans by name. Railway sets no `TZ`
(checked `nixpacks.toml`, `next.config.ts`, `package.json`), so Node renders UTC while the S25
renders `Australia/Brisbane`. Between 00:00 and 10:00 AEST — **42% of every day** — the server sends
yesterday's weekday+date and the client renders today's. Reproduced:

```
server (UTC)  : Thursday 6 August
client (S25)  : Friday 7 August
```

Every recorded fact fits: *text* mismatch not attribute; home-only (this string exists nowhere else);
never reproducible locally because the sandbox runs server and browser in one timezone.

**Corrects a false premise in Q-73 and `projectOverview.md`:** both state that `/` mounts all five
tabs so any tab's mismatch surfaces there. `components/shell/tab-shell.tsx:57-61` initialises
`mounted: [initialTab]`; the other four mount on first activation, which is client-only and cannot
hydrate. The search space was always the home tab. That premise is what produced two dead ends.

**Fix:** `formatInTimeZone(new Date(), tz, 'EEEE d MMMM')`, matching the `todayInTz()` used four
lines away. **Latent sibling:** `:92-96` `getGreeting` reads `new Date().getHours()` (device-local);
does not mismatch today because it is gated behind a null-on-both-sides `displayName`.

### 2.2 Confirming an early deload changes nothing on screen for 6 hours **[V]**
`handleEarlyDeloadConfirm` (`session-select-content.tsx:881-883`) only calls `setReadiness`.
`components/home/early-deload-card.tsx` imports no cache group. The server effect is real
(`programs.ts:673-689` → `phase-engine.ts:111-117` → `workout-data/route.ts:247`), but
`workout-data:all` is read with `freshWithinTtl: true` at `TTL_LONG` — so **no network request is
made at all**. Session cards, the Recommended-Today card and workout-select keep showing
full-intensity weights for up to 6 h. The in-code invalidation-proof comment at `:572-577` claims
every writer is covered; `/api/confirm-early-deload` is the counter-example.

### 2.3 Logging an injury never reaches today's plan **[S]**
Two independent gaps. Client: `invalidateInjuryWrites()` (`cache-groups.ts:201-203`) clears only
`injuries`, so the same `freshWithinTtl` short-circuit applies. Server:
`workout-data/route.ts:434-435` skips re-derivation via
`reevaluationKey(todayStr, moodLog, morningCheckin)` (`reevaluate.ts:38-54`) — which **does not
include injuries**, so even a forced refetch returns the pre-injury prescription.

### 2.4 Navless takeover action rows sit on the gesture bar **[V]**
`components/activity/activity-screen.tsx:13` renders `RunActiveScreen` or `ActiveActivityScreen`
from one ternary — same parent, same navless page. `run-active-screen.tsx:166` uses
`pb-safe-action-lg`; `active-activity-screen.tsx:90` uses `pb-safe-action`. Six more sites:
`fitness-tests/test-active.tsx:90,102`, `guided-walk/walk-active.tsx:155`,
`guided-walk/walk-config.tsx:116`, `guided-walk/walk-summary.tsx:218`,
`activity/done-activity-screen.tsx:312`. The `-lg` sweep was scoped to workout screens only.
Invisible in the sandbox (insets render 0).

### 2.5 Light mode's brand-colour fix has been dead since it was written **[V]**
`globals.css:55` sets `--brand: oklch(0.55 0.22 149)` — "darkened for light-mode text readability" —
but never sets `--color-brand`, which stays at the `@theme` default (`:7`), **identical to `.dark`
(`:148`)**. Measured: `var(--brand)` has **2** consumers; `text-brand`/`bg-brand`/`var(--color-brand)`
have **495**. Every `[data-brand=…]` pair (`:199/200`, `:206/207`) correctly sets both — only the
default green is broken.

### 2.6 `bg-brand text-white` with no `--brand-foreground` token **[S]**
42 sites, against 9 that do the opposite with `color:'#000'`. `.dark[data-brand="blue"]` is
`oklch(0.84 0.15 210)`; white on it is ~1.3:1. `theme-color-picker.tsx:38-39` pins every custom hue
at `oklch(0.7 0.2 h)`, light enough that white-on-brand fails for every hue.

### 2.7 Weekly muscle volume splits one muscle into two rows **[V]**
`volume-targets.ts:76-79` writes **normalised** names (`normalizeMuscle`: `core→abs`,
`quadriceps→quads`, …). `weekly-muscle-sets/route.ts:88,92` and `weekly-volume/route.ts:31,39` key
logged sets by the **raw** library label via `LOWER()`/`.toLowerCase()`. The seeded library ships
`"core"` (14 rows in migration 081), so this fires on stock data. Result: `Abs 0/16` in red beside
`Core 12` with no target — and `muscle-heatmap.tsx:48` normalises, so the heatmap disagrees with the
list in the same card. `signals.ts:386-400` does it correctly and comments on the hazard, so the AI
engine and the UI now disagree about the same metric.

### 2.8 Active workout screen re-renders up to 2×/second, all workout long **[S]**
`active-workout-screen.tsx:101-102` calls `useElapsedSec` twice at the top of a 762-line screen. The
file's own comments (`:186`, `:202`) show the tick is known; the mitigations memoise children while
~700 lines of the screen's own JSX reconcile every second for 45–90 minutes.

### 2.9 Pool starvation is app-wide, and the error reporter hides why **[V]**
`getSyncDelta` fires **22** parallel queries in one `Promise.all` (`adapter.ts:3246-3249`, 22
destructured results — Q-107 records 21) against a pool with `max: 10`,
`connectionTimeoutMillis: 5_000` (`client.ts:20-24`). The failing tables are a random assortment —
the signature of starvation, not a per-table bug. **It is not sync-specific:**
`/api/readiness-score` (2026-08-06) and `/api/body-battery` (2026-08-05) show the identical
signature.

Why it stayed undiagnosed: `lib/observability.ts:9-10` captures `err.message` and `err.stack` but
**not `err.cause`** — and `DrizzleQueryError` puts the real Postgres error (with `code`, `severity`,
`detail`) exactly there (`node_modules/drizzle-orm/errors.js:41`).

---

## 3. Findings — Tier 2

| # | finding | evidence |
|---|---|---|
| 3.1 | Offline-completed workout never gets HR attribution — the web route fires hr-sync **and** an inline attribution pass; the `pushMutations` branch fires only hr-sync. Regression of the Q-11 fix, which landed web-only. **[S]** | `adapter.ts:3909-3927` vs `complete-workout/route.ts:37-72` |
| 3.2 | Auto-detected walk/run review saves server-only — no local write, no outbox; cannot save offline. Both sibling surfaces do local+outbox. **[V]** | `exercise-review-sheet.tsx:99-122` (zero `getLocalStore`/`queueMutation`) |
| 3.3 | **Same file writes a device-local date key to the DB.** Outside Brisbane the activity is filed under the wrong calendar day — persisted, not just displayed. Found during synthesis, not by a sweep. **[V]** | `exercise-review-sheet.tsx:104` (`getFullYear()/getMonth()/getDate()`); display half at `:205` |
| 3.4 | Cross-user phase-set leak: `phaseSetId` written from the body unchecked, then `listProgramPhases` reads it **unscoped**; `deletePhaseSet`'s in-use probe also unscoped, disclosing another user's program name. **[V]** | `programs.ts:172,186` · `:389` · `:535-539`; correct pattern at `phase-sets/[id]:20-37` |
| 3.5 | Three fire-and-forget HTTP calls to the app's own origin, forwarding cookies. `"fetch failed"` 5× in 8 days. **[V]** | `complete-workout:39`, `workout-data:503,527`; `hr-sync` is 39 lines, trivially extractable |
| 3.6 | `supplements` is the only write domain with no pull-clobber guard — the local table has no `sync_status`/`deleted_at`, so `applyDelta` overwrites unconditionally. **[V]** | `sqlite/migrations.ts:575-584` → `sqlite-backend.ts:1736-1738`, `:2262-2279` |
| 3.7 | `supplements` fetched with **both** cache variants — same key, adjacent branches, incompatible envelopes → section renders empty. Only variant mismatch in the codebase. Plausible mechanism for the near-empty `supplement_logs` table. **[V]** | `nutrition-content.tsx:348` (`cachedFetchToday`) vs `:354` (`cachedFetch`) |
| 3.8 | chart.js in the Health chunk through a defeated dynamic import — correct `dynamic()` bypassed by a static chain. ~208 KB on every cold start. **[S]** | `health-content.tsx:34-37` defeated via `health-sections:13` → `activity-history-card:7` → `activity-detail-sheet:11-13` |
| 3.9 | Route `Cache-Control: max-age` defeats client invalidation on 8 routes; `exercise-library` and `activity-types` are `public, max-age=3600` on session-gated data. **[S]** | `exercise-library/route.ts:12`, `activity-types/route.ts:12`, +6 |
| 3.10 | Finishing a run leaves 4 stat caches stale at 6 h TTL. **[S]** | `invalidateActivityWrites()` omits `running-bests`, `run-type-stats`, `walk-segment-stats`, `cardio-trends` |
| 3.11 | Done-screen reports **lifetime** XP as "earned" — `achievements:` written by one screen, invalidated by five groups. **[S]** | `workout-screen.tsx:266-269,957,1690` |
| 3.12 | Confirming a flagged scale weigh-in invalidates nothing, despite a real `body_metrics` write. **[S]** | `scale-pairing.tsx:126` → `confirm/route.ts:42-44` |
| 3.13 | Three memoised components defeated at call sites; the stats one is a **missed sibling sweep** (home fixed the identical line with an explanatory comment). **[S]** | `stats-content.tsx:218`, `cardio-content.tsx:128-129`, `sore-muscle-picker.tsx:103` |
| 3.14 | `sessions_in_phase` reconcile has one call site, but the counter is read unreconciled by `workout-data` **and** by `signals.ts:519` → `phase-guards.ts:38,61,84`, whose ceilings **force phase transitions**. Production: one drifted row, on a *retired* program — active program clean. **[V+S]** | `periodization.ts:210` vs `workout-data:211,220,390,399` |
| 3.15 | Four routes take a raw `date` param with no `normalizeDateParam`; `oura/hr-window:25` does `.split('-')` on it. Five siblings have the guard. **[S]** | `mood:25`, `day-checkin:19`, `nutrition/food-logs:14`, `oura/hr-window:17,25` |
| 3.16 | `formatDateDisplay` parses as UTC midnight then renders device-local — the exact thing the function beneath it documents as forbidden — plus three inline copies. **[S]** | `date-utils.ts:169` vs `:178-181` |
| 3.17 | `ScreenPaletteLayer` paints a full-screen wallpaper from a mounted-gated `resolvedTheme` → dark flash on 7 screens for light-theme users. Already fixed once for `usePageGradient`, never carried over. **[S]** | `screen-palette-layer.tsx:10,13` |

---

## 4. Findings — Tier 3 (hygiene / latent)

`mood_logs` push branch has no validation at all (`adapter.ts:3630-3644`) · `food_items` push drops
`barcode`/`region` and uses different defaults (`:3707-3724`) · pull chain drops 4 columns present on
both ends (`workout_sessions.session_id`/`intensity_mode`/`was_override`,
`exercise_logs.exercise_deloaded`) · ~~`PATCH /api/supplements/[id]` never bumps `updated_at`, so the
edit never syncs~~ **— WRONG, corrected 2026-08-08 while fixing Q-124:** migration 078 installs a
`BEFORE UPDATE` trigger (`trg_set_updated_at`) on `supplements`, so the DB has always bumped it.
Verified against a live PATCH: `updated_at` moved and the row appeared in the next `/api/sync/pull`
delta. The repo function now sets it explicitly anyway (so the behaviour does not depend on a
trigger the code never references), but nothing was broken · dark-only white-alpha literals on light-reachable cards
(6 files) · 21 hand-rolled toggles without `aria-expanded`, up from ~18 · global tap floor is 44px
against a 48dp mandate, and is a bare element selector (`globals.css:483-487`) · score values
coloured by band with no label (3 sites) · 5 admin image routes with no rate limit · `sync/pull`'s
`since` cursor unvalidated → opaque 500 loop · dash-only date regexes in 7 files ·
`scoreBand` palette re-hardcoded in a legend and in `readiness-card.tsx:16-20` · two divergent
`batteryColor` functions · monotony band hardcoded client-side · `updateSupplement` passes the raw
body to `.set()` (safe only via its caller's `.strict()`) · 6 files over 800 lines · `loading:`
skeleton over a cache-seeded card (`overview-screen.tsx:36-37`) · home fetch waterfall
(`session-select-content.tsx:533-588`) · 4 screens bare-`fetch` `/api/hr-profile` bypassing the
shared key · `exercise-hr-trend/route.ts:31` uses the banned ms-offset window anchor · 6
emoji-as-chrome sites · two new undocumented migration collisions (146, 161).

---

## 5. Dead code and never-shipped

| # | item | verdict |
|---|---|---|
| D1 | `app/health/timeline/page.tsx` (131 lines, added #1074 2026-08-05) | **Orphan since creation.** Zero inbound links; `git log -S` shows none was ever committed. **[V]** |
| D2 | `app/stats/stats-content.tsx` (389 lines) | **Dead.** Zero importers; `app/stats/page.tsx` is a 5-line redirect. Flagged in `uplift-archive.md:397`, never actioned. **[V]** |
| D3 | `sync/oura-timeseries` | Route implemented, client driver never written — `sync-engine.ts:640` says "not yet wired". **[S]** |
| D4 | `oura/webhooks` | Admin management API, no UI ever built. **[S]** |
| D5 | `oura/debug`, `admin/seed-exercise-gifs`, `admin/test-exercise-image`, `admin/list-ai-models` | Delete candidates. **[S]** |
| D6 | `builder-chat`, `exercises/generate`, `workout-review` | **Never logged a call in production** (`ai_call_log`, 146 rows). Exist and are wired; simply never exercised. **[V]** |
| D7 | `/sheet/[id]/*` shims | **Keep — but they mask two dead subtrees.** They are the only inbound path to `/chat` and `/overview`, and `/api/ai-chat/tts` is reachable only through that chain. Decide the subtrees first. **[S]** |

`admin/backfill-derived-scores` is uncalled **by design** (curl-only ops tool with its own journal
entry) — explicitly not classified as dead.

**Device-verification backlog:** 90 `projectOverview.md` rows carry a NOT-verified-on-device marker.
Three explicitly need a new APK — and the `SpeechRecognition` errors of 2026-08-05/06 prove the APK
carrying v1.258.0's native STT was never installed, so voice logging is **broken on the device right
now**.

---

## 6. Score calibration (91 days of `/api/admin/day-review`)

Two windows were pulled: 31 days first, then the full 91-day history (2026-05-09 → 2026-08-07) in
three paged requests. **The 91-day numbers below supersede the 31-day ones** — three conclusions
changed.

**Coverage is clean.** Sleep 56/91, readiness 32/91, but the gaps are entirely historical (readiness
begins in July, when derived scores landed). The **last 30 days have zero missing pillars**.

**Zero persisted-vs-live divergence across 88 checked pillar-days.** No stale-model drift anywhere.

### 6.1 The Activity Score is effectively a step counter

**r(steps, activityScore) = 0.775** over 91 days (the 31-day window gave 0.86 — the shorter window
flattered it).

| contributor | weight | n | mean | sd | at 100 |
|---|---|---|---|---|---|
| `strengthFreq` | 25 | 91 | 100.0 | **0.0** | **91/91** |
| `moveHours` | 12 | 44 | 100.0 | **0.0** | **44/44** |
| `strengthVolume` | 20 | 91 | 94.8 | 18.0 | 82/91 |
| `steps` | 18 | 91 | 56.1 | **33.6** | 19/91 |
| `zoneMinutes` | 10 | 44 | 5.3 | 20.9 | 2/44 |
| `activeEnergy` | 15 | 16 | 53.1 | **29.5** | 2/16 |

`strengthFreq` — the **largest single weight** — has been exactly 100 on all 91 days across three
months. It has never once carried information. The cause is goals far below actuals: strength
frequency goal 3 against 5–7 sessions/week, move-hours 15 against 19–24, volume 4,700 against 29,661.
(A 31-day read suggested `strengthVolume` was also constant; over 91 days it is *saturated*, not
constant.)

### 6.2 The Activity Score lost its second-best input a month ago
`activeEnergy` is `excludedReason: "no input available"` on every recent day —
`body_metrics.active_calories` came from Oura Cloud `daily_activity`, which stopped at the BLE
re-key. The model handles it **correctly** (excluded, weights renormalised — not silently zeroed),
but with sd 29.5 it was the second-most discriminating contributor in the pillar. The score went
from two informative inputs to one, and nothing surfaces that.

### 6.3 `zoneMinutes` — absent-vs-zero asymmetry
Absent data is excluded and renormalised; a *structural* zero is scored as a genuine zero at full
weight. Zone 1 spans 55–134 bpm (≈60% HRR), and strength training with rest rarely sustains above
it, so a lifter structurally scores ~0 on a cardio metric, permanently. (An initial hypothesis that
strap HR was missing from `oura_heartrate` was **wrong** — it carries `chest_strap` samples, 1,090
on 2026-08-07.)

### 6.4 The Sleep Score's compression, narrowed to four contributors
Over 91 days six of ten contributors *do* discriminate: `deep` (sd 19.0), `totalSleep` (18.7), `rem`
(18.5), `timing` (13.0), `efficiency` (12.3), `restfulness` (10.0). The 31-day "six contributors
above 94 mean" framing was a short-window artefact.

Four are near-dead: **`hrv`** (sd 7.4, 33/39 days at exactly 100), **`hr`** (sd 9.2, 29/39 at 100),
**`schedule`** (sd 4.9), **`latency`** (sd 7.6). `hr` and `hrv` also appear on only 39 of 56 scored
nights — 17 nights were scored with neither.

This is the mechanism behind Q-72, which recorded the symptom (measured against 32 rated nights)
without a cause.

### 6.5 Readiness is the control case
Spread holds at 91 days: `hrvBalance` sd 27.1, `sleepBalance` 26.2, `recoveryIndex` 23.0,
`restingHeartRate` 15.9, `checkin` 13.1; only `activityBalance` (7.5) is low-signal. Readiness
ranged 39–88 on the same data where sleep sat at 82+. That proves the flatness in Activity and Sleep
is a **calibration** problem, not a data-availability one.

---

## 7. Checked and clean

Auth: only 6 of 201 routes lack a check, all deliberate; all 25 admin routes re-read the DB rather
than trusting the JWT flag. Zero `JSON.parse` of model text; all 6 structured routes use
`generateObject`; all 7 `generateText`/`streamText` calls are in try/catch. Webhooks fail closed and
carry no enumeration oracle. Both secret-bearer paths (`admin/db-query`, `admin/day-review`) fail
closed, rate-limit before the constant-time compare, and still require admin. SEC-1/2/3 ownership
classes genuinely fixed. Poison-pill handling correct (quarantine + `continue`, bounded retry,
dead-letter at 5). Local-first reads correct everywhere except §3.2. `RECONCILE_TABLES`/`COLUMNS`
machine-checked — zero mismatches. Zero `invalidateCache` calls outside `cache-groups.ts`. No TTL
divergence across 158 fetch sites. No prefix-sibling collisions. Legacy home seeds still cleared.
Instant-paint done — zero self-fetching cards with a skeleton and no sync seed. **The 2026-07-20
Zustand hot-path finding is fixed** — dial detents no longer reach the orchestrator. Sparkline count
held at 5, no new copies. Zero nested `<button>`. Every safe-area utility exists and is the correct
floored variant. No new test time bombs. 1RM, ACWR, `scoreBand`, muscle normalisation, macro/sleep
palettes all single-source. `lib/ai-chat/tools.ts`'s six banned ms-offset windows are gone.

**Correction issued during synthesis:** a sweep reported `oura/webhooks` still echoes the HMAC
signing key (SEC-H2, from the 2026-07-06 review). It does not — the route returns `{success: true}`
and carries an explicit comment forbidding it. **SEC-H2 is fixed**; the claim was dropped rather
than passed on.

**Doc corrections:** CLAUDE.md's Key Files table points at `lib/1rm.ts`, which no longer exists.
CLAUDE.md records migration collisions 081/087 only; 146 and 161 are also collided.

---

## 8. Surfaces NOT exercised

No device, no emulator, no browser this session. Specifically not verified: on-device safe-area inset
values on the S25 (§2.4's magnitude depends on the real `env()` under gesture vs 3-button nav);
rendered contrast ratios for §2.5/§2.6 (OKLCH reasoned about, not measured); Samsung WebView
compositor rendering; native SQLite/Capacitor paths; real Oura/Health Connect tokens. The dead-route
ledger is static grep analysis — a route reached only through a runtime-computed path with no
literal segment would be invisible to it. All **[S]** items are single-sweep claims not
independently re-checked.
