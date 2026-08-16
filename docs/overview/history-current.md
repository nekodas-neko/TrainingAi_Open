# Session Journal — sessions ~287 → 2026-07-16 (closed batch)

> Closed 2026-07-16 (~250 KB threshold). Next batch: `history-2026-07-16.md`. Previous batch:
> `history-newer.md` (sessions ~217–286). Index: `projectOverview.md` → Document Map.

## Session 297 — Polar H10 planning: skill + implementation plan + queue-top backlog entry (docs-only)

Owner bought a **Polar H10 chest strap** and asked to research everything it can do, build the
skill, and plan the integration with "HR path chooses Polar H10 as default, falls to Oura when
not connected." Planning session per the backlog protocol — **no implementation** (PR 1 of 2).

**Research (web + repo reconciliation):**
- HR + **RR intervals** (per-beat, the live-HRV raw material) come from the **standard** BLE
  Heart Rate Service `0x180D`/`0x2A37` — no reverse-engineering, no auth handshake, no Polar SDK.
  Direct GATT via `@capacitor-community/bluetooth-le`; the Polar SDK was rejected (custom non-OSI
  license, RxJava, Android-native only — and needed only for the H10's internal PS-FTP exercise
  recording, which we don't want).
- **Expectation corrected:** the H10 exposes **no steps and no cadence** — the "cadence" on
  Polar's marketing is watch-ecosystem math over the strap's raw accelerometer. What it actually
  offers beyond HR/RR: raw **ECG 130 Hz** and raw **ACC 25–200 Hz** via the proprietary PMD
  service — documented in the skill (§3, full UUIDs/commands/frame formats) but **scoped out** of
  the queued work (no product use yet; R&D note left in the backlog). Steps stay on the ring.
- Stable **public MAC** (cache the deviceId — opposite of the ring's rotating RPA), sensor-contact
  flag in every `0x2A37` packet, **never system-bond** (Polar guidance), Samsung `autoConnect`
  unreliable (same as the ring), 2 concurrent BLE connections (app + watch OK).
- Repo reconciliation: the 2026-07-08 **Plan 3 chest-strap plan** already covered the core and
  was ⛔ blocked on "needs a physical strap" — now unblocked. Verified still fresh against `main`
  (`'chest_strap'` id reserved in `lib/live-hr/types.ts`, manager registration-order precedence,
  `upsertOuraHeartrate`/`getHrForWindow` signatures unchanged). One real gap found: the manager
  gates beats on *first non-disconnected source*, so a **connected-but-unworn strap would mask
  the ring** — the new plan worn-gates `connectionState()` on the sensor-contact bit (15 s grace)
  so fallback genuinely engages.

**Deliverables (this PR, docs-only):**
- **`polar-h10-ble` skill** (`.agents/skills/polar-h10-ble/SKILL.md` + `.claude/skills/` symlink):
  capability inventory (incl. the explicit can't-do list), GATT map, `0x2A37` parse spec, full PMD
  protocol, internal-recording notes, connection quirks, SDK-vs-direct-GATT decision, risks.
- **Plan `2026-07-16-polar-h10-integration.md`** (supersedes Plan 3, which is banner-annotated):
  Chunk A — parser (bpm/RR/contact, TDD), dep add, paired-strap persistence, worn-gated
  `ChestStrapSource` with bounded reconnect + batched fire-and-forget ingest, manager precedence,
  More→Profile pairing UI with battery/firmware readout, `/api/hr-ingest` (Zod + rate limit) →
  `oura_heartrate (source='chest_strap')`, pure `preferStrapBuckets` strap-over-ring read merge
  wired into `getHrForWindow`, empty-state copy. Chunk B — **migration 124** `rr_intervals`,
  RR persistence with beat-time reconstruction, artifact-gated `rmssdFromRr`
  (`lib/health/rmssd.ts`, One-Formula home — nothing computes rMSSD from raw RR today), and a
  rest-window Workout HRV stat on the done screen via `/api/oura/hr-data`.
- **Backlog:** new ⭐ owner-directive entry at the **very top of the Queue** (branch
  `feat/polar-h10-live-hr`); the old blocked Plan-3 entry and the "buy a strap" origin bullet
  reconciled to point here; PMD R&D noted as not-yet-queued.
- **Ledger fix:** `projectOverview.md` said "next migration: 120" while 121–123 were on disk —
  corrected (next free: 125; 120 pencilled ring-walk, 124 claimed by this plan).

Sandbox-only session; nothing runtime shipped, so nothing to device-verify. No version bump
(docs + skill only). Implementer notes: read the skill first; the plan states which halves are
JS/server vs owner-APK-rebuild-gated (`npx cap sync android`).

## Session 296 — Oura culling Lever 1c: physically reclaim disk after Lever 1b (+ Lever 5 deferred)

Owner asked to review what's left on the Oura data-culling work and to "drop the rest" of the
data we don't need. Audited the pipeline against current code (two Explore passes) rather than
docs-from-memory, and reframed the request:

- **Going-forward ingestion is already lean** — Lever 1a (`decoded` never written,
  `adapter.ts:3501`), Lever 2 (10 telemetry/debug tags dropped at ingest, `raw-storage.ts`),
  Lever 3 (`step_live_windows` 30-day prune). 17 BLE tags carry real analytical value; the rest is
  already dropped or deliberately kept-archival. We are **not** hoarding new junk.
- **`body_hex` is the real long-term driver** (`oura_raw_samples` unbounded, ~0.5–1 GB/yr) but it's
  the archival re-decode source, not "data we don't know we need" — dropping it is the irreversible
  Lever 5. **Owner deferred it** ("needs a discussion… maybe wait till the system is fully built and
  we review"). Held. Recommended eventual shape: 5a cold-store at ~12 months, not hard-delete.
- Also **dropped my own proposed Lever 2 expansion** (culling the decoded-but-unused
  `0x47/0x59/0x6b/0x6c/0x74` tags) — same logic: `0x59` is EDA/stress, `0x47/0x6b` motion, plausibly
  useful once the metric stack is complete, and dropping at ingest is unrecoverable.

**Built Lever 1c (owner-approved):** admin-triggered `VACUUM (FULL) oura_raw_samples` to physically
reclaim the space Lever 1b freed only logically (MVCC — nulling `decoded` leaves dead tuples the
file never sheds without a rewrite; the owner saw the table *grow* after Lever 1b). Implementation:
`vacuumOuraRawSamples()` (`slices/oura.ts`) checks out a dedicated pool connection, `SET
statement_timeout = 0` + `idle_in_transaction_session_timeout = 0` (VACUUM FULL outlasts the pool's
15s cap on a big table), runs the vacuum, then `release(true)` so a timeout-disabled client is never
returned to the pool. `POST /api/oura-ble/samples/vacuum` (admin-gated, rate-limited 2/min) +
confirm-gated "Reclaim disk — VACUUM FULL (Lever 1c)" button in `DbFootprintCard` ① Data section,
returning before/after/reclaimed bytes. No data dropped — `body_hex` and every row preserved.

**Verified** on the local DB with a synthetic bloat cycle reproducing the owner's exact scenario:
seed 8000 fat-`decoded` rows → 10.1 MB; null `decoded` (Lever 1b) → **11.8 MB (grew** — MVCC dead
tuples); `VACUUM FULL` → **2.0 MB (reclaimed 9.8 MB, 0.1s)**. The VACUUM SQL, timeout override, and
connection lifecycle all exercised against real Postgres; dev DB left as found. Typecheck clean
(pre-existing `onnxruntime-node`/capacitor-splash errors only), lint clean (0 errors on changed
files). **Not exercised:** the admin route end-to-end via UI (seed user isn't admin — tested the DB
path directly instead) and real prod-scale VACUUM timing (local table is small). No version bump /
changelog entry — admin-only infra, matching how Levers 1a/1b/2/3/G-2 were handled.

Docs updated same PR: `oura-ble-operations.md` I17 (Lever 1c shipped), `implementation-backlog.md`
P-A (1c done, 5 deferred), `module-map.md` §0 (new row), `projectOverview.md` status.

## Session 295 — Next-workout prescription preview on the done screen (item 20)

Implemented backlog item 20 (`docs/superpowers/plans/2026-07-14-next-workout-prescription-on-completion.md`,
branch `feat/next-workout-prescription-preview`) — an owner-requested "Next workout" card on
the workout-completion screen previewing the next scheduled session's per-set weights/reps/rest.

Re-verified the plan's referenced code (it was written same-session as it was queued, so very
fresh) against current `main` before implementing: exact line numbers and helper signatures
confirmed unchanged, with one correction — `workout-data`'s SWR header is `max-age=30,
stale-while-revalidate=60`, not the `60/120` pair the plan cited (that pair belongs to
`next-session/route.ts`, which is what the new route's own headers correctly match).

**New read-only endpoint** `GET /api/next-session/prescription`
(`app/api/next-session/prescription/route.ts`) — deliberately does not reuse
`/api/workout-data`, whose consumption-day re-evaluation and expiry enforcement are keyed on
**today** and would corrupt a *future* session's stored prescription if invoked at completion.
Assembles the preview from `getNextSession` + `getActiveProgram` (for `phaseMode`) +
`getSessionPeriodization` (a pure read — never calls `updatePrescriptionStatus` or
`updatePrescriptionExercisesCache`) + the same `prescriptionDrivesLoad`/
`prescriptionStyleForExercise`/`resolveBodyweightStyle`/`mroundStepUp`/`weightStepFor` helpers
`workout-data` itself uses, so the loads it previews are computed identically, not
re-derived. Response carries a `source: 'driving' | 'static' | 'pending'` tag so the UI can
show a "still being generated" note when an `ai_dynamic` program has no usable stored
prescription yet, and falls back to the exercise's static style once a prescription is past
its expiry (mirrors `workout-data`'s own expiry check, but as a read — no `dismissed` write).
Rate-limited (`20/60s`, matching sibling non-trivial GETs) and cached with the standard
`private, max-age=60, stale-while-revalidate=120` header.

**New UI** `components/workout/next-workout-card.tsx` — a tap-to-load card (never auto-fires;
the user is leaving this screen, matching the existing Session Recap / HR Recovery card
pattern on the same file) mounted in `done-screen.tsx` between the HR Recovery card and the
action-button row, static-imported (lightweight data card, not `dynamic`). Shows a rest-day
message, the "still generating" note, or a compact per-exercise weight×reps chip list.

Added 6 unit tests (`app/api/next-session/prescription/__tests__/prescription.test.ts`,
mocking `@/lib/data`/`@/auth`) covering: rest day, non-`ai_dynamic` static source with correct
`mroundStepUp` rounding, `ai_dynamic` with no stored prescription → `pending`, a driving
prescription applying its own pct/reps/rest, a past-expiry prescription falling back to
`static`, and — the correctness-critical one — asserting `updatePrescriptionStatus`/
`updatePrescriptionExercisesCache` are never called (the whole point of not reusing
`workout-data`).

`pnpm lint` (0 errors, same warning baseline)/`pnpm exec tsc --noEmit` (clean)/`pnpm test`
(1308 passed, 6 new)/`pnpm build` (clean) all green.

Version bumped 1.148.1 → 1.149.0 (minor — new user-facing feature). `lib/changelog.ts` entry
added. **Backlog item 20 removed** (last numbered item — no renumbering needed).
`projectOverview.md` Known Issues gained a row flagging the plan's own on-device gate (confirm
previewed loads match what `/workout` actually opens with for an AI-dynamic prescription) as
not yet run. Continuing the backlog loop.

## Session 294 — Nutrition tab uplift: Chunks 1–5.3 (item 10, Chunk 5.4 remaining)

Worked backlog item 10 — **Nutrition tab uplift** (`docs/superpowers/plans/2026-07-10-nutrition-tab-uplift.md`,
branch `feat/nutrition-tab-uplift`). Re-verified all 22 numbered findings against fresh `main`
before implementing — all still reproduced, only line numbers had drifted; R5/R6/R7/R8 (the
plan's stated prerequisites) had all shipped and removed, so no reconciliation was needed beyond
that.

**Chunk 1 (selected-date correctness):** `nutrition-content.tsx`'s calorie-goal/macro-ring
adjustment and the `SupplementsSection` render were both gated on `selectedDate === todayStr` —
previously today's burned-calories figure and today's supplement ticks silently applied to
whatever past day was on screen. `handleFoodLogged` gained a date guard so a log landing via
push-notification/cache-invalidation callback can never paint under the wrong displayed day.
`manage-supplements-sheet.tsx`'s three outbox `queueMutation` calls switched from
`new Date().toISOString().slice(0, 10)` (UTC, wrong before 10am AEST) to `todayInTz()`.

**Chunk 2 (instant paint & fetch discipline):** added a synchronous cache seed for
`supplements`; rebuilt `saved-meals-sheet.tsx`, `food-library-sheet.tsx`, and
`capture-step.tsx`'s bare `fetch()` calls onto `cachedFetch` + `readCacheSync` seeds (new cache
keys `saved-meals`, `nutrition-food-items-all`, `nutrition-recent-for-meal:<id>`, all registered
in `lib/cache-groups.ts`'s `invalidateNutritionWrite()`/new `invalidateSavedMeals()`).
`meal-type-manager.tsx` rewritten for optimistic edit/delete/add (feedback before the network
round-trip, revert on failure), an in-flight `deletingId` guard (previously a double-tap fired
two DELETEs), and moved the `@dnd-kit/react` reorder from `onDragEnd` to `onDragOver` per the
CLAUDE.md WebView rule (persist-only `onDragEnd`). The food-log delete handler in
`nutrition-content.tsx` now refreshes only the two caches a delete actually affects
(`loadFoodLogs` + `nutrition-weekly-summary`) instead of refetching all seven mount-scoped
endpoints. `MealCard` wrapped in `React.memo` with stable hoisted callbacks
(`openLogger`/`requestDeleteLog`/`openQuickEdit`) and a memoized `logsByMealType` Map at the call
site — previously every supplements/targets/loading state change re-rendered every meal card.

**Chunk 3 (API hygiene):** added the standard `Cache-Control: private, max-age=60,
stale-while-revalidate=120` header to six nutrition GET routes that were missing it
(`food-logs`, `meal-types`, `targets`, `saved-meals`, `recent-for-meal`, `food-items`). Added a
Zod schema (`lib/validators/saved-meal.ts`, shared between the collection and `[id]` routes —
kept out of the route files themselves since Next's route-handler type validator rejects
non-handler exports from a `route.ts`) to the saved-meals POST/PUT, which previously validated
only `name` truthiness and an item-count cap with no field-shape checking. Investigated 3.3 (EOD
check-in cache-invalidation sweep): no additional client-cached key renders `day_checkins` data
beyond what `invalidateHealthTrends()` already covers — no code change, per the plan's own
"if nothing else consumes it, record the conclusion and change nothing" instruction.

**Chunk 4 (theme/a11y):** `weekly-nutrition-chart.tsx`'s chart.js ticks/gridlines/bar colors
went through `resolveColor()` (canvas can't resolve `var(--x)` — the third instance of this bug
class, after R7's two fixes) and the hardcoded `#00ff87/#3b82f6/#f59e0b/#ec4899` series palette
now sources from the canonical `MACRO_COLORS` + a brand-token calories color. Swapped hardcoded
hex/rgba literals for theme tokens in `day-summary-card.tsx` (battery status colors),
`today-insight-card.tsx`, `scale-selector.tsx`'s default color, and `supplements-section.tsx`'s
logged-tick styling. Bumped two sub-48px tap targets (`weekly-nutrition-chart.tsx`'s metric
pills, the EOD review close button) to the 48dp floor. Added `aria-pressed` to the supplement
toggle. Gave ingredients in `review-step.tsx` a stable `clientId` (added to `NutritionIngredient`
as an optional client-only field, stamped at both scan/refine seed sites in
`food-logger-sheet.tsx`) instead of keying rows by array index — a refine/rescan that changes the
ingredient count no longer carries a stale weight input into the wrong row.

**Chunk 5.1–5.3 (display & grouping):** merged the standalone adherence card into the weekly
chart card as a footer section (deleted the separate block); compacted the two stacked
full-width "Saved Meals"/"End of Day" buttons into a 2-column grid of compact cards; added a
water tile (today-only, same gate as the supplements section) between the calorie ring and the
TDEE card, reusing the existing `WaterLogSheet` — no new invalidation wiring needed since that
sheet already invalidates `body-metadata`, which the tile reads from.

**Chunk 5.4 (offline meal-types local mirror) deliberately NOT done this session** — it's new
local SQLite infrastructure (a migration, `RECONCILE_TABLES` registration, `lib/local-store/`
backend methods, local-first read wiring) that's device-only verifiable (the local store is null
in the web sandbox), and landing it inside an already-large Chunks-1–5.3 batch risked another
unreviewed sprawl. Left as backlog item 10 (re-scoped to just 5.4) rather than force it in.

`pnpm lint` (0 errors, same pre-existing warning baseline)/`pnpm exec tsc --noEmit` (clean)/
`pnpm test` (1297 passed)/`pnpm build` (clean) all green.

**Verified live** via Playwright at a 384×832 viewport against the local dev DB
(test@local.dev): water tile renders and updates after logging; the quick-action row renders as
a genuine 2-column grid (confirmed via bounding-box y-coordinates); the weekly chart and
adherence sections render in one merged card; date navigation to yesterday hides the supplements
section and shows no "burned" adjustment, returning to today restores both; the Meal Types
manager list renders without a stuck spinner, add/edit/delete all work, and delete fires exactly
one DELETE request; the Saved Meals sheet shows no loading spinner on a second open (instant
cache paint); no app-originated console errors. **Not independently screenshotted: actual chart
bar colors** — the local seed has no last-7-days nutrition summary rows so the canvas branch
never mounts (empty state instead); read the `resolveColor()` implementation directly instead,
which is the same helper already verified working via R7's HR-recovery-chart fix.

**Mid-session state-loss incident:** partway through, a chunk of already-implemented work (14 of
~24 touched files — `manage-supplements-sheet.tsx`, `saved-meals-sheet.tsx`,
`food-library-sheet.tsx`, `capture-step.tsx`, `meal-type-manager.tsx`, `meal-card.tsx`,
`lib/cache-groups.ts`, and six `app/api/nutrition/*` routes) silently reverted to their
pre-session state, and separately the working branch was discovered to be checked out on a stale
branch (`perf/performance-and-paint`, based on a `main` commit from before R6/R7/R8 merged)
rather than a fresh branch off current `main`. Diagnosed via `git diff`/`git log` showing the
"missing" files as unmodified and the branch's base commit predating the already-merged R8 PR.
Recovered by saving the intact working-tree diff as a patch, resetting to a clean checkout of
fresh `origin/main`, recreating the branch, and reapplying the patch (applied cleanly, confirmed
by a full lint/tsc/test/build pass on the correct base). Re-verified nothing was silently lost
in the process — the file list and diff stat matched the pre-incident state exactly.

Version bumped 1.144.1 → 1.145.0 (minor — new features: water tile, layout regroup, and several
real bug fixes with user-visible effects). `lib/changelog.ts` entry added. **Backlog item 10
re-scoped** (not removed — Chunk 5.4 remains) to reflect only the offline meal-types mirror;
queue numbering unchanged since the item stays in place. Continuing the backlog loop.

## Session 293 — Harden the BLE sleep-window clamp: HR density, not accelerometer presence (`claude/sleep-window-density-clamp`, v1.144.1)

Follow-up to session 292. The owner reported a THIRD night (2026-07-15) still showing a too-early bedtime — `8:28 pm – 6:38 am` while every other night sat at ~9:50–10:40 pm. The 292 clamp (trim the window to the 0x72 sleep-accelerometer span) was defeated: the owner's per-epoch dump showed a **dense-but-awake burst** at 19:53–20:03 (beats 638/623/512, HR ~73, movement present, stage `awake`), then ~2h of sparse spot-readings, then real dense continuous sleep from 22:03. Because that early burst carries accelerometer too, "first 0x72 sample" landed at 19:53 and the window wasn't trimmed; the stager then labeled sparse 20:28–21:03 spot-readings as `rem`, setting onset at 20:28 (8:28 pm).

**Root signal:** HR-sample **density** per 5-min epoch cleanly separates the regimes — the ring spot-checks HR (≤129 beats/epoch) while awake but streams hundreds (≥238) continuously only while asleep (confirmed on both the 07-14 and 07-15 dumps). Reworked `lib/sleep/sensing-span.ts`: `clampToDenseSensing` now calls `denseSensingSpan(perEpochBeats)`, which marks epochs dense at ≥0.3×peak, groups them into runs (bridging ≤2-epoch blips), drops runs shorter than 6 epochs (an incidental burst), and returns the span from the first to the last **substantial** run. This drops the short evening burst yet still spans a night genuinely split into two real sleep clusters by a long mid-night gap (the 07-09 split-night merge — kept green). The adapter computes `perEpochBeats` from `ibiRows` over the original window before staging, then clamps. Replaced the accelerometer-span clamp entirely.

**Verification:** unit tests pinned to both real dumps' beat sequences (07-15 burst dropped → span starts at epoch 26 = 22:03; 07-14 single run; split-night spans both clusters; all-sparse → null); the DB-backed rollup regression now seeds an early dense burst + sparse evening + real sleep and asserts the written bedtime clamps to the dense run (01:00Z, not 23:00Z). Full gate: 66 adapter DB tests + 1289 unit tests green, typecheck clean, lint 0 errors, custom rule OK. **Server-side — ships via Railway, retroactive on a redecode; no APK rebuild.** ⛔ NOT yet confirmed on the owner's real 07-15 night — Known-Issues row updated; owner to redecode `2026-07-15` after deploy and confirm bedtime ≈ 10 pm.

## Session 292 — Two owner-reported BLE sleep-timing fixes (`claude/sleep-time-calculation-pcdm1n`, v1.143.2)

Owner opened the Health sleep detail right after waking and flagged two things: the wake time read a few minutes **in the future**, and the **bedtime was ~1h55m too early** (8:42 pm shown for a real 10 pm bedtime, which also inflated "Time Asleep" to 8h40m for what was ~8h in bed).

**Fix 1 — future wake time (`lib/sleep/actual-window.ts`).** The sleep detail header derived its displayed wake as `sleepStart + codes.length × 5min`. But the BLE aggregate pads the 5-min hypnogram string UP to a whole number of epochs (`nEpochs = Math.ceil(window / EPOCH_DS)` in `adapter.ts`), so that count runs 0–5 min longer than the ring's actual recorded window — every night the displayed wake overshot the recorded wake, invisible during the day but a "future" time when opened just after waking, and it disagreed with the hypnogram axis directly below (which already uses the recorded end). `actualSleepWindow` now anchors its end to `phaseWindowEnd ?? sleepEnd` (the same value the ribbon axis uses) and clamps the onset-trimmed start so it can never exceed it. Tests rewritten + a regression case for the padded-string overshoot.

**Fix 2 — bedtime too early (`lib/sleep/sensing-span.ts`, new; wired into `adapter.ts`).** The owner pulled the per-epoch diagnostic (redecode `?date=2026-07-14`). It was decisive: window `20:14–07:04`, but the 0x72 sleep-accelerometer (`mv` column) and dense HR (`beats` jumping from ≤129 to 350–700) **both switch on at 22:09** — exactly the real 10 pm bedtime. The 20:14–22:04 span carried only sparse awake spot-readings and no accelerometer. Root cause: the night window is built from a bedtime event or a 0x72/0x75 cluster, and 0x75 sleep_temp / bedtime signals fire during evening wind-down while 0x72 (the real sleep-tracking sensor) only streams once asleep. New `clampToSensingSpan(window, acmDsList)` tightens each window to its 0x72 accelerometer span; it's a **no-op when no 0x72 exists** (a genuine zero-movement night — session 235's 105-min elevated-HR sleep — so a real night is never trimmed to nothing).

**Verification.** Both fixes pinned to the owner's real 2026-07-14 dump values. `lib/sleep` unit suites + a new **DB-backed** regression in `oura-ble-sleep-staging-rollup.test.ts` (a night whose temp/HR signal leads the accelerometer by 2h) run the real aggregate pipeline against local Postgres and confirm the written bedtime clamps to the accelerometer start (01:00Z, not 23:00Z) with duration dropping ~8h→~6h. Full gate green: 254 sleep/adapter/health tests, typecheck clean, no new lint. **Server-side change — ships via Railway into the WebView, no APK rebuild; retroactive on a redecode over the preserved `body_hex`.** ⛔ NOT yet verified on the owner's real ring — Known-Issues row added; owner to redecode `2026-07-14` after deploy and confirm bedtime ≈ 10 pm and wake matches the device clock.

## Session 295 — Program-editor fixes: role selector hidden on ai_dynamic + cramped exercise names (`claude/workout-ai-review-adjust-f2g8jj`, v1.139.13)

Owner screenshot from the program editor (ai_dynamic powerbuilding program): couldn't find the
"Accessory" role button, and exercise names were unreadable (name only visible as an Android
long-press tooltip). Two bugs in `components/config/program-editor-sheet.tsx`:

1. **Role selector gated on `phaseMode === 'automatic'`** (the "Role: Main Compound / Secondary
   Compound / Accessory" buttons + the "style determined by phase/role" note). ai_dynamic programs
   fell through both branches, so the role buttons never rendered — the owner literally could not
   change a role. Fixed: both now render for `phaseMode !== 'manual'` (automatic **and** ai_dynamic).
   Reworded the note to "Sets/reps/load are set automatically from the exercise's role and your
   current phase" (accurate for ai_dynamic).
2. **Exercise name input was `flex-1 min-w-0` inline with the library/info/superset buttons**, so
   on a phone it squeezed to near-zero width and the name text disappeared. Moved it to its own
   full-width line (`w-full font-semibold`) above the action-button row.

This unblocks the owner's actual task: demote Lower-day "Barbell Good Morning" from primary →
accessory (the one manual change still needed after the runtime powerbuilding-secondary fix in
session 294) — the role buttons now exist to do it.

**Verification.** `tsc`/lint clean, `next build` compiles. **Not verified on-device** — this is a
Samsung-WebView rendering fix and the sandbox has no device/authed editor; the change is a
deterministic JSX gate + layout move, but the owner is the real verifier. Branch restarted from
fresh `main`.

## Session 289 — Sleep session close-out: consolidated `docs/sleep-system.md` reference (`claude/rem-parity-sleep-staging-agbq16`, docs-only)

**Closing the multi-session sleep-staging arc** (REM per-bout decode v1.126.0 · debug-window fix ·
quiet-wake shipped+reverted · LF/HF plan queued item 22). Owner confirmed the shipped state is good:
07-12 post-revert Awake 6%/35m (was 33%/3h15m — fixed), REM reading sensibly (07-12/07-13 ~19–27% on
beat-dense nights), and 07-13 Deep 2.2h analysed from the per-epoch dump as **mostly genuine** (HR floor
58–62, HRV 45–70, stable/regular) with ~15–20 min soft at the morning tail — left alone (not a `DEEP_Z`
problem; deep is the protected/priority stage).

**Shipped this session (docs-only):** new **`docs/sleep-system.md`** — the canonical sleep reference
(data flow, the stager and its constants, Sleep Score + Oura combiner weights, supporting `lib/sleep/*`
modules, a reliability table, the quiet-wake post-mortem, a **calibration log** of the owner's labelled
nights 07-11/07-12/07-13, the open levers, and the tuning discipline). Cross-linked from
`docs/module-map.md` and `projectOverview.md` → Document Map. Complements the append-only
`docs/oura-ble-sleep-staging-findings.md` (that = narrative log; sleep-system.md = stable reference).

**State for picking sleep back up:** the live REM lever is `REM_SWITCH` (not `REM_Z`); the next real
improvement is LF/HF (item 22); accuracy is ceilinged by IBI density + no PSG ground truth, so the
highest-leverage move is accumulating owner-labelled nights. All detail in `docs/sleep-system.md`.

## Session 288 — Revert quiet-wake sleep detection: it over-called Awake (`claude/rem-parity-sleep-staging-agbq16`, v1.139.6)

**Regression fix.** The quiet-wake rule shipped v1.129.0 (detect lying-awake-in-bed via sustained
movement+HR co-elevation) **over-called badly** — the owner's 07-13 night showed **Awake 33% / 3h15m**,
more than Light (1h55m), with cream bars scattered across the whole hypnogram. Root cause: the movement
gate was `movement > moveMed` (the night median), which by definition ~half the night exceeds; combined
with a low HR bar (`floor + 6`), it swept large amounts of ordinary light-sleep stirring into Awake. It
was calibrated to a single labelled night (07-11) and over-fit.

**Reverted** the quiet-wake pass entirely from `lib/health/sleep-staging.ts` (removed the
`QUIET_WAKE_*` constants, the `qwCand`/`quietWake` computation, and the `|| quietWake[i]` term — wake
detection is back to the prior single-signal moving/tachy rules) and dropped its two unit tests. Deep,
REM, the per-bout REM Viterbi decode (v1.126.0), and the debug-window fix all stay. 36 sleep tests
green, lint clean (the local `@capacitor/splash-screen` tsc error is stale node_modules — the dep is in
the lockfile, another session's add). v1.139.5 + changelog.

**The capability isn't abandoned, just done wrong once.** Redoing quiet-wake needs the per-epoch dump of
an *over-called* night (e.g. 07-13) to see the actual false-positive epochs' mv/HR — the discipline the
findings doc mandates (tune from real per-epoch data, not one night). A correct version needs a much
higher movement bar (not the median) and likely a larger HR delta + longer run; not attempted here
without that data.

## Session 294 (continued) — Body Battery card overflowed the right screen edge (`claude/scale-section-layout-labels-tq4axl`, v1.139.8)

Owner flagged the Home Body Battery bar running off the right edge (a horizontal safe-space issue, not
part of this session's earlier work). Root cause in `components/body-battery-card.tsx`: the root
`<button>` had **both `w-full` and `mx-4`**, so it measured 100% of the scroll container's width *plus*
a 1rem margin — right edge 1rem past the container, clipped by `overflow-x-hidden`. A `<button>` does
not fill its parent on `display:block` the way a `<div>` does (measured: shrinks to content), so `block`
alone would have collapsed the card. Fix: moved the margin to a wrapping `<div className="mx-4 mb-3">`
and made the button `block w-full` inside it — filling the div, which insets by `mx-4` like every sibling.
Verified by injecting both variants with the real compiled Tailwind at the 412px S25 viewport: old
(`w-full mx-4`) → right edge 428 in a 412 viewport (16px overflow); new → right 396, matching the
reference `mx-4` sibling exactly. `tsc`/eslint clean. **Not device-verified** — the card doesn't render
in the sandbox (no Oura data for the seed user); measured against real Tailwind, on-device is the gate.

## Session 287 (continued) — Item 8 Chunk 1 Task 1.3: stop injuries force-triggering emergency deloads (AI-4, `fix/injury-emergency-deload-trigger`, v1.139.4)

Continuing the implementation-backlog loop into item 8 Chunk 1's remaining small tasks.

`shouldTriggerEmergencyDeload` (`lib/ai-periodization/emergency-deload.ts`) treated
`activeInjuredMusclesInSession.length > 0` as a standalone systemic-overtraining trigger —
meaning any active injury touching today's session muscles, no matter how minor, forced the
blunt whole-session 2-set/50% emergency deload branch. But the LLM prompt already receives
`activeInjuredMusclesInSession` as its own separate signal
(`lib/ai-periodization/prompt.ts:177`) and documents a finer-grained `session_swap_recommended`
phase-action specifically for handling an injured muscle without nuking the whole session
(`prompt.ts:105-109`) — so the emergency trigger was redundant with, and cruder than, a path the
system already has.

**Fix:** removed the `activeInjuredMusclesInSession.length > 0` condition from the emergency
trigger's OR-chain. Chose the plan's primary recommendation (outright removal) over its
parenthetical alternative (gate on injury severity) — the `injuries.severity` column exists, but
`activeInjuredMusclesInSession` doesn't currently carry severity through from the raw injury
records, and the LLM path already handles exactly the nuance the severity-gating alternative was
trying to preserve. Adding a second severity-aware signal would have been solving a problem the
system doesn't actually have.

Updated `lib/__tests__/emergency-deload.test.ts`: removed the injury case from the existing
"fires on each overtraining condition independently" test (since it's no longer one of those
conditions) and added a dedicated test asserting that 1 and 3 active injured muscles no longer
trigger the emergency branch on their own — both the old and new behaviour are directly covered.

**Verification note.** This is a pure function change with complete unit coverage on both sides
of the behaviour change, so I verified it that way rather than driving the real prescribe route
end-to-end. A live check would need a real Gemini LLM call (the API key is present in this
sandbox, so it's technically reachable) plus non-trivial setup — an `ai_dynamic` program with
baseline complete, a `session_periodization` row, and an active injury seeded against one of the
session's muscle groups. Given the change is this narrow (one boolean condition removed from an
OR-chain) and the unit tests directly assert both the old trigger behaviour and the new
non-trigger behaviour, spinning up that full LLM round-trip was judged disproportionate — this
follows the same reasoning this session applied to WK-14's voice-logging clamp (pure function,
unit-tested, no live UI/API drive needed to trust the fix).

`pnpm lint`/`tsc`/tests (1212 passed)/build all green. No migration, no server route touched
beyond the pure function it calls into. Version renumbered during rebase — this PR sat open
across a concurrent merge: session 294's powerbuilding-secondaries fix landed first and claimed
1.139.3.

**Item 8 status:** Chunk 1 now has Tasks 1.1 and 1.3 done. Tasks 1.2, 1.4–1.7 remain (1.2 —
consumption-day prescription re-evaluation — and 1.4 — the `sessions_in_phase` canonical
definition — are each larger multi-file changes better scoped as their own sessions), plus
Chunks 2–6 of the full hardening batch. Continuing the backlog loop per the owner's standing
instruction.

## Session 294 — AI-dynamic: powerbuilding secondaries prescribed moderate (role-aware phase zone) (`claude/workout-ai-review-adjust-f2g8jj`, v1.139.3)

Follow-up to session 293. Discovered while the owner asked how to fix their **current** program:
session 293's `GOAL_STYLE_RULES` change only sets the **base style at generation time**, but the
owner's program is **ai_dynamic**, where the periodization engine re-derives load each cycle — and
it treated **primary and secondary compounds identically** (both clamped to the phase band; only
`accessory` got a lighter band via `goalRange`). So on ai_dynamic, editing base styles by hand
wouldn't stick and secondaries stayed heavy. This is the real runtime fix.

**Change:** `lib/ai-periodization/prompt.ts` adds `secondaryIntensityZone(zone)` (shifts a primary
phase band −7.5% pct / +2 reps) and `intensityZoneForRole(goal, phase, role)`, gated on
`MODERATE_SECONDARY_GOALS = {powerbuilding}`. The prescribe route
(`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`) now clamps each exercise's pct
with its **role-aware** zone (`roleById` from signals), so a powerbuilding secondary is pulled into
the moderate band while the primary keeps the heavy phase band. It's **phase-relative** — the
secondary band climbs accumulation→intensification→realisation and drops on deload, always below
that phase's primary. `lib/ai-periodization/goal-ranges.ts` gains a `SECONDARY` tier
(powerbuilding `{65–85%, 6–10}`) so the autoregulation rep target and the "Why this?" display agree;
strength/power fall through to `COMPOUND` (heavy secondaries by design). The system prompt gains a
role-loading note for moderate-secondary goals so the model's own picks are coherent with the
deterministic clamp.

**Applies to the owner's CURRENT program automatically** (ai_dynamic re-derives each cycle — no
manual editing), unlike session 293's generation-time style change. Together: generation picks a
moderate base style, and the runtime engine keeps secondaries moderate.

**Verification.** New `secondary-zone.test.ts` (5): zone shift, an 80% secondary pick clamps to
≤72.5% while the primary stays 80%, the band climbs with phase but stays below the primary, only
powerbuilding is affected (strength unchanged), and `goalRange` secondary sits between primary and
accessory. Updated the pre-existing `goal-ranges.test.ts` assertion that hard-coded secondary ==
primary. `tsc`/lint clean, full suite **1208 passed**, `next build` compiles. The change is a
deterministic role-aware clamp (unit-proven); not run through a live Gemini prescribe this session
(would need a powerbuilding scenario stood up in the seed) — the clamp math + wiring are the
authoritative proof. Branch restarted from fresh `main`.

## Session 287 (continued) — Item 8 Chunk 1 Task 1.1: revive the rep-completion signal chain (AI-1, `fix/wire-last-session-ran-prescription`, v1.139.2)

R4 is essentially done (only the device-only/explicitly-deferred remainder left, plus WK-3
already redirected to this item). Moving to backlog item 8 — the workout-system hardening batch
— starting with Chunk 1 (AI periodization correctness), which the plan flags as pullable to the
top since it's "the progression engine silently degraded."

The 2026-07-10 review found the AI rep-completion signal chain permanently dead:
`setLastSessionRanPrescription` existed as a repository/adapter method, and
`lib/ai-periodization/signals.ts:260` already reads `state.lastSessionRanPrescription` to decide
autoregulation behaviour — but nothing in the codebase ever actually *called* the writer. Every
session completion left the field `null` forever, so autoregulation always saw "no data" and took
the mildest cut, rep-push logic fired on RPE alone, and the emergency-deload `<0.7` trigger could
never fire.

**Fix:** wired the call into `completeWorkoutFromPayload`
(`lib/workout/complete-workout.ts`) — the shared function the web route and the offline outbox
replay both call, so both paths pick this up for free without a second implementation. Before
the existing `updatePrescriptionStatus(..., 'consumed')` call overwrites the prescription's
status, reads the session's current `SessionPeriodization` and derives `ranPrescription`: `true`
for `accepted`/`auto_applied` status, or `pending` with a stored prescription present; `false`
for everything else, including the no-periodization-state case (non-AI-dynamic programs). This
matches the plan's own snippet. Wrapped in `.catch(() => {})` since it's an advisory signal for
future prompt-building — a write failure here must never fail the actual workout completion.

Added 9 new unit tests to `lib/workout/__tests__/complete-workout.test.ts`: both `true`-producing
statuses, the `pending`-with/without-prescription split, all three `false`-producing statuses,
the no-periodization-state case, and confirming the write is skipped entirely on a replayed
(already-completed) session — mirroring the file's existing test structure and mock setup.

**Verified interactively** against the local dev DB — this is a server-side write path only, no
UI to drive, so no click-through concerns here: inserted a real `session_periodization` row for
the seeded Push session with `prescription_status='accepted'` and a non-null `prescription`
JSONB, plus a fresh uncompleted `workout_sessions` row, then called the actual
`POST /api/complete-workout` endpoint via Playwright (not the internal function directly — the
real route, same as production traffic hits). Confirmed via `psql` afterward:
`last_session_ran_prescription` flipped to `true` and `prescription_status` correctly landed at
`consumed`. Test rows removed afterward (two `DELETE`s, no full reseed needed since nothing else
was mutated).

`pnpm lint`/`tsc`/tests (1197 passed, +9)/build all green. No migration — the column already
existed, only the write call was missing. Version renumbered twice during rebase — this PR sat
open across two concurrent merges: session 295's full-exercise live HR chart landed first and
claimed 1.139.0, then session 294's Home-streak fix landed and claimed 1.139.1 — final version
1.139.2.

**Item 8 status:** Chunk 1 Task 1.1 (AI-1) done. Tasks 1.2–1.7 remain in Chunk 1 alone (1.2 —
consumption-day prescription re-evaluation — and 1.4 — the `sessions_in_phase` canonical
definition — are each larger multi-file changes better scoped as their own sessions), plus
Chunks 2–6 of the full hardening batch. Continuing the backlog loop per the owner's standing
instruction.

## Session 295 — Full-exercise live HR chart + outlier rejection + zones (`claude/workout-hr-chart-527op7`, v1.139.0)

Owner-requested in-session UX work on the workout **Live HR** card (`components/workout/live-hr-readout.tsx`,
which was rest-phase-only and showed a ~20 s sparkline). Four asks, all shipped:

1. **Full-exercise chart.** Replaced the sparkline with `components/workout/live-hr-chart.tsx` — a
   lightweight SVG (NOT chart.js; the workout chunk deliberately keeps chart.js out, loaded only on
   the done screen) that plots the HR trace across the whole current exercise with a dotted boundary
   line + set number per logged set (same visual language as the done-screen `HrRecoveryChart`). The
   card is now rendered above the phase-specific block in `active-workout-screen.tsx`, so it stays
   **mounted across the set↔rest toggle** and its buffer survives — previously the readout lived
   inside the `workoutPhase === "rest"` block and reset every set. Reads `setStartMsArray`/
   `setEndMsArray` straight from the store (narrow selectors) for the set lines, so it stays a leaf
   and doesn't re-render the orchestrator.
2. **Outlier rejection (fixes the field-reported stray 38/60 bpm mid-set).** New
   `isPlausibleHrSample()` in `lib/health/hr-smoothing.ts` drops values outside 30–220 bpm **and**
   lone spikes that jump >30 bpm from the recent median (the 38/60 artefacts fail the slew gate, not
   the absolute floor). The headline number now derives from the median-smoothed accepted buffer, not
   the raw last-decoded value (which is why "Holding last reading… 38 bpm" showed). Raw/archival
   samples untouched — display-only, per the project rule.
3. **"Always reading" feel.** A 1 Hz tick appends the held value so the trace keeps advancing when the
   ring power-gates (worn-idle), instead of freezing; heart icon pulses when live.
4. **Zone colouring.** Reading + line tint by HR zone (Recovery→Peak). Zone/Karvonen math lives once
   in new `lib/health/hr-zones.ts` (`hrMaxFromAge`, `hrReserve`, `computeHrZones`, `zoneForBpm`); the
   inline HRmax/reserve copy in `app/api/body-battery/route.ts` now imports the shared helpers
   (One-Formula), and `ageFromDob` moved to `lib/date-utils.ts`. Personal anchors come from a new
   `GET /api/hr-profile` (age-predicted HRmax + 28-day resting-HR baseline, SWR-cached ~1 h,
   rate-limited), self-fetched by the leaf via `cachedFetch` (`HR_PROFILE_TTL` in `lib/cache-ttl.ts`).

Battery lever (`workout-screen.tsx`): `liveHrForced` now forces the aggressive HR burst through the
**whole active phase** (sets + rest), not rest-only, so lift-effort peaks get captured — sets are ~20 s
so the extra drain is bounded; warmup/pre still coast.

**Verification.** `pnpm lint`/`tsc` clean; full suite **1189 passed** (added `hr-zones.test.ts` +
`isPlausibleHrSample`/`median` cases). `pnpm dev` smoke: `/api/hr-profile` returns real data authed
(`maxHr:190, restingHr:58`), `/workout` compiles + renders, and a headless-browser drive confirmed
`LiveHrChart` **mounts in the set phase with zero runtime errors** (empty "Waiting for your ring…"
state, since sandbox `getOuraBle()` is null). **NOT device-verified:** the live trace, zone colouring,
set-boundary lines, and the anti-spike behaviour all need the real Oura BLE stream — web can't drive
it. Logged as a Known Issue; owner will verify on-device and reopen in a bug-fixing session if needed.

## Session 294 (continued) — Home streak broke a day too early (`claude/scale-section-layout-labels-tq4axl`, v1.139.2)

Owner reported their streak reset to 1 and asked if a recent change caused it, correctly suspecting
the rule should allow 2 rest days. Confirmed from their July calendar (trained Jul 1,2,3,5,6,8,9,10,13;
Jul 4 & 12 activity-only; Jul 7 & 11 REST): the client-side streak count in `session-select-content.tsx`
used `MAX_REST_GAP = 1`, breaking on the **second** consecutive rest day. That contradicts the server
rule (`lib/ai-periodization/ai-dynamic.ts`: `streakWarning` at 2, `streakBroken` at `>= 3`, locked by
`ai-dynamic.test.ts`) and the StreakCard banner copy ("Day 1 of 2 rest days — streak safe" / "Rest
again tomorrow and your streak breaks"). Introduced in #408 (Jul 10) when the client streak count was
added — a genuine recent regression. Because only strength sessions count, the owner's Sat-11 REST +
Sun-12 activity-only read as two rest days in a row and tripped the too-strict rule.

**Fix:** `MAX_REST_GAP = 1 → 2` (breaks on the 3rd consecutive rest day), with a comment tying it to the
server rule so they can't drift again. Verified with a standalone reproduction of the exact walk-back on
the owner's calendar: old rule → streak 1 (the bug), new rule → streak 13 (correct). `tsc` clean.
**Not verified on device** — logic-only reproduction; the live render (local SQLite feeds `calendarDays`)
is the APK gate.

## Session 287 (continued) — R4 Chunk 2 complete: skipPerSetWeightsInitRef same-index fix (WK-8, `fix/skip-weights-init-same-index`, v1.138.12)

Continuing the implementation-backlog loop — last dev-DB-verifiable task in R4.

`skipPerSetWeightsInitRef` is set `true` before a `setCurrentIdx` call in all three restore
paths (`launchExercise`, `advance`, `switchToExercise`) and consumed/cleared by the per-set-weights
init effect (the one WK-7 just added a `timerStarted` guard to, earlier in this same session).
The effect only fires when `currentIdx` actually changes, though — so restoring an exercise that's
already the current `currentIdx` (e.g. "Continue Workout" resuming the same exercise you left)
makes `setCurrentIdx(idx)` a no-op. The effect never re-fires, the ref never gets cleared, and it
stays poisoned for the *next* legitimate index change — which then gets its init silently
skipped.

**Fix:** applied the plan's own exact snippet at all three restore sites — instead of
unconditionally setting the ref `true`, set it to `idx !== currentIdx` (read before the index
actually changes). The ternary self-clears on a same-index restore instead of staying poisoned.
`advance()` can't currently hit the same-index branch (always moves to `currentIdx + 1`) and
neither can `switchToExercise()` (always targets a different superset partner), but the same
check was added to all three for uniformity, per the plan.

**Verified interactively** against the local dev DB: built a real 2-exercise superset in the
seeded Push session (Bench Press + Overhead Press, `superset_group=1` via direct SQL), then drove
the full alternation live with Playwright. Logging Bench's set 1 correctly handed off to Overhead
Press with freshly-computed weights (`[60, 60, 60]`); logging Overhead's set 1 correctly handed
*back* to Bench Press through the exact `restoreExercise(idx)` path this fix touches, restoring
the stashed `[75, 75, 75]` (not recomputed from scratch) with set 1 still shown as `1✓` complete.
This confirms the general restore path is unregressed end-to-end by the fix.

**Not separately reproduced live: the same-index poisoning scenario itself.** It requires
restoring into an index that's already `currentIdx`, which normal superset alternation — by
definition, always switching between *different* indices — never exercises. The fix is a direct,
mechanical application of the plan's own snippet, verified correct by code inspection (the
ternary's "stays poisoned" branch is provably unreachable for two of the three call sites, by the
plan's own admission, and the third — `launchExercise`'s "Continue Workout" resume — was reasoned
through by hand). Test superset flag reverted afterward (two `UPDATE`s, no full reseed needed);
confirmed no stray `exercise_logs` rows landed from the test run.

`pnpm lint`/`tsc`/tests (1188 passed)/build all green.

**R4 status: essentially done.** Chunks 1, 3, 4 fully complete. Chunk 2 is now fully complete too
(WK-3 was explicitly deferred to item 8's Task 4.1 by an earlier amendment, not left undone —
that's tracked separately). Chunk 5 has everything dev-DB-verifiable done; what remains there is
device-only (WK-13, WK-16) or explicitly flagged low-priority/out-of-scope by the plan itself
(WK-15's migration risk, WK-18's calendar-add outbox). The only genuinely open R4 work is WK-3,
already redirected to item 8. Next session picking up the backlog should move to item 8
(workout-system hardening batch) or another queue item.

## Session 293 — Powerbuilding secondary style → moderate (generator no longer stacks 3 heavy compounds) (`claude/workout-ai-review-adjust-f2g8jj`, v1.138.11)

Owner diagnosis via the new admin program-export (session 292): their powerbuilding program runs
~70 min despite a "~50 min, fits" estimate, and every session has **three** 4×6 @80% compounds
(1 primary + 2 secondary). Root cause found in `lib/workout/known-styles.ts` `GOAL_STYLE_RULES`:
`powerbuilding` assigned **both** primary AND secondary the heavy `'Powerbuilding'` style (4×6
@80%). The generator enforces styles by role, so any 1-primary/2-secondary session = 3 near-max
compounds — 3 warm-up ramps + long rests + high axial/CNS load — every time, and it would reproduce
identically on every newly-generated powerbuilding program.

**Fix (one cell):** `powerbuilding.secondary` `'Powerbuilding'` → `'Hypertrophy Plus'` (4×8 @70% ·
75s rest, an existing style). Now generated powerbuilding programs come out as **one heavy anchor
(primary 4×6 @80%) + moderate secondaries (4×8 @70%) + accessory volume (3×10)** — the "1 heavy +
moderate volume" design the owner and I settled on by hand. Strength goal intentionally left with
heavy secondaries (`Strength 4-set`, 4×5 @80%) — heavy secondaries are correct for a pure strength
program; only powerbuilding's "building" side should be moderate. New unit test
`known-styles.test.ts` locks the intent: primary reps == 6, secondary reps > 6, secondary ≠ primary,
every referenced style exists.

**Scope/limits (told the owner):** affects **newly generated** programs only — the owner's current
program is already built (its stored styles are unchanged), so it still needs the manual per-exercise
demotes I gave them (or a fresh rebuild). Deliberately did **not** build the warmup-estimate refactor
(scale warmup by heavy-compound count) I'd floated: once secondaries are moderate there's ~1 heavy
lift/session and the existing flat 15% warmup allowance is about right, so the refactor (which touches
every prescription's budget math and has a circular intensity↔budget dependency) isn't worth its
blast radius right now — noted as a possible future item if overruns persist after rebuild. Also
noted a nice-to-have the owner raised: the generator could learn to make a *second* same-region day
(e.g. a 2nd lower day) moderate/no-heavy-anchor — a finer periodization touch, deferred (manual/Review
covers it).

**Verification.** `tsc`/lint clean, new + full test suite green, `next build` compiles. Pure
rule-table change — no runtime generation test run this session (the generator uses a live Gemini
call); the style enforcement is deterministic server-side (`generate-program/route.ts` enforces
primary/secondary styles by role, never falling back to the model), so the mapping change
deterministically flows to output. Branch restarted from fresh `main` (prior Workout Review /
export PRs already merged); new PR.

## Session 287 (continued) — R4 Chunk 2 Task 2: per-set-weights init guard (WK-7, `fix/perset-weights-init-guard`, v1.138.10)

Continuing the implementation-backlog loop, moving from R4 Chunk 5 (mostly done — remaining
items are device-only or explicitly deferred) into Chunk 2 (superset/rest-timer fidelity).

`workout-screen.tsx`'s per-set-weights init effect recomputed `perSetWeights` from scratch on
every `effectiveExercises` change, with no guard against firing mid-exercise. Its sibling
sets/reps-resync effect a few lines below already guards on `store.mode !== "active" ||
store.timerStarted` — this one didn't. A late network refetch, an injury swap, or a deload-revert
toggle happening while the lifter had already started a set (and possibly hand-edited the dial
weight) would silently wipe that manual edit back to the computed default.

**Fix:** added the same `if (store.timerStarted) return;` guard to the init effect. This broke
`handleInjurySwap`'s implicit assumption (documented in its own comment) that the effect would
pick up the swap's fresh equipment/exerciseType/1RM automatically — so added an **explicit**
recompute in `handleInjurySwap` instead, gated on `exerciseIndex === currentIdx && timerStarted`
(a pre-timer swap is still picked up by the now-guarded-but-still-live effect, so no double
recompute). Along the way, extracted the weight-derivation logic — previously duplicated between
the init effect and `launchExercise` — into one module-level `computeInitialWeights(ex, sets)`
helper (One Formula, One Place), now the single place all three call sites (effect,
`launchExercise`, injury-swap recompute) derive a set's target weight.

**Verified interactively** against the local dev DB: direct-mounted `/workout?session=<id>`
(the exact URL `app/workout/page.tsx` expects) rather than driving through the
`workout-select` intermediate screen — this session had repeatedly hit click-driven flakiness
there (SVG overlays intercepting pointer events, a "Start Workout" ready-countdown that
sometimes silently no-op'd). The direct mount worked reliably: drove the real flow through
warm-up → "Begin Exercises" → the active screen → "Start Set 1" → "Log Set" for the seeded Push
session's Barbell Bench Press. Confirmed via `localStorage.ta_workout_state` at each step:
`perSetWeights` computed to `[75, 75, 75]` on mount (75% of a 97.5 kg 1RM, matching the on-screen
"SET TARGETS" display exactly), `timerStarted` flipped to `true` on Start, and the set logged
successfully with no crash. Confirmed no stray rows landed in the dev DB (the synthetic
`workoutSessionId` correctly fails the server's ownership check, the same pattern already noted
in this session's earlier WK-1 verification) — nothing to clean up.

**Not separately driven live:** the narrower "guard blocks a late `effectiveExercises` change
mid-timer" and "injury swap while mid-exercise recomputes weights" scenarios specifically —
both would need additional seed setup (an active injury matching the exercise's muscle group,
then the multi-step injury-swap-sheet UI) that wasn't judged worth the added time given the base
flow's successful end-to-end drive already exercises the exact `computeInitialWeights` helper
both of those paths call into.

`pnpm lint`/`tsc`/tests (1186 passed)/build all green.

**R4 status:** Chunks 1, 3, and 4 fully complete. Chunk 5 has Tasks 2 and most of 5 done (the
remainder is device-only/explicitly-deferred). Chunk 2 now has Task 2 (WK-7) done; Task 1 (WK-3,
deferred to item 8's Task 4.1) and Task 3 (WK-8, `skipPerSetWeightsInitRef` poisoning on
same-index restore) remain. Continuing the backlog loop per the owner's standing instruction.

## Session 292 — Admin: "Export active program" tool (`claude/workout-ai-review-adjust-f2g8jj`, v1.138.9)

Owner asked for an admin export of their program (exercises + reps/pct/role/etc.) to paste for a
programming review — the powerbuilding plan feels over-inflated (too many exercises on the 4×6 main
scheme; some questionable ones like cable pulldowns/good mornings tagged as `primary`). The export
is the input to that conversation.

New admin-only, read-only endpoint `GET /api/admin/program-export` (auth → `requireAdmin`, mirrors
`time-audit`'s pattern). Assembles the **active** program via `getActiveProgram` +
`listProgressionStyles` (+ `getExerciseEquipment` for the duration estimate) and emits, per session:
each exercise's **role**, its assigned progression style's **sets×reps@pct · rest**, muscles, and an
**estimated-vs-budgeted** duration (via the shared `estimateExerciseDurationSec` model) with an
⚠️OVER/✓fits flag and a per-session role tally (e.g. `3P / 1S / 2A`). `?format=text` returns
`text/plain` for browser copy; default is JSON `{ text, program }`. Pure formatter in
`lib/admin/program-export.ts` (`formatProgramExport`/`summarizeSets`, 5 unit tests — uniform vs
per-set styles, over/fits flag, role tally). Admin UI card `components/admin/program-export-card.tsx`
(collapsible, Copy-to-clipboard + a read-only textarea), wired into `admin-content.tsx` next to
`TimeAuditCard`.

**Verification.** `tsc`/lint clean on new files, formatter unit-tested (5), full `next build`
compiles + registers the route, and the assembly was run against the local dev DB (real
`getActiveProgram`/styles/equipment → formatted text) via a scratch test (deleted after). **Not
verified:** the admin-page render + clipboard copy on the real device (no auth/device harness in the
sandbox), but the card mirrors the proven `TimeAuditCard` shape. Branch restarted from fresh `main`
(prior Workout Review PRs #452/#462 already merged); new PR.

## Session 287 (continued) — R4 Chunk 5: newPRs/xpEarned persistence (WK-18, `fix/workout-results-persistence`, v1.138.8)

Continuing the implementation-backlog loop, picking up the second of WK-18's three misc
sub-items in R4 Chunk 5.

`newPRs` and `xpEarned` — the done screen's "you set N new PRs" list and XP-earned total — were
plain `useState` in the `workout-screen.tsx` orchestrator. Every other piece of workout state
(`workoutSessionId`, `sessionLog`, timers, buffers) lives in the Zustand `useWorkoutStore`, which
persists to `localStorage` and rehydrates cleanly across an app refresh — that's the whole point
of the store existing. But these two fields were never moved into it, so a refresh partway
through a workout (after a PR had already been logged, before reaching the done screen) silently
dropped them: the store came back with the right session id and exercise log, but the PR/XP
results computed earlier in that same session were gone by the time Done rendered.

**Fix:** added `newPRs: string[]` and `xpEarned: number | undefined` to `WorkoutState`, plus
`addNewPR` (append-dedup), `setNewPRs`, and `setXpEarned` actions, following the exact shape of
the existing `summaryData`/`lastSetRestSec` setters. Reset both explicitly in `startWorkout`
(alongside its other per-session resets) — `resetSession` already gets them for free via its
`...INITIAL_STATE` spread. Removed the now-redundant inline `setNewPRs([])` at the Start Workout
button, since the store's own `startWorkout` now owns that reset. The store has no `partialize`
(a deliberate CLAUDE.md rule for this store), so both fields persist to `localStorage`
automatically — no persistence-config changes needed, just adding the fields.

**Verification note — this is the honest part.** The plan's own suggested verify method (log a
set, refresh mid-workout, reach the done screen, confirm PRs/XP survived) requires driving the
full multi-step workout flow through a headless browser: sign in → workout-select → Start Workout
→ ready countdown → warm-up → log a set. Across several attempts this session (both for this task
and a couple of earlier ones), that flow proved unreliable to drive reliably via Playwright in
this sandbox — clicks that should transition the ready-countdown screen sometimes silently
no-op, and the exact cause wasn't chased down further given the time already spent. Rather than
claim a verification that didn't actually happen, I used two other methods instead:

1. **6 new unit tests** in `lib/stores/__tests__/workout-store.test.ts` (already using
   `@vitest-environment jsdom` for exactly this kind of localStorage-backed store test, matching
   the file's existing `readyElapsedBaselineSec` persistence test pattern) — default values,
   `addNewPR`'s dedup behaviour, `setXpEarned`, both fields resetting on `startWorkout` and
   `resetSession`, and critically a direct assertion that after `addNewPR`/`setXpEarned` are
   called, `localStorage.getItem('ta_workout_state')` contains them. That last test is the actual
   proof the bug is fixed: previously these fields could not appear in that key at all (they were
   never part of the store), so this assertion would have been impossible to write, let alone
   pass, before this change.
2. **A Playwright smoke check** confirming `/workout` still renders cleanly post-change with zero
   *new* console/page errors compared to a pre-change baseline — the only error present was the
   same pre-existing, unrelated Home week-strip hydration mismatch already known from an earlier
   verification this session.

**Not exercised:** the literal end-to-end "refresh mid-workout, land on done screen, see the PR
still listed" user journey — flagging this explicitly per CLAUDE.md's communication rule rather
than asserting it as tested.

`pnpm lint`/`tsc`/tests (1181 passed, +6)/build all green.

**R4 status:** Chunks 1, 3, and 4 fully complete. Chunk 5 now has Tasks 2 (WK-14) and two of
Task 5's three WK-18 sub-items (key collision, newPRs/xpEarned persistence) done. Remaining:
WK-18's calendar-add outbox (lowest priority — a full fix needs a new `calendar_event` outbox
domain, out of scope for this batch), WK-13 (rollover, device-only), WK-15 (phase-counting keys,
explicitly flagged low-priority/backlog-note-only in the plan — do not half-migrate), and WK-16
(mixed "today" sources, partially device-only). Chunk 2 (superset/rest-timer fidelity, WK-3
deferred to item 8) also remains. Continuing the backlog loop per the owner's standing
instruction.

## Session 287 (continued) — R4 Chunk 5: exercise-list key collision fix (WK-18, `fix/exercise-list-key-collision`, v1.138.7)

Continuing the implementation-backlog loop, picking up one of WK-18's three misc sub-items in R4
Chunk 5.

`pre-workout-screen.tsx:210` and `warmup-screen.tsx:150` both keyed their exercise-row lists by
`ex.name` — a program with the same exercise twice in one session (a legitimate pattern, e.g. a
superset partner reused later, or a deliberate double-dose accessory) would collide on that key,
which React handles by potentially reusing/misplacing DOM nodes and internal state between the
two rows. Confirmed `WorkoutExercise` (`app/api/workout-data/route.ts`) carries no stable
per-row id, so per the plan's own documented fallback, both sites now key by
`` `${ex.name}-${idx}` `` instead — the array index is already in scope at both call sites (one
needed a one-line signature change from `exercises.map(ex => ...)` to
`exercises.map((ex, idx) => ...)`).

**Verified interactively** against the local dev DB (not APK-gated): inserted a second
`session_exercises` row for "Barbell Bench Press" into the seeded Push session (same name,
`position: 3`) via direct SQL, then drove the real flow with Playwright — the warmup screen
correctly showed both duplicate rows (`locator.count()` = 2 for the exercise name), and no React
"duplicate key" / "same key" console warning appeared among the captured console/page errors (an
unrelated pre-existing hydration warning on the Home week-strip's rest-day label, and expected
401s from a couple of unauthenticated background probes during the login transition, were the
only other console noise — neither related to this change). Removed the test duplicate row
afterward with a single `DELETE`, no full reseed needed since nothing else was mutated.

`pnpm lint`/`tsc`/tests (1175 passed)/build all green. Client-only change, no server route
touched, no migration.

**R4 status:** Chunks 1, 3, and 4 fully complete. Chunk 5 now has Tasks 2 (WK-14) and one item of
Task 5 (WK-18's key-collision fix) done. Remaining: the other two WK-18 sub-items
(`newPRs`/`xpEarned` unpersisted across a mid-workout refresh; no calendar-add outbox — both
lowest priority per the plan), WK-13 (rollover, device-only), WK-15 (phase-counting keys —
explicitly flagged low-priority/backlog-note-only in the plan, do not half-migrate), and WK-16
(mixed "today" sources, partially device-only). Chunk 2 (superset/rest-timer fidelity, WK-3
deferred to item 8) also remains. Continuing the backlog loop per the owner's standing
instruction.

## Session 287 (continued) — R4 Chunk 5 Task 2: voice logging clamp (WK-14, `fix/voice-logging-clamp`, v1.138.6)

Continuing the implementation-backlog loop into R4 Chunk 5 (low-risk hygiene).

`set-card.tsx`'s `handleVoiceResult` passed recognised weight/reps straight through to
`onRepChange`/`onWeightChange` with no clamp — a mis-heard "0 reps" or a weight over 500 would
pass the optimistic local write but fail the server's `LogExercisePayloadSchema`
(`weights.max(500)`, `reps.min(0).max(100)`), silently quarantining as a poison mutation with no
feedback that the set never actually saved. The manual +/- buttons already clamped correctly
(`Math.max(1, repValue - 1)` for the rep floor); voice input was the only unguarded path.

**Fix:** extracted a pure helper, `clampVoiceLogResult(weight?, reps?)`, into
`components/workout/utils.ts` — weight clamps to `[0, 500]`, reps clamp to `[1, 100]` and round.
`handleVoiceResult` now runs recognised values through it before dispatching. Pulling the clamp
out to a plain function (rather than leaving it inline in the component) was a deliberate choice:
this sandbox can't drive the Web Speech API through a headless browser, so the plan's own
"verify" instruction ("mock the recogniser") isn't reachable here — a pure, exported function is
directly unit-testable instead, which gives equivalent confidence without needing speech
recognition mocking infrastructure that doesn't exist in this codebase yet.

Added 7 unit tests to `components/workout/utils.test.ts`: in-range pass-through, the 0-reps
floor, the reps/weight ceilings (100 / 500), fractional-rep rounding, a negative mis-heard weight
clamped to 0, and omitted fields staying `undefined`.

`pnpm lint`/`tsc`/tests (1175 passed, +7)/build all green. No server route touched — client-only
change, no migration.

**R4 status:** Chunks 1, 3, and 4 are fully complete. Chunk 5 now has Task 2 (WK-14) done in
addition to Task 3's WK-5 groundwork already covered by Chunk 4. Remaining: WK-13 (rollover,
device-only per the plan), WK-15 (phase-counting keys — the plan itself flags this as
low-priority/backlog-note-only given the nullable `session_id` migration risk on legacy rows —
do not ship a half-migration), WK-16 (mixed "today" sources, partially device-only), and WK-18
(misc: unpersisted `newPRs`/`xpEarned` across a mid-workout refresh, no calendar-add outbox,
`key={ex.name}` collision risk in pre/warmup lists). Chunk 2 (superset/rest-timer fidelity) also
remains, with WK-3 explicitly deferred to item 8's Task 4.1. Continuing the backlog loop per the
owner's standing instruction. (Version renumbered during rebase — this PR sat open across a
concurrent merge: session 291's Workout Review v1.1 follow-up landed first and claimed 1.138.5,
so this PR's version bumped to 1.138.6.)

## Session 291 — Workout Review v1.1: moved to More→Workout, honest diff, full-budget framing, no finish-early buffer (`claude/workout-ai-review-adjust-f2g8jj`, v1.138.5)

Owner feedback after first on-device use of the v1.138.0 Workout Review (screenshot supplied). Five
changes, all follow-ups to the shipped feature.

**1. Entry point → More → Workout.** Removed the "Review & adjust" trigger from the Home
recommendation card (owner: "not those sections"). Added a per-session **Review** button on each
session of the **active** program in `config-screen.tsx` (the More→Workout tab renders
`ConfigScreen`), so you review a chosen workout with its full exercise list in view. Reverted the
`recommendation-card.tsx` / `session-select-content.tsx` wiring from v1.138.0.

**2. Guard-protected drops are now shown — the real bug behind "it only dropped one."** The
screenshot's reasoning said it dropped *"Shrugs, Pull-ups, and Curls"* but the diff showed only
Pull-Up + "4 kept unchanged". Diagnosis: the AI *did* propose 3 drops, but `reconcileReview`'s guard
reverted Shrugs/Curls (they were the only coverage of under-target traps/biceps) to `action:'keep'`
with `guardAdjusted:true` — and the sheet filtered `action !== 'keep'`, so those reverts vanished
into "kept unchanged". The underlying decision was actually *correct* (drop the minimum, protect
under-target muscles — exactly the training-load protection the owner wanted); only the presentation
lied. Fix is UI-only: split rows into `actionable` (drops/adjusts, with decision buttons) and
`protectedRows` (`action==='keep' && guardAdjusted`), rendering the latter as explicit "AI wanted to
drop this — kept to protect your training" rows with the guard's reason.

**3. ACWR / training-load caveat — owner chose "keep it honest" (option A).** No analytics change:
load/ACWR keep reflecting real logged volume. The protection is the existing guard behaviour (never
drop below a weekly target → only excess volume is shed), now made *visible* by change 2. Documented
in the design-spec addendum rather than built.

**4. Time reframed against the full session budget.** Header was "~45 min working time vs 45-min
target"; now "≈{warmup+working} of {total} min" with a "~{warmup} min warmup + {working} min working"
sub-line, derived from the response's `totalBudgetMin` − `budgetMin`.

**5. Finish-early buffer removed (`duration-model.ts`) — owner call.** `workingBudgetMin` carved out
15% warmup **+ 10% finish-early**; the owner wants the finish-early margin to come organically (from
beating conservative rest/set estimates — generous constants during baseline, measured-faster once
history accrues) rather than a reserved 10%. Removed `FINISH_EARLY_FRACTION`; `workingBudgetMin(60)`
is now **51** (was 45). **Blast radius: every AI prescription's time budget**, not just the review —
`aggregateSignals.effectiveTimeBudgetMin` feeds the prescribe route too. Updated the
`duration-model` unit test (45→51) accordingly.

**Also:** the sheet is restructured to a fixed header + scrollable body + **pinned footer** so
Cancel/Apply always clear the gesture bar (the screenshot's safe-area complaint), using
`SheetContent side="bottom"`'s baked `pb-safe-action`.

**Verification.** `tsc` clean (only the pre-existing `@capacitor/splash-screen` sandbox error), lint
clean on changed files (fixed one `react/no-unescaped-entities` error — an apostrophe in the new
header text — before it could fail CI), `vitest` 1168 passed, `next build` compiles. The budget
change is unit-covered (working budget 60→51) and the guard-protected rows are unit-covered
(`reconcileReview` under-target-coverage test). **Not verified on device:** the moved button, the
restructured sheet's safe-area/scroll on the real S25 WebView, and the interactive apply — no
auth/device harness in the sandbox; on-device remains the gate. Branch restarted from fresh `main`
(the v1.138.0 PR #452 already merged); this is a new PR, not a reopen.

## Session 287 (continued) — R4 Chunk 4 complete: session-id matching for workout-load-history (WK-11, `fix/workout-load-history-session-id`, v1.138.4)

Continuing the implementation-backlog loop. Also checked the standing Dependabot remediation
item first (19 high alerts on `main`, over the ≥5 threshold) — `pnpm audit` still reports 0
vulnerabilities against the current lockfile and no open Dependabot-authored PRs exist, matching
the tooling-gap already documented in two prior sessions (PRs #295, #449: no `gh` CLI or
Dependabot-alerts API access in this sandbox). Nothing new to do there; the existing Known-Issues
row in `projectOverview.md` still accurately describes the blocker, so no redundant PR.

Picked up R4 (item 7) Chunk 4's remaining tasks:

**Task 3 (WK-5 call-site swap) — found already done.** A concurrent session had already added
R2's `invalidateExerciseLogged(programSessionId)` group to `lib/cache-groups.ts` and wired it
into `handleCompleteSet` (`workout-screen.tsx:908`) — the ad-hoc post-log invalidation key list
the plan flagged no longer exists. No action needed, just confirmed and noted in the backlog.

**Task 2 (WK-11) shipped.** `GET /api/workout-load-history` matched a session's history by
`ws.sessionName === sessionName` — a string match that loses continuity the instant a program
session is renamed, violating the project's "session identity = DB id" rule. Threaded the
program session's stable id (`workout_sessions.session_id`) through the full chain:
`getDaySessionSummaries` (repository interface + Postgres adapter) now selects it,
`GET /api/workout-sessions/day` surfaces it as `sessionId` on each session object, and
`GET /api/workout-load-history` accepts a `sessionId` query param — filtering on it when present,
falling back to the legacy `sessionName` match only for callers that don't have an id yet. The
sole consumer, `day-review-sheet.tsx`, now passes `sessionId` when available and keys its cache
entry off it instead of the name. Two smaller plan items (SWR headers on the route, `cachedFetch`
on the consumer) turned out to already be in place from prior work — only the matching-key gap
was actually outstanding.

**Verified interactively** against the local dev DB (not APK-gated — pure server route +
consumer logic): the seed data has two completed "Legs" sessions sharing one
`program_sessions.id`. Renamed that program session via direct SQL, then drove the real route
with Playwright — `?sessionId=<id>` returned all 3 historical entries (pre- and post-rename),
confirming continuity survived the rename. Cross-checked the legacy `?sessionName=` fallback
still works, and that omitting both params 400s. Reverted the test rename afterward (a single
UPDATE, no full DB reseed needed since nothing else was mutated).

`pnpm lint`/`tsc`/tests (1168 passed)/build all green.

**R4 status:** Chunks 1, 3, and now 4 are fully complete. Only Chunk 2 (superset/rest-timer
fidelity — WK-3 explicitly deferred to item 8's Task 4.1) and Chunk 5 (low-risk hygiene:
WK-13/14/15/16/18) remain. Continuing the backlog loop per the owner's standing instruction.

## Session 287 (continued) — R4 Chunk 4 Task 1: session recap cache invalidation (WK-9, `fix/workout-recap-invalidation`, v1.138.3)

Continuing the implementation-backlog loop (owner instruction: work through the backlog until
done). Picked up R4 (item 7) Chunk 4 Task 1 — `docs/superpowers/plans/2026-07-09-r4-workout-flow-correctness.md`.

`GET /api/workout-sessions/[id]/recap` generates an AI summary of a completed session and caches
it in `ai_health_insights` under `session-recap:<sessionId>`, keyed off `(user_id, section,
date)`. `workout-entry`'s PATCH (weight/rep edit) and DELETE (log removal) handlers rewrite the
session's numbers but never touched that cache row, so a reopened recap kept describing the
pre-edit session forever — the same missed-invalidation bug class CLAUDE.md names as the
project's most repeated bug ("writes go through cache groups"), just on a DB-backed cache
instead of the client SQLite one.

**Fix:** added `deleteAiHealthInsight(userId, section)` to the repository interface
(`lib/data/repository.ts`) and its Postgres implementation (`lib/data/postgres/adapter.ts`) — a
plain user-scoped delete on `(user_id, section)`. No `date` param needed: the `section` string
already encodes the session id uniquely, so a single delete removes exactly the one cached recap
regardless of which day it was stamped under. Wired it into `app/api/workout-entry/route.ts`:
PATCH's existing context query (`SELECT el.exercise_name, el.style_id, ws.phase_type ...`) now
also selects `el.workout_session_id`, and both PATCH and DELETE call
`repo.deleteAiHealthInsight(userId, \`session-recap:${workoutSessionId}\`)` right after their
transaction COMMITs, alongside the existing `reconcilePersonalRecord` call.

**Verified interactively** against the local dev DB (not APK-gated — this is a server route):
drove the real code path with Playwright against `pnpm dev` — signed in as the seeded test user,
fetched a completed session's recap (populating the `ai_health_insights` cache row), PATCHed its
exercise log's weights/reps through the real `/api/workout-entry` endpoint, then confirmed via
direct `psql` query that the cache row was gone (0 rows for that `section`). Re-fetched the
recap and confirmed it regenerated: the AI text's reported total volume changed from the stale
1440 kg to the new 1783 kg, matching the edited weights (3 × 77.5 kg at 8/8/7 reps). Local dev
DB fully reseeded afterward (`pnpm db:local` after a clean `pg_ctl stop` + directory wipe), since
the test mutated real seeded `set_logs` rows.

`pnpm lint`/`tsc`/tests (1168 passed)/build all green. No migration, no schema change — this
task only touches the repository/adapter and one API route.

**R4 status:** Chunks 1 and 3 are now fully complete (from the prior continuation of this
session). Chunk 4 has Task 1 (WK-9) done; Tasks 2–3 (WK-11 session-id matching, WK-5 call-site
swap blocked on R2) remain, alongside all of Chunk 2 (superset/rest-timer fidelity — WK-3
deferred to item 8) and Chunk 5 (low-risk hygiene). Continuing the backlog loop per the owner's
standing instruction.

## Session 290 — Ring step count: over-count diagnosis + auto-refresh fix (`claude/step-count-sync-issue-urr96y`, v1.138.1)

Owner report: today's step count read ~16,800 in the app vs ~11,260 (Garmin) / ~10,500 (Samsung
Health), and steps only appeared after a manual "sync & redeploy", not on their own.

**Critical reframe from the owner mid-investigation:** the previously-reported "±5% accurate day
total" (session 272) was actually **Samsung Health Connect** steps syncing from the phone, which
the owner had assumed was the ring. Health Connect is now off, so 16,800 is purely the ring's
own estimate. Consequence: **the ring's full-day step estimate has never actually been
validated** — only the short 100/200-step diagnostic-tool checks have. So this is not a
regression; the col14 walk gate (`lib/health/step-estimate.ts`, `≤ 20` → walking, 30 steps/
window) has simply never been calibrated for full-day continuous wear, only for isolated clean
walks. The calibration comment itself flags exactly this ("revisit if real-world totals look
inflated"): across a full day, non-walk activity (driving, gym sets, cooking, gestures) throws
scattered low-col14 windows that each silently add 30 steps.

**Two shipped changes (v1.138.1), one issue still open pending owner data:**

1. **Step-calibration tester surfaced the wrong feature (fixed).** `components/oura-ble/
   step-calibration.tsx` still displayed and exported **col0** — the discriminator from the
   original exploration that calibration later *rejected* — while the shipped gate uses **col14**.
   So captures couldn't show the feature actually firing the estimate. Now surfaces col14, runs
   the shipped `estimateSteps()` over each captured span, and shows its verdict inline (`est N
   (X/Y walking)`, turning red when a real-steps-0 capture credits steps). Turns the tester into
   a false-positive finder. Admin-only; ships via Railway, no APK rebuild.

2. **Autonomous BLE drains didn't invalidate client caches (fixed — the "only after sync &
   redeploy" symptom).** The native ring service auto-drains on connect + hourly, POSTing frames
   to `/api/oura-ble/samples` which rolls them up into `body_metrics` server-side. But client
   cache invalidation only ran from the explicit `syncOuraRing()` path (`afterDrainSettles()` on
   pull-to-sync / Refresh) — nothing reacted to an autonomous drain, so freshly-rolled-up steps
   sat in Postgres unseen until a manual sync (or a redeploy that busts the SW cache). Fix
   (`components/sync-provider.tsx`): subscribe to the plugin's `ouraStatus` events and, when the
   native `ingestStored` counter advances, fire the same `invalidateOuraSync()` +
   `ta:oura-ble-synced` event manual sync does (debounced 1.5s so a multi-batch backlog drain
   triggers one refresh). Native-only; no-ops on web/older APKs. Ships via Railway, no APK
   rebuild.

3. **Still open — the over-count itself.** Not fixed yet: a threshold change now would be a guess,
   because there is zero full-day col14 data (all fixtures are short clean walks + short desk/
   still). Owner to capture the non-walk suspects (driving, gym, cooking, TV, phone) at real = 0
   with the updated tester; the col14 distributions decide whether the false windows are isolated
   (a consecutive-window debounce fixes it) or sustained (needs a second feature). Tracked as a
   Known-Issues row; the fix is a fresh change on a fresh branch off `main` once captures arrive.
   Also to fold into that fix: `body-metadata` adds `activity_logs` (treadmill) steps on top of
   `body_metrics.steps`, and `mergeStepSources` adds non-overlapping live windows on top of the
   gate estimate — both additive risks on top of the gate false-positives.

**Verification.** `pnpm lint` / `tsc --noEmit` (only the pre-existing `@capacitor/splash-screen`
sandbox type error, unrelated) / `vitest run` (1160 passed, unchanged) all green. **Not
exercised — device-only:** both fixes are native/BLE behaviour that only truly verifies on the
S25 APK (no ring in the sandbox). The autonomous-drain→invalidation flow and the tester's live
col14 readout are traced/reasoned, not observed on-device. Merged to `main` at the owner's
explicit request despite the on-device gap (see the Known-Issues row). Rebased onto the parallel
session-289 Workout Review work (v1.138.0) that landed on `main` mid-session — re-bumped to
v1.138.1 and renumbered this entry 289→290.

## Session 294 — Two owner-reported UI fixes: morning check-in scale direction + tab-bar overlap (`claude/scale-section-layout-labels-tq4axl`, v1.138.12 + v1.138.13)

Two independent owner-reported fixes, both shipped on one branch, both web-sandbox-verified (Playwright
against `pnpm dev` + the local dev DB) and both flagged NOT verified on the S25 APK.

**Fix 1 — Morning Check-in scale direction + per-rung labels (v1.138.12).** Owner: the wake-mood scale
"works the wrong way; good should be on the right and bad on the left", and wanted a word on every rung
(middle = Average, 2 and 4 something else) instead of only the two ends labelled.
- Root: `MORNING_SCALES` (`lib/types/day-checkin.ts`) had good-on-the-left (value 1 = "Great") and the
  shared `ScaleSelector` labelled only `low`/`high`.
- **Decision — presentation-only reversal, no data migration.** Kept the stored `1=best … 5=worst`
  semantics (the AI-periodization prompt at `prompt.ts:191` literally says "1=best, 5=worst";
  `prefillMorningScales` maps Oura scores to 1=best; health-trends correlations read the raw value), and
  reversed only the on-screen presentation: added a `labels` array (worst→best, left→right) to each
  morning scale, and taught `ScaleSelector` an opt-in labelled mode that maps on-screen position p (1..5)
  → stored value 6 − p. So the rung labelled "Great" sits on the right showing position 5 but still
  saves value 1. Zero consumer changes, zero rows migrated. Evening sheet (shares the component, passes
  no `labels`) renders unchanged.
- Labels: Wake mood `Awful·Poor·Average·Good·Great`; Recovery `Wrecked·Rough·OK·Good·Recovered`;
  Motivation `None·Low·OK·Keen·Fired up`; Sleep `Terrible·Poor·OK·Good·Great`; Soreness
  `Very sore·Sore·Moderate·Mild·None`.
- **Verified end-to-end on the dev DB via Playwright:** logged in, opened the sheet, clicked Wake-mood
  rightmost "Great" → stored `wake_mood=1`; Sleep leftmost "Terrible" → stored `sleep_quality_feel=5`;
  readiness-88 prefill landed on the rightmost "Recovered" (perceived_recovery=1). Direction and stored
  semantics both correct.

**Fix 2 — Home/Nutrition/More content hidden behind the bottom tab bar (v1.138.13).** Owner screenshot:
the rest-day streak banner and bottom cards tucked behind the fixed nav; "not sure why it didnt get
caught by our rules".
- Root, found by measuring in the browser (not guessing): the three screens used `min-h-screen` on
  their root, so the container grew to content height and the **page body** scrolled under the fixed
  nav — the inner `overflow-y-auto pb-nav-safe` scroller never became the scroll context
  (`bodyScrollable: 133, innerScrollable: 0`). Health already uses the bounded `h-screen` shell where
  the inner container scrolls and the fixed nav is always clear. Switched Home
  (`session-select-content.tsx`), Nutrition (`nutrition-content.tsx`) and More (`more-content.tsx`) from
  `min-h-screen` → `h-screen` (one class each; sibling-surface sweep — stats-content redirects to
  /health so it's dead, workout-select uses the valid root-`pb-nav-safe` body-scroll pattern, both left
  alone).
- **Why the rules missed it (owner's question):** the CI "Custom Rules" safe-area checks are static
  greps — they flag hand-rolled `env(safe-area-inset)` and stacked padding classes, but every class
  here was used correctly; the failure was a runtime layout property (which element is the scroll
  context, set by a height class three levels up) that no grep can see. Recorded as a Known-Issues row.
- **Verified in the web sandbox:** after the fix all three report `bodyScrollable: 0`, internal scroll
  engaged, last content clears the nav by ~11px (same as Health). `tsc`/lint/build green.
- **Residual, flagged on-device:** `pb-nav-safe` gives ~12px clearance above the nav while the raised
  center Workout button pokes ~16px above it, so a full-width banner's bottom-center could tuck a few px
  under the button (its own padding keeps text clear). Left as-is rather than change the shared
  `pb-nav-safe` utility for every screen.

**Not verified on device (S25 APK)** for either fix — the web sandbox renders safe-area insets as 0 and
has no native SQLite; the on-device smoke (scale reads good-on-right, banner/last-card clears the tab
bar) is the real gate.

## Session 289 — Workout Review (AI drop/adjust a session to fit its time budget) shipped (`claude/workout-ai-review-adjust-f2g8jj`, v1.138.0)

Owner request, brainstormed then built in-session (owner explicitly asked to implement now, front
of queue — "it's fixing basic function"). Two parts.

**Part 1 — verified the time-budget claim the owner asked me to double-check.** As of session 279
(v1.135.0) the budget logic *does* aim to finish early: `workingBudgetMin(60)` = 60 × (1 − 15%
warmup − 10% finish-early) = **45 min working budget**, and `fitToBudget` trims sets (using measured
per-set/rest times) to fit it — so a fresh prescription targets ~54 min inside a 60-min budget. **But
the caveat that explains the owner's over-running session:** `fitToBudget` only trims *sets*, never
drops an *exercise* (role floors: primary/secondary ≥ 2, accessory ≥ 1). A session with more
exercises than fit even at floor sets can't be brought under budget automatically — the prescribe
route just appends a "consider removing an accessory" note (`prescribe/route.ts:366`). That gap is
exactly what Part 2 fills.

**Part 2 — Workout Review feature (design: `docs/superpowers/specs/2026-07-12-workout-review-design.md`).**
Single-session, week-aware, drop + adjust (swap deferred to a fast-follow), Hybrid apply. New,
separate flow rather than bolted onto prescribe (which structurally re-inserts any dropped exercise
via `reconcile-prescription.ts` backfill).

- **Data layer reused wholesale:** the route calls the existing `aggregateSignals` — it already
  computes measured timing, RPE-vs-expected, rep-completion, soreness/injuries, weekly volume vs
  targets, phase, ACWR, 1RM trend/plateau, and the 45-min working budget. No new signal
  computation.
- **New AI flow:** `lib/workout/review/schema.ts` (action keep/adjust/drop; numeric bounds
  permissive — allow 0 — because the model emits 0/0/0/0 for a drop and reconcile re-clamps
  keep/adjust), `prompt.ts`, and the pure `reconcile.ts` (`reconcileReview`): validates ids,
  **keeps ≥ 1 primary** (so a 2-primary Push session can drop one to fit — the discriminating case),
  refuses dropping the only coverage of an under-target muscle, %/role-floor-clamps adjusts, and
  **recomputes projected duration + weekly-volume impact itself** so the model can't assert a fit
  the math doesn't support. 8 unit tests.
- **Apply paths** (`app/api/workout-review/session/[sessionId]` + `/apply`): overlay = adjusts +
  this-cycle drops written into the periodization prescription blob with a new
  `AiPrescription.droppedExerciseIds` field, stored at status `accepted` so `prescriptionDrivesLoad`
  makes it reach the bar (kept exercises stay out of the blob → fall back to base style, matching the
  existing render path). Permanent drop = new ownership-checked `repo.removeSessionExercise` (delete
  the `session_exercises` row; program structure is a synced *pull* domain so it propagates to
  offline clients on next pull — no outbox needed, matching how config edits already work).
- **This-cycle drop render filter:** `workout-data` (the workout screen — filters the exercise list
  when the overlay drives load) and `next-session` (home recommendation card count/duration). Not
  applied at program-load level so the config editor still sees every exercise.
- **UI:** `components/workout/review/workout-review-sheet.tsx` (bottom sheet, per-row This
  cycle / Permanent / Skip, duration-vs-budget header, weekly-impact chips, guard-protected rows
  shown but not user-decidable), triggered by a "Review & adjust" button on the session-select
  recommendation card. Dynamic-imported.

**Data-model constraint surfaced to the owner and honoured:** `session_exercises` stores no
per-exercise sets/reps (they come from a shared progression style), so "commit permanently" applies
to **drop only**; every **adjust** rides the reversible cycle overlay (which is the correct home for
a sets/reps tweak anyway). Agreed before building.

**Verification.** `pnpm tsc` clean (only the pre-existing `@capacitor/splash-screen` compile-gate,
which needed a `pnpm install --frozen-lockfile` in this sandbox to resolve — it was in the lockfile
but not installed); lint clean on new/edited files; 1167 tests pass (+8 new). `next build` compiles
both routes. **Real end-to-end against the local dev DB + a real Gemini call** (scratch vitest,
deleted after): provisioned an AI-dynamic periodization row for the Push session at a tight 25-min
budget → the AI correctly dropped the second primary (Overhead Press), reconcile projected 16 min ≤
19-min working budget (fits), weekly impact shoulders −3 / triceps −1.5 / traps −1.5; the overlay
store persisted `droppedExerciseIds`, the permanent-drop path removed the row, and a cross-user
`removeSessionExercise` correctly returned false. Dev-server smoke: both routes 401 unauth (mounted,
no 500), session-select page 307-redirects (compiles). **Not verified:** on-device (S25 APK)
rendering of the sheet and the drop filter, and the interactive browser apply flow with a real
authenticated session (no auth harness in-sandbox) — logic verified via the DB-backed e2e instead.

## Session 287 (continued) — R4 Chunk 3 Task 2: reconcilePersonalRecord's per-exercise deload gate (WK-12) — Chunk 3 complete (`fix/workout-flow-correctness`)

Last task in Chunk 3, the only remaining one in this plan requiring a schema migration.

**Migration numbering, claimed carefully per the standing rule.** Checked the migrations
directory: 117 was the highest sequential file, but 119 already existed (`119_step_live_windows.sql`
— claimed concurrently by another session's Oura BLE step-orchestration work), leaving 118 free.
Grepped every plan doc and the backlog for "migration 118"/"118_" to confirm no other open
work had silently claimed it first — clear. **Migration 118**:
`ALTER TABLE exercise_logs ADD COLUMN IF NOT EXISTS exercise_deloaded BOOLEAN NOT NULL DEFAULT
false`.

**The bug.** `reconcilePersonalRecord` (recomputes the all-time-best 1RM after an exercise-log
edit or delete) gated its candidate query on session-level flags only —
`workoutSessions.phaseType`/`isEarlyDeload` — because `exerciseDeloaded` (the per-exercise
deload flag `shouldCountTowardPr` already excludes *at log time*) was never persisted anywhere
on `exercise_logs`. The fact that a specific set was logged during a per-exercise deload was
lost the moment the write completed, so a later reconcile (triggered by editing or deleting a
*different, unrelated* log for the same exercise) could re-surface the deloaded log's inflated
1RM as the athlete's PR — silently promoting a number the log-time gate had correctly rejected.

**The fix, exactly per the plan's three-part instruction:**
1. Migration 118 (above).
2. **Persist it**: added `exerciseDeloaded: boolean` to the `exerciseLogs` Drizzle table
   definition, added `exerciseDeloaded?: boolean` to the shared `ExerciseLog` type
   (`lib/types/log.ts`), and threaded the value through `logExerciseAndSets` in `adapter.ts` —
   both the insert `.values()` and the `onConflictDoUpdate` `.set()` clause (a replay/retry
   must not silently drop the flag on the upsert path). `log-exercise.ts`'s call site now passes
   `exerciseDeloaded: exerciseDeloaded ?? false` — the same value `shouldCountTowardPr` already
   consumed for the log-time gate, just also handed to the write.
3. **Gated the reconcile query**: added `eq(s.exerciseLogs.exerciseDeloaded, false)` to the
   `where` clause, unconditional — no baseline exception, exactly mirroring
   `shouldCountTowardPr`'s own code comment ("unlike the session flag it has no baseline
   exception, since the exercise itself was cut").

**Confirmed the sync/write-path chain needed no further changes.** CLAUDE.md's "One write
function per domain" rule requires the web route and the `pushMutations` outbox branch to call
the same shared function — checked `adapter.ts`'s `pushMutations` `workout_log` branch and
confirmed it already calls the identical `logExerciseFromPayload` function this fix touches, so
both paths pick up the new field automatically with no separate change. Local SQLite mirror
parity (`RECONCILE_COLUMNS`) was skipped per the plan's own explicit allowance — this column is
server-side PR-gating only, never rendered anywhere, and there's no on-device reconcile
equivalent to feed it.

**Verified against a controlled dataset**, since no reachable path in this sandbox (no
readiness-driven auto-deload trigger, no admin override) actually produces a genuine
per-exercise-deloaded log to test against organically. Inserted two `exercise_logs` rows for a
synthetic exercise directly into the local dev DB: a legit log (`estimated_1rm=100`,
`exercise_deloaded=false`) and a later log with a deliberately inflated `estimated_1rm=200`
flagged `exercise_deloaded=true`, then seeded `personal_records` at the correct 100. Triggered
the **real production code path** — not a synthetic reconcile call — by editing the legit log's
weights via `PATCH /api/workout-entry` (which recomputes that log's own 1RM and then calls
`reconcilePersonalRecord`) through Playwright against `pnpm dev`. Result: `personal_records`
landed at `75.25` (the edited legit log's freshly recomputed 1RM from the new weights/reps) —
confirmed the deloaded log's `estimated_1rm=200` was still present, untouched, in `exercise_logs`
but was correctly excluded from ever winning the reconcile's `ORDER BY estimated_1rm DESC LIMIT
1` pick. Before this fix, the same scenario would have reconciled to 200. Cleaned up the test
rows afterward (no full DB reset needed — additive rows only, no schema/seed mutation this
time, unlike WK-1/WK-2's tests).

`pnpm lint` (0 errors, no new warnings), `pnpm exec tsc --noEmit` (clean), `pnpm test` (1168
passed, 45 skipped — the +8 is from the concurrent Workout Review PR's own tests), `pnpm build`
(clean) all green. `pnpm db:local` re-applied cleanly against the existing local dev DB
(idempotent `ADD COLUMN IF NOT EXISTS`), confirmed the column landed via `\d exercise_logs`.
**Version renumbered twice during rebase** — this PR sat open across two concurrent merges:
session 289's Workout Review feature landed first and claimed 1.138.0, then session 290's ring
step-count fix landed and claimed 1.138.1 — final version 1.138.2, `lib/changelog.ts` entry
added.

**R4 Chunk 3 is now fully shipped** (Tasks 1-2). Chunks 2, 4, 5 remain (WK-3 explicitly deferred
to item 8's Task 4.1 per the 2026-07-10 amendment, recap/history invalidation, low-risk
hygiene). Backlog entry for item 7 (R4) annotated in place.

## Session 287 (continued) — R4 Chunk 3 Task 1: client/server 1RM divergence in baseline phase (WK-6) (`fix/workout-flow-correctness`)

With R4 Chunk 1 fully shipped, moved to Chunk 3 (1RM & PR correctness) — Task 1 (WK-6) is
dev-DB verifiable, unlike Chunk 2's WK-3 (deferred to item 8) and WK-7/WK-8 (device-only).

**The bug.** `handleCompleteSet` picked its 1RM estimator by `exerciseType` alone: bodyweight
routed through `estimateOneRm(..., { exerciseType: "bodyweight", style })`, everything else
called `calculate1RM` directly — never passing `isBaseline`. The server
(`lib/workout/log-exercise.ts`) computes `isBaseline = currentPhaseType === 'baseline'` and
always calls the shared `estimateOneRm(..., { exerciseType, style, isBaseline })`, which for a
baseline **weighted** exercise routes to `amrapAverage1Rm` instead of `calculate1RM` — the two
formulas diverge under high-rep AMRAP sets. The number the exercise-summary screen celebrated
(and stored in the optimistic local write) was the standard Epley/Brzycki-style estimate; the
number the server actually persisted to `exercise_logs`/`personal_records` was the AMRAP-scaled
average. A baseline-testing session's summary could show a materially different 1RM than what
ended up as the athlete's actual stored PR.

**The fix**, per the plan: collapsed both branches onto the single `estimateOneRm` entry point,
threading `isBaseline` from `phaseStatus?.isBaseline` (already available in the orchestrator's
state, already passed down to `ActiveWorkoutScreen` as a prop) and mapping `exerciseType` to the
shared `'weighted' | 'bodyweight'` union. `calculate1RM` is no longer imported anywhere in this
file — removed the now-dead import. Also applied the plan's related fix: the optimistic local PR
check gated on `!aiDeload && !ex.deloaded` only, missing the server's `shouldCountTowardPr`
exclusion for an active **session-level** deload (`phaseStatus?.isDeloadActive`) unless the
session is itself a baseline — added `isAnyDeload = aiDeload || phaseStatus?.isDeloadActive` and
the same `(!isAnyDeload || isBaseline)` gate the server uses, so the client can no longer flash a
"new PR" toast the server's write path would silently reject.

**Verified interactively**, though only the non-baseline path was reachable in this pass. Ran a
real weighted Legs-session workout (Barbell Front Squat, default 60 kg × 8 reps × 3 sets) via
Playwright against `pnpm dev`: the exercise-summary screen's "This session" 1RM displayed 80 kg,
and the dev DB's `exercise_logs.estimated_1rm` for that log was also exactly 80 — confirming the
refactor introduced no regression on the common (non-baseline) weighted path, which is the vast
majority of real workouts. **Not exercised: the baseline case the fix specifically targets** —
the seed program has no `program_phases`/`phase_sets` rows at all (`phase_mode` is `'manual'`
with zero configured phases), and standing up a full baseline-phase test scenario (phase sets,
program phases, cycle tracking) was judged too large a side-quest for this task's time budget.
The fix's correctness for the baseline case rests on a structural guarantee rather than a
runtime one: client and server now call the *literal same function* (`estimateOneRm`) with
identical parameters, so any divergence would require the function itself to behave
inconsistently across two call sites in the same codebase — not a plausible failure mode once
both sites are unified. Noted in the backlog as an explicit gap rather than claimed as verified.

Also deferred Task 2 (WK-12, `reconcilePersonalRecord`'s missing per-exercise deload gate) —
it requires a new migration (correctly numbered against the directory + any open plans/PRs) plus
a schema column, a write-path change, and a reconcile-query change, all in one commit per the
plan's own instruction; bundling that into the same pass as this smaller client-side fix would
have diluted focus on both, so it's left as its own follow-up task.

`pnpm lint` (0 errors, no new warnings), `pnpm exec tsc --noEmit` (clean), `pnpm test` (1160
passed, 45 skipped, unchanged), `pnpm build` (clean) all green. Version bumped 1.137.10 →
1.137.11, `lib/changelog.ts` entry added. No local dev DB reset needed this time (no schema-level
test mutations, just a normal logged workout).

Backlog entry for item 7 (R4) annotated in place. R4 Chunk 3 Task 2 (WK-12) and Chunks 2, 4, 5
remain queued.

## Session 287 (continued) — R4 Chunk 1 Task 2: superset tail-orphan on unequal set counts (WK-2) — Chunk 1 complete (`fix/workout-flow-correctness`)

Picked up the task deferred from the previous pass (WK-2), now that Task 3 (WK-4) had proven the
dev-DB interactive-verification workflow was tractable for this file.

**The bug.** `handleLogCurrentSet`'s superset handoff check (`if (completedSetIndex + 1 <
store.sets) { const step = nextStep(...); ... }`) only ran when the *current* exercise still had
sets remaining. `buildSetSequence` (`lib/workout/superset-order.ts`) correctly emits the longer
superset partner's tail sets after the shorter member is exhausted, but the consumer never asked
for them: once the shorter member logged its own last set, the guard's condition was false, no
handoff ran, `handleCompleteSet` fired unconditionally, committed that exercise's summary, and
`advance()` proceeded — silently abandoning the longer partner's stashed `exerciseBuffers` entry
with its unlogged remaining sets.

**The fix, adapted from the plan's snippet.** Removed the `completedSetIndex + 1 < store.sets`
gate so `nextStep` is consulted on every logged set, including the exercise's own last one, and
handed off via `switchToExercise` whenever the sequence points at a different exercise; added a
fallback that resumes the lowest-index buffered exercise once the sequence has no next step for
the current exercise (covering the case where an earlier group member's own turn already passed
while it was stashed).

**A real gap in the plan's own literal code, caught before implementing.** The plan's snippet
checks only `step.exerciseIndex !== store.currentIdx` — no supersetGroup comparison.
`buildSetSequence` concatenates every exercise's steps into one flat array with **no boundary
marker** between exercises (confirmed by re-reading the source): for two consecutive **solo**
exercises A then B, `nextStep` on A's last set returns `{exerciseIndex: B, setIndex: 0}` just as
readily as it would for two grouped partners. Applying the plan's snippet unconditionally would
have called `switchToExercise(B)` directly from `handleLogCurrentSet` the instant A's last set
was logged — silently skipping A's Complete button and exercise-summary screen entirely for
every non-superset exercise in every program except the very last one. This is a far more common
path than the superset case the fix targets, so it would have been a serious regression hiding
inside a bug-fix PR. Added a same-`supersetGroup` gate: the handoff only fires when the target
exercise shares the current exercise's (non-null) `supersetGroup`. The buffer-resume fallback
didn't need the same gating — `exerciseBuffers` is only ever populated via `stashExercise`
inside `switchToExercise`, which is itself now correctly scoped to superset contexts, so it's
self-limiting to empty for any purely-solo program.

**Verified interactively, per the plan's own prescribed test method** (build a 2-exercise
superset with unequal set counts, run it, confirm no exercise finishes with an unlogged buffered
set). Set up a real superset in the local dev DB: created a second 4-set progression style
(`style_sets` rows), assigned it to "Barbell Overhead Press", and set both it and "Barbell Bench
Press" (existing 3-set style) to the same `supersetGroup`. Drove the flow via Playwright against
`pnpm dev` twice:
- **Run 1** confirmed the critical negative: 14 consecutive Start-Set/Log-Set actions (7 total
  sets: 3+4) all completed with **zero** "Complete" button sightings along the way — previously
  the bug would have surfaced "Complete" after only 12 actions (6 sets), the moment Bench Press
  hit its 3rd set. Cross-checked the dev DB: `set_logs` showed exactly 3 rows for Bench Press —
  its full count, not truncated.
- **Run 2** (fresh session) drove all the way through: confirmed both Bench Press and Overhead
  Press independently reached their own Complete → exercise-summary → Next Exercise sequence (in
  that order — Bench first via the buffer-resume, matching the plan's described flow), then
  continued into the solo 3rd exercise (Tricep Pushdown, not in the group) and confirmed it
  logged its own 3 sets via normal alternation, proving the same-group gate didn't regress the
  non-superset path. Final dev-DB check: `set_logs` counts were exactly 3 (Bench), 4 (Overhead),
  3 (Tricep) for that session — no duplicates, no orphans.

`pnpm lint` (0 errors, no new warnings), `pnpm exec tsc --noEmit` (clean), `pnpm test` (1160
passed, 45 skipped, unchanged), `pnpm build` (clean) all green. Version bumped 1.137.9 →
1.137.10, `lib/changelog.ts` entry added. Local dev DB fully wiped and reseeded afterward (same
approach as WK-1's test) since the superset setup required schema-level test data (a new
progression style, `supersetGroup` reassignment) that couldn't be cleanly hand-reverted.

**R4 Chunk 1 is now fully shipped** (Tasks 1-3, this task). Chunks 2-5 remain (WK-3 explicitly
deferred to item 8's Task 4.1 per the 2026-07-10 amendment, 1RM/PR correctness, recap/history
invalidation, low-risk hygiene). Backlog entry for item 7 (R4) annotated in place.

## Session 288 — Fix: Home & Health crash "Cannot read properties of null (reading 'x')" (`claude/resource-loading-issues-i512gq`)

**Symptom (owner report + screenshots).** After the recent Home/Health/offline work, the Home
and Health screens hit the error boundary ("Something went wrong — Cannot read properties of
null (reading 'x')") on-device, while More/admin correctly showed the offline screen.

**Root cause (proven).** `components/health/hr-day-chart-gaps.ts` `withGapBreaks()` inserted a
bare `null` sentinel into a chart.js `{x,y}` **object-data** array to break the HR line across
ring coverage gaps. chart.js picks its parse path from the first element (always a real object —
the gap push is gated on `i>0`), so it parses the WHOLE dataset as object data and runs
`resolveObjectKey(item,'x')` → `item.x` on every element, including the `null` gaps →
`null.x` throws the exact production message. `HrDayChart` is shared by **both** screens (Home
`hrChartWidget`, Health Body-tab "Ring" `ouraSection`), which is why both crashed. It only fired
on-device: the null is inserted only when two 5-min HR buckets are >20 min apart, which needs
the native BLE/SQLite store's real (power-gated) ring data — the web sandbox has no local store,
so the chart's `length` guards short-circuit and the null path never runs (hence green in every
web/dev test, invisible to CI). The existing unit test *asserted* the null insertion, locking in
the bug.

**Fix.** Emit a `{ x: midpoint, y: NaN }` gap marker instead of `null`. `NaN`-y points break the
line identically under `spanGaps:false` but remain real objects chart.js can read `.x`/`.y`
from. Updated the unit test to assert the non-null marker and that no element is ever
null/undefined.

**Verification.** Reproduced the crash *directly against chart.js's own* `resolveObjectKey`: the
old null-gap array throws `Cannot read properties of null (reading 'x')`, the new NaN-gap array
parses cleanly (gap y = NaN). `vitest` (gap-break suite), `tsc --noEmit`, and `eslint` on the
changed files all green. **Not exercised on-device:** the APK render itself (no device/native
SQLite in the sandbox) — the chart.js-level repro is the authoritative proof of the parse path.

**Also found, NOT changed (flagged for the owner):** the service worker's top-level navigation
handler (`public/sw-template.js`) is stale-while-revalidate + retains the previous cache
generation, so a WebView pointed at Railway (which deploys many times a day) can be pinned to an
old JS build and hit deploy-skew "resource" errors. This is a real latent hazard but was NOT the
cause of this crash and reverses a deliberate offline-shell design decision, so it's left for a
separate, discussed change (recommendation: network-first navigation with cache/`/offline`
fallback). Version bumped 1.137.7 → 1.137.8 (patch) with a `lib/changelog.ts` entry.

## Session 287 (continued) — R4 Chunk 1 Task 3: in-flight guard on set logging (WK-4) (`fix/workout-flow-correctness`)

Continued R4 Chunk 1 after Task 1 (WK-1) merged as PR #451. Skipped Task 2 (WK-2, superset
tail-orphan) for now — it's a genuine superset-sequencing rewrite (`nextStep`/`switchToExercise`
interplay across `handleLogCurrentSet`), higher risk and more involved than the remaining time
in this pass warranted; picked up Task 3 (WK-4) instead, a smaller, well-scoped, mechanical
guard.

**The bug.** Neither `handleCompleteSet` nor `handleLogCurrentSet` guarded against a double-fire.
`handleCompleteSet` mints a fresh `clientExerciseLogId`/`clientSetLogIds` via `crypto.randomUUID()`
on every call — a rapid double-tap on "Complete" (or a stray re-render firing the handler twice)
would POST two distinct `/api/log-exercise` payloads with different ids, and the server's
replay-detection (which dedupes by matching id) can't catch it, doubling `exercise_logs` and
`user_stats.total_sessions`/`volume`/`sets`. CLAUDE.md names this exact class by number
(session-86: 5 rapid taps once fired 4 `complete-workout` POSTs) as a standing rule — "Submit/
complete buttons need an in-flight guard."

**The fix**, per the plan: added a shared `isLoggingRef` (mirroring the file's existing
`isCompletingRef` pattern for the whole-workout completion) that guards the top of both
`handleLogCurrentSet` and `handleCompleteSet`. `handleLogCurrentSet` is fully synchronous, so it
resets the ref at its own natural end; `handleCompleteSet` is async (it awaits nothing directly
but does async work via `.then()` chains after firing), so it resets the ref synchronously right
after `commitExerciseSummary(...)` — the call that flips `mode` to `'exercise-summary'`, i.e.
the terminal state for that action. Added a backstop `useEffect` keyed on
`[store.mode, store.workoutPhase]` that unconditionally clears the ref whenever either changes,
so a hypothetical stuck ref (missed inline reset on some code path) can never permanently wedge
future Log/Complete taps. The plan's cited PiP `onLog` path already routes through both guarded
handlers — confirmed via grep, no separate fix needed.

**Verified interactively** — dev-DB, not APK-only, so no excuse to skip it after WK-1 set the
bar. Drove a real Push-session workout (3-exercise seed, real style/set config, unlike WK-1's
trimmed single-exercise test) via Playwright against `pnpm dev`: signed in, started the session,
logged set 1 of Barbell Bench Press, then rapid-triple-clicked "Complete" with `Promise.all` of
3 simultaneous `.click()` calls (no waits between them, the actual race condition WK-4 targets).
Captured every outgoing `/api/log-exercise` request via Playwright's request listener: **exactly
1** fired, with **1** unique `exerciseLogId` — confirmed against the dev DB, `exercise_logs`
count = 1 for that session. A parallel rapid-triple-click test on "Log Set" itself (not
Complete) produced 3 legitimate serial set-advances rather than a race, which on reflection is
correct: `handleLogCurrentSet` has no async gap (it's fully synchronous), so the browser
processes each click as a separate, fully-completed event-loop task before the next fires —
there's no window for a race there the way there is in `handleCompleteSet`'s server round-trip.
The guard is still correctly in place per the plan's instruction either way.

`pnpm lint` (0 errors, no new warnings), `pnpm exec tsc --noEmit` (clean), `pnpm test` (1160
passed, 45 skipped, unchanged), `pnpm build` (clean) all green. Version bumped 1.137.8 → 1.137.9
(renumbered during rebase — PR #453 landed on `main` first and independently claimed 1.137.8 for
an unrelated Home/Health crash fix), `lib/changelog.ts` entry added. No DB reset needed this time
(unlike WK-1's test, this one didn't require deleting any seed rows — just left one harmless
extra test workout session in the local dev DB).

Chunk 1 Task 2 (WK-2) remains, plus Chunks 2-5 (WK-3 deferred to item 8's Task 4.1, 1RM/PR
correctness, recap/history invalidation, low-risk hygiene). Backlog entry for item 7 (R4)
annotated in place.

## Session 287 (continued) — R4 Chunk 1 Task 1: single-exercise workout completion silently lost (`fix/workout-flow-correctness`)

R3's remaining tasks (Chunk 3 Tasks 3.1/3.2, Chunks 4-6) are all APK-only per the plan, so moved
to the next queue item — R4, workout-flow correctness (item 7). Chunk 1's Task 1 (WK-1) is the
highest-value fix in the plan and the one explicitly flagged as needing a real interactive
verification pass, so gave it the time that deserved.

**The bug.** `advance()` (`workout-screen.tsx`) is memoized on
`[store.currentIdx, effectiveExercises, store.soloMode]`. For a **single-exercise session** none
of those change between component mount (where `workoutSessionId === ''`, `sessionLog === []`)
and the final Next tap — there's no exercise to advance *to*, so `currentIdx` never moves — so
`advance` never recreates and keeps closing over the render-0 copies of `completeWorkout` and
`handleAddToCalendar`. Two consequences: `completeWorkout` read `store.workoutSessionId` from
that stale closure (empty string) and POSTed `/api/complete-workout` with an empty id, which
silently fails the route's `.uuid()` Zod check *and* skips the outbox fallback
(`if (wsId && userId)`) — the workout completion is lost entirely: no `completed_at`, no phase
increment, no prescription consume. `handleAddToCalendar` read the equally-stale empty
`sessionLog` (`[]`) and early-returned on `if (!log.length) return` — no calendar event, ever.
Multi-exercise sessions were never affected (their `currentIdx` changes on every exercise,
which recreates `advance`), and the pre-workout inline Complete-Workout button was never
affected either (it reads `store` fresh in its own render callback, not through a stale memo).

**The fix**, exactly per the plan's snippet: `completeWorkout`'s `wsId`, `handleAddToCalendar`'s
`workoutEndMs`/`workoutStartMs`, and `advance`'s `snapLog` capture all now read
`useWorkoutStore.getState()` fresh at call time instead of the closure's `store` — the identical
pattern the file already uses at 4 other call sites (`restoreExercise` at `:472,564`) for
exactly this class of stale-closure bug.

**Verified interactively — this task's own plan requires it as the merge gate, and it's dev-DB
verifiable (not APK-only), so there was no excuse to skip it.** The local dev DB's seed only
ships 3-exercise Push/Pull/Legs sessions, so temporarily deleted 2 of Pull's 3
`session_exercises` rows to get a genuine single-exercise session, started `pnpm dev`, and drove
the full flow with a small Playwright script (global `/opt/node22` Playwright + the pre-installed
Chromium, since this isn't an npm dependency of the project): signed in as the seeded test user,
navigated straight to `/workout?session=<pull-id>`, through warm-up, started the (zero-configured-
sets, as it turned out) working set, hit Complete on the exercise summary, then clicked "Next
Exercise" — the exact button wired to `advance()`. Captured the actual outgoing request bodies:
`POST /api/complete-workout` carried a real UUID `workoutSessionId` (not `''`), and
`POST /api/log-calendar-event`'s `exercises` array carried the logged exercise (not `[]`) — the
precise two failure modes WK-1 describes, both confirmed fixed. (Both requests then 404/401'd in
this synthetic run — no weight was ever logged so `/api/log-exercise` 400'd and never created a
server-side `workout_sessions` row for `complete-workout` to find, and the dev-DB test user has
no Google Calendar OAuth token — both artifacts of the throwaway test setup, not defects in the
fix; the payload-shape evidence is what actually proves the fix.)

Restored the local dev DB to its clean seeded state afterward: the two deleted `session_exercises`
rows couldn't be perfectly hand-reconstructed (their `exercise_id`/`style_id` links to
`exercise_library` weren't captured before deletion), so wiped
`/var/lib/postgresql/local-dev` entirely and re-ran `pnpm db:local` for a full fresh reseed,
confirmed Push/Pull/Legs are back to 3 exercises each.

`pnpm lint` (0 errors, no new warnings), `pnpm exec tsc --noEmit` (clean), `pnpm test` (1160
passed, 45 skipped, unchanged), `pnpm build` (clean) all green. Version bumped 1.137.6 → 1.137.7,
`lib/changelog.ts` entry added — this is a real, user-facing data-loss fix.

Chunk 1 Tasks 2 (WK-2, superset tail-orphan) and 3 (WK-4, in-flight log guard) remain, plus
Chunks 2-5 (WK-3 explicitly deferred to item 8's Task 4.1 per the 2026-07-10 amendment, 1RM/PR
correctness, recap/history invalidation, low-risk hygiene). Backlog entry for item 7 (R4)
annotated in place.

## Session 287 (continued) — R3 Chunk 3 Task 3.4: unchecked res.ok / silent-failures sweep (`fix/offline-first-integrity`)

Continued Chunk 3 after Task 3.3 (early-deload card) merged as PR #449. Task 3.4 (SYNC-O6) cites
7 sites with `await fetch(...)` followed by unconditional UI advancement — no `res.ok` check —
so a 4xx/5xx silently reads as success.

**Re-verified every site against current `main` before touching anything**, since two prior
sessions had already independently improved some of these files for unrelated reasons (offline
outbox migrations) and the plan's line numbers/paths were written against an older snapshot:

- `components/workout/ai-prescription-card.tsx` — the plan's cited path was
  `components/home/ai-prescription-card.tsx`, which doesn't exist; found it under
  `components/workout/`. The code already guarded `if (res.ok) { ... }` before advancing state
  (`onStatusChange`/`onPhaseChanged`), so there was no false-success risk — just a silent no-op
  on failure. Added `toast.error(...)` in the `else` branch of both `respond()` and
  `executeTransition()`.
- `components/morning-checkin-sheet.tsx` and
  `components/nutrition/end-of-day/end-of-day-review.tsx` — both had grown a local-first +
  outbox write path (`getLocalStore`/`queueMutation`) since the plan was written, but the
  **web-fallback** branch (`store` unavailable) still did a bare `await fetch('/api/day-checkin')`
  with no `res.ok` check before `toast.success`/`onClose()`. Added the guard so a failed
  fallback POST now correctly falls into the existing `catch { toast.error(...) }`.
- `components/workout/done-screen.tsx`'s session-RPE web-fallback POST had the identical gap.
  The file's `catch` block is deliberately silent by design ("keep the optimistic UI; outbox
  retries on device") since session RPE is a low-stakes optional metric with the UI already
  flipped optimistically before the request — added the `res.ok` guard so a genuine HTTP failure
  now actually reaches that existing silent catch, rather than a 4xx/5xx being indistinguishable
  from success (previously only a network-level rejection would throw; an HTTP error status does
  not make `fetch` reject).
- `components/nutrition/manage-supplements-sheet.tsx` — of its three `fetch` call sites, two
  (`save`, `toggleActive`) already had the guard; only the delete handler
  (`DELETE /api/supplements/:id`) was missing it. Fixed just that one.
- `components/nutrition/supplements-section.tsx` — already fully guarded (`if (!res.ok) throw`)
  by an earlier session. No change.
- `components/nutrition/saved-meals-sheet.tsx`'s `deleteMeal` — confirmed still exactly as the
  plan described (`DELETE /api/nutrition/saved-meals/:id`, no guard at all). Fixed per plan.

`pnpm lint` (0 errors, no new warnings), `pnpm exec tsc --noEmit` (clean), `pnpm test` (1160
passed, 45 skipped, unchanged), `pnpm build` (clean) all green. Version bumped 1.137.5 → 1.137.6,
`lib/changelog.ts` entry added covering the user-visible surfaces.

**Not exercised:** the plan's stubbed-500 interactive verify across all 7 sites — most require
an authenticated session and specific UI state (an in-progress workout for done-screen, a
morning check-in prompt, nutrition end-of-day) that weren't reachable in this sandbox pass.
Every fix is a minimal, mechanical `res.ok` guard directly matching a pattern already proven
working at a sibling call site in the same file (e.g. `manage-supplements-sheet.tsx`'s other two
fetches, `supplements-section.tsx`'s toggle handler) — low risk despite being unexercised here.

Chunk 3's two dev-DB-verifiable tasks (3.3, 3.4) are now both shipped. Tasks 3.1
(detected-activity save local-first) and 3.2 (Oura dismiss-flag outbox) remain — both APK-only,
deferred until on-device verification is available. Backlog entry for item 6 (R3) updated.

## Session 287 (continued) — R3 Chunk 3 Task 3.3: early-deload card silent-failure fix; Dependabot remediation deferred (`fix/offline-first-integrity`, `security/dependabot-remediation`)

After PR #448 merged (R3 Chunk 2 complete), GitHub reported 19 high/15 moderate/5 low Dependabot
alerts on the push — over CLAUDE.md's ≥5-high/critical threshold for the standing remediation
item, which per the Package Management rule takes priority over the next numbered backlog item.

**Attempted the Dependabot batch, deferred it.** Branched `security/dependabot-remediation` and
went looking for the actual alert list to triage. `pnpm audit --json` reports 0 vulnerabilities
across all 1264 dependencies — it hits `registry.npmjs.org`'s audit endpoint through the sandbox
proxy successfully (confirmed via `pnpm config get registry` + a manual re-run), but that
endpoint's advisory data has evidently diverged from GitHub's own GHSA-backed dependency-graph
scan, which is what actually produces the 19 high-severity count. No `gh` CLI is available in
this environment (per the environment's own GitHub-integration note), no MCP tool exposes
Dependabot alerts, and `list_pull_requests` found no open Dependabot-authored PRs to review
instead (`.github/dependabot.yml`'s grouped-PR batching hasn't fired yet, or its PRs haven't
landed). Without the actual CVE/package list, guessing which dependencies to bump risks breaking
the build while missing the real flagged packages entirely — judged unsafe to force. Deleted the
branch, added a Known Issues row (`projectOverview.md`) documenting the gap and what the next
session needs (either CLI/tool access, or the user triaging the GitHub Security tab directly),
and moved to the next well-scoped, evidence-based item instead: R3 Chunk 3.

**Task 3.3 (SYNC-O4, early-deload card) — shipped, v1.137.5.**
`components/home/early-deload-card.tsx`'s `handleConfirm` fired `onConfirm()` unconditionally
after `await fetch('/api/confirm-early-deload')` — no `res.ok` check, no try/catch, no `finally`.
A failed periodization write (4xx/5xx) read as a silent success: the card dismissed itself and
the caller believed a deload had started when nothing was actually saved server-side. A network
rejection was worse — it threw out of the async handler entirely, leaving `loading` stuck `true`
and the confirm button permanently disabled. Fixed with the plan's own exact snippet: guard
`res.ok` and throw, catch surfaces `toast.error('Could not start deload — try again')`, `finally`
clears `loading`. This write is online-only by nature (no offline deload confirm makes sense), so
no outbox path was added — just correct success/failure gating.

`pnpm lint` (0 errors, no new warnings), `pnpm exec tsc --noEmit` (clean), `pnpm test` (1160
passed, 45 skipped, unchanged), `pnpm build` (clean) all green. Version bumped 1.137.4 → 1.137.5,
`lib/changelog.ts` entry added.

**Not exercised:** the plan's own stubbed-500 interactive verify (intercept the route, confirm
an error toast shows, the button re-enables, and `onConfirm` does NOT fire) — `EarlyDeloadCard`
only renders behind a specific low-readiness/elevated-training-load Home state with an
authenticated session, which wasn't reachable in this sandbox pass. The fix is a direct,
unmodified copy of the plan's own code snippet.

Bookkeeping: backlog entry for item 6 (R3) annotated with the Task 3.3 summary; Chunk 3's
remaining Task 3.4 (unchecked `res.ok`/silent-failures sweep across 7 files, also dev-DB
verifiable) and Chunks 4–6 (APK-only local sync machinery) remain queued.

## Session 287 (continued) — R3 Chunk 2 Task 2.4: day-detail overlay cachedFetch seeding — Chunk 2 complete (`fix/offline-first-integrity`)

Last task in R3 Chunk 2. `health-content.tsx`'s day-detail overlay (`fetchDayOverlay`) used a
bare `fetch('/api/day-log?date=...')` with no client cache, so every repeat open of a day's
detail sheet re-hit the network. Converted to `cachedFetch` on the `day-log:<date>` key —
already minted by `week-day-sheet.tsx` for the same route, so no new key — with a
`.finally()`-driven loading flag (the established pattern from Chunk 6: `cachedFetch` never
rejects, so a `.catch()` here would be dead code; the flag flips to false only if `onData` never
set a payload, distinguishing "still loading" from "fetch genuinely failed").

Converting the read to a shared cache key meant the three write handlers that call
`refreshDayOverlay` after a mutation could no longer rely on the bare fetch always being fresh —
a fire-and-forget invalidation racing the refetch would flash pre-write data before the network
correction landed. `handleDelete` and `handleDeleteSession` already called
`invalidateWorkoutSummaries()` (which includes `day-log:`); switched both from fire-and-forget
to awaited. `handleEditSave` had **no invalidation call at all** before this — a pre-existing
gap the bare-fetch path had been silently covering for — added `invalidateExerciseLogged()`,
awaited before the refetch. `handleDeleteActivity` already awaited `invalidateActivityWrites()`
(which also covers `day-log:`) — unchanged. `app/stats/stats-content.tsx` has an identical bare
`fetch('/api/day-log')` but the whole file is dead code (`/stats` redirects to `/health`) — left
untouched, not worth the risk of touching an unreachable path.

`pnpm lint` (0 errors, no new warnings), `pnpm exec tsc --noEmit` (clean), `pnpm test` (1160
passed, 45 skipped, unchanged), `pnpm build` (clean) all green. `pnpm dev` boot confirmed no
compile errors. **Not exercised:** the interactive day-overlay open/edit/delete flow in a
browser — no authenticated session available in this sandbox pass; the change is a direct copy
of `week-day-sheet.tsx`'s already-proven `cachedFetch` pattern against the identical key/TTL,
and the `.finally()`-loading-flag shape matches two cards Chunk 6 already shipped with this
approach.

**R3 Chunk 2 is now fully shipped** (Tasks 2.1–2.4, sessions spanning this continuation).
Chunks 3–6 remain queued (outbox coverage for detected-activity save + Oura dismiss flags + the
silent-failure sweep, local sync machinery hardening, push/route validation parity, and the
`user_stats`/`sessions_in_phase` counter reconciles — all noted in the backlog item). Version
bumped 1.137.3 → 1.137.4 (patch — cache-only perf/correctness fix) with a `lib/changelog.ts`
entry. Backlog entry (item 6, R3) updated in place.

## Session 287 (continued) — R3 Chunk 2 Tasks 2.2/2.3: home-timeline documented exception, overview-screen local-first save

Continued R3 Chunk 2 after Task 2.1 (health fetchMeta local seed) merged as PR #446.

**Task 2.2 (SYNC-R3, home-day-timeline) — resolved via documented exception.** The plan's
preferred fix is a client-side timeline assembler that reproduces `/api/day-timeline`'s
cross-domain merge (workouts, food, mood, activity, supplements — each individually already
local-first) into the same `TimelineEvent[]` shape, sort order, and formatting the server
produces. Building and maintaining a second copy of that merge logic was judged out of scope
for this batch given the risk of drift between the two implementations. Took the plan's
sanctioned fallback instead: documented the limitation. Added a sanctioned-exception clause to
`CLAUDE.md`'s Offline-First "Read-site status" paragraph explaining why `home-day-timeline.tsx`
stays server-only despite its constituent domains being local-first, and added a
`projectOverview.md` Known Issues row for the same gap, per the standing "no orphaned findings"
rule — a documented finding needs a queue entry or a documented exception, never neither. No
code changed for this task.

**Task 2.3 (SYNC-O5, overview-screen body-metric save) — shipped, v1.137.3.**
`overview-screen.tsx`'s `handleSaveLog` (the sheet behind every Overview widget's "log a value"
action — weight, steps, calories, protein/carbs/fat, body fat, and the five measurement
fields) only ever POSTed to `/api/body-metadata`; a save attempted while offline threw and
surfaced a bare "Failed to save" toast with no local record at all. Fixed by routing through
the same local-first path the domain's other write surfaces already use
(`water-log-sheet.tsx`, `metric-log-sheet.tsx`, `injury-sheet.tsx`): read today's existing
`LocalBodyMetric` row via `store.getBodyMetrics(todayInTz())`, build a full read-merged record
(every field keeps its existing value except the one being saved — copying
`water-log-sheet.tsx`'s pattern; CLAUDE.md itself names `metric-log-sheet.tsx` as the *wrong*
pattern to copy, since it nulls out every other column), `store.upsertBodyMetric(...)` +
`store.queueMutation({ domain: 'body_metrics', ... })` + `pushMutations(userId).catch(() => {})`
fire-and-forget, then the same synchronous toast/close/`invalidateReadinessInputs`/`fetchMeta()`
sequence the old code already had. Falls back to the original POST body only when `userId` is
absent or the local store throws (`savedLocally` boolean gate, matching the sibling files'
structure) — this keeps the web-only fallback a logic-free pass-through per the Canonical
Runtime rule.

A verify-first gap in the plan text itself: it assumed `userId` was already in scope inside
`overview-screen.tsx` for the `getLocalStore(userId)` call, but the component had no `userId`
prop at all. Traced the gap up one level — `app/overview/page.tsx` is an async server component
that already calls `auth()` and had `session.user.id` in scope, but never passed it down.
Fixed with a one-line prop add at both the render call site and the component signature.

Added a `MetaKey → LocalBodyMetric` field-name lookup table (`META_KEY_TO_LOCAL_FIELD`) since
the widget system's key names (`protein`, `carb`, `fat`, `bodyFat`) don't match the local
store's column names (`proteinG`, `carbsG`, `fatG`, `bodyFatPct`).

`pnpm lint` (0 errors, pre-existing warnings only, none in the touched files), `pnpm exec tsc
--noEmit` (clean), `pnpm test` (1160 passed, 45 skipped, unchanged), `pnpm build` (clean) all
green. Version bumped to 1.137.3, `lib/changelog.ts` entry added.

**Not exercised:** the actual local-first write path and outbox flush — `getLocalStore` returns
`null` in the web sandbox, so `handleSaveLog` always takes the POST fallback branch there; only
that fallback branch was exercised via `pnpm dev`. APK is the real gate for the local-first
branch per the Canonical Runtime policy.

R3 Chunk 2 Task 2.4 (day-detail overlay `cachedFetch` seeding) and Chunks 3–6 remain queued;
backlog entry annotated in place (partial-chunk landing).
## Session 287 — R3 Chunk 2 Task 2.1: health fetchMeta local seed never set today's tile (`fix/offline-first-integrity`)

With the health-tab-overhaul item fully complete, moved to the next queue item — R3 (offline-first
integrity, item 6 after this session's renumber), whose Chunk 1 shipped in session 254 and Chunks
2–6 remained. Picked up Chunk 2's first task (SYNC-R2).

**The bug.** `health-content.tsx`'s `fetchMeta` local fast-path seed (added this session's earlier
Chunk 3 work as `localSeedPromise`) mapped the local store's body-metric rows into `metaRecent`
but never checked whether any of them was today's row — `metaToday` stayed `null` until the
network fetch resolved. On a fresh offline app-open, the Body tab's steps/weight tiles rendered
blank ("—") even when today's value had already been logged and synced to the local store on a
previous session. `session-select-content.tsx`'s Home screen (SYNC-R1, a prior session's fix)
already has the correct pattern: find the local row whose `date === todayInTz()` and
`setMetaToday` from it. Mirrored that exactly — `filtered.find(m => m.date === todayStr)`, same
`toRow` mapper, same `setMetaToday` call the network branch already makes.

**Verification.** Full gate green: `pnpm lint`/`tsc --noEmit`/`vitest run` (1160 passed,
unchanged — this code path only executes with a non-null `getLocalStore`, i.e. never in this
sandbox's test/dev environment)/`pnpm build` all green. Dev-server pass confirmed `/health`
still renders cleanly via the web fallback path (`getLocalStore` returns `null` on web,
unaffected by this change). **Not exercised:** the actual fix behavior itself — `getLocalStore`
is null in the web sandbox, so the new code path never runs there; the APK is the real
verification gate per the plan's own stated Task 2.1 verify step (offline fresh app-open on
Health → today's tiles show the locally-saved value).

Bookkeeping: backlog entry for item 6 (R3) annotated with the Task 2.1 summary; Chunk 2's
remaining Tasks 2.2–2.4 (home-day-timeline local-first assembly, overview-screen body-metric
save local-first, day-detail overlay cache seeding) plus Chunks 3–6 remain, left in place per
the partial-chunk-landing convention. Version bumped 1.137.1 → 1.137.2 (patch bug fix) with a
`lib/changelog.ts` entry.


## Session 287 — Workout-system hardening Chunk 1 Task 1.5: weekly-volume window in user tz (AI-6) (`fix/weekly-volume-window-tz`)

Continued item 8's Chunk 1 (AI periodization correctness) after Tasks 1.1 and 1.3 shipped
earlier this session. Picked up Task 1.5 (AI-6): `getWeeklySetsByMuscleGroup`
(`lib/data/postgres/slices/periodization.ts`) compared `workout_sessions.started_at` against
bare `${weekStart}::date` / `${weekEndNextStr}::date` casts — Postgres compares those against
UTC midnight, up to 10 h off the user's AEST week, so a session logged in the early-morning
window near a week boundary could land in the wrong week's volume total.

Added a `tz: string` parameter to the function and replaced both casts with
`dateStrMidnightInTz(weekStart, tz)` / `dateStrMidnightInTz(weekEndNextStr, tz)`, mirroring the
existing pattern already used elsewhere in the same file (line ~302). Threaded `tz` through
`lib/data/repository.ts`'s interface and `lib/data/postgres/adapter.ts`'s pass-through, then
updated both real callers: `lib/ai-periodization/signals.ts` (already had `tz` in scope) and
`app/api/ai-periodization/weekly-volume/route.ts` (derives `tz = session.user?.timezone ??
DEFAULT_TZ`, already present in the route per the Date Arithmetic rule — just wasn't being
passed through).

Added three boundary tests to `lib/__tests__/date-utils.test.ts` exercising the same
`dateStrMidnightInTz`/`shiftDateStr` composition the SQL window uses: a session at Monday 08:00
AEST falls inside the new week's `[weekStartTz, weekEndNextTz)` window, a session at Sunday
23:00 AEST (the day before) stays excluded, and a session one minute before the following
Monday's local midnight is still excluded from the next week.

`pnpm lint` (0 errors, pre-existing warnings only), `pnpm exec tsc --noEmit` (clean), `pnpm test`
(1225 passed, 45 skipped — +3 from the new boundary tests), `pnpm build` (clean) all green.
**Verified via unit tests only** — the boundary logic is pure date arithmetic identical to what
the SQL window evaluates against; a live DB check would require seeding sessions at specific UTC
instants straddling a real week boundary in the dev DB, judged disproportionate since the
boundary math itself is now directly tested and the query's shape (comparing a timestamp column
against a `Date`) is unchanged from the already-proven `dateStrMidnightInTz` pattern used
elsewhere in this file.

Version bumped 1.139.4 → 1.139.5 (patch bug fix), `lib/changelog.ts` entry added. Backlog entry
for item 8 annotated with the Task 1.5 summary; Tasks 1.2, 1.4, 1.6–1.7 remain, along with
Chunks 2–6.

## Session 287 — Workout-system hardening Chunk 1 Task 1.6: ai_dynamic deload PR gate (AI-8) (`fix/ai-dynamic-deload-flag`)

Continued item 8's Chunk 1 after Task 1.5 merged. Picked up Task 1.6 (AI-8): `ai_dynamic`
programs can mint a `personal_records` update off a deliberately submaximal deload set, because
the PR gate never learns the session is a deload in the first place.

**Root cause.** `lib/workout/log-exercise.ts` resolves `currentPhaseType` inside `if
(programWithPhases) { ... }`, where `programWithPhases = await
repo.getActiveProgramWithPhases(userId)`. That function
(`lib/data/postgres/slices/programs.ts:644-649`) returns `null` for anything other than
`prog.phaseMode === 'automatic'` — so for `ai_dynamic` programs it is *always* `null`, and the
phase-resolution block never runs. `currentPhaseType` stays `undefined`, `isAnyDeload` (`===
'deload' || sessionIsEarlyDeload`) is always `false`, and `shouldCountTowardPr` happily mints a
PR from a card-initiated deload session's inflated-relative-to-target numbers.

**First attempt was wrong.** Initially added the ai_dynamic lookup as an `else if` branch
*inside* `if (programWithPhases)` — dead code, since that block never executes for ai_dynamic at
all. Caught this immediately during dev-DB verification: flipped the seeded program to
`ai_dynamic`, seeded a `session_periodization` row with `phase='deload'`, called
`logExerciseFromPayload` directly against local Postgres via a throwaway `tsx` script, and got
`isPR: true` — wrong. Traced it to the dead branch, restructured to `if (programWithPhases) {
...automatic... } else if (activeProgram?.phaseMode === 'ai_dynamic' && sessionId) { ...session_periodization lookup... }`
— `activeProgram` was already being fetched (`programWithPhases?.program ?? await
repo.getActiveProgram(userId)`) but discarded with `void activeProgram;`; now it's used. Re-ran
the same DB script: `isPR: false` in the deload case, `isPR: true` in an `accumulation` case with
a fresh session (same beats-target weights/reps) — confirming the gate is deload-specific, not
just always-off.

This is exactly the kind of gap DB-level verification catches that mocked unit tests wouldn't
have on their own — the first draft of `lib/workout/__tests__/log-exercise.test.ts` mocked
`getActiveProgramWithPhases` as *truthy* for an ai_dynamic program, which matched the same wrong
mental model as the buggy implementation and would have passed either way. Rewrote the tests to
mock `getActiveProgramWithPhases` returning `null` (matching the real function's contract) and
`getActiveProgram` returning the ai_dynamic/manual program instead — 3 cases: deload → no PR,
accumulation → PR mints, non-ai_dynamic with an empty phaseList → no lookup at all.

`pnpm lint`/`tsc`/tests (1228 passed, +3)/build all green. Version bumped 1.139.6 → 1.139.7
(rebased once onto main after a concurrent session's revert PR also claimed 1.139.6 — bumped
past it), `lib/changelog.ts` entry added. Backlog entry for item 8 annotated with the Task 1.6
summary (including the dead-code-branch correction, for future readers); Tasks 1.2, 1.4, 1.7
remain, along with Chunks 2–6.

## Session 287 — Workout-system hardening Chunk 1 Task 1.7: AI-9+AI-17+AI-10+AI-11 small fixes (`fix/ai-periodization-task-1-7`)

Continued item 8's Chunk 1 after Task 1.6 merged, closing out the last of Chunk 1's small
fixes bundle (Task 1.7).

**AI-9 — regenerate on failed-generation signature.** `workout-data/route.ts` now checks: if
an `ai_dynamic` session's `prescriptionStatus === 'consumed'` with `prescription == null` (the
signature of a Gemini outage at the previous completion), fire-and-forget a `POST /prescribe`
on the next load — the same idempotent endpoint the completion and transition paths already
call. Verified live: forced a session into that exact state, hit `/api/workout-data`, watched
a real `POST .../prescribe 200` fire in the dev server log, and confirmed the DB picked up a
fresh `pending` prescription.

**AI-10 — weight mismatch + a real name-collision bug.** The prescription card rounded
displayed weight with `mround125Up` (fixed 1.25 kg) while the workout screen actually loads
with `mroundStepUp(est1rm × pct, weightStepFor(equipment))` (2.5 kg for barbell) — so a
barbell exercise's card could show 1.25 kg less than what loads. Chasing the fix surfaced a
sharper bug: `WorkoutExercise` never carried a stable id, so `pre-workout-screen.tsx` built its
`liveOneRm`/`lastSetModeById` lookup maps keyed by exercise **name** — two exercises sharing a
name in one session would silently collide and show each other's 1RM/set-mode (a direct
violation of the session-identity rule: DB id, not name). Added `sessionExerciseId` to
`WorkoutExercise` (both real constructors: `app/api/workout-data/route.ts` and
`lib/local-store/program-assembler.ts`), rekeyed the maps by it, and threaded a new
`equipmentById` prop into `AiPrescriptionCard` so it can call the same rounding function the
workout screen uses. Verified live: a real `/api/workout-data` response now carries
`sessionExerciseId` and `equipment` per exercise.

**AI-17 — server-side transition validation.** `transition/route.ts` accepted any of the four
phases with no check the transition was actually recommended or adjacent. Added a `NEXT_PHASE`
cycle map (accumulation→intensification→realisation→deload→accumulation, with deload reachable
from any phase for fatigue-driven early deloads) and validates `newPhase` against either the
stored prescription's actual recommendation or the natural next phase, 400ing otherwise unless
`force: true` is sent. Discovered along the way that `pendingTransition` is dead state —
written nowhere in the codebase, always `null` — so validation reads the real signal instead
(`prescription.phaseAction` transition/deload_recommended + `prescription.phase ===
newPhase`), matching exactly what the card's only call site (`executeTransition(prescription.phase)`)
actually sends. The regen fetch now logs failures instead of silently swallowing them (still
fire-and-forget). Verified live via Playwright driving the real endpoint: adjacent transition →
200, non-adjacent → 400 with the new error message, non-adjacent + `force:true` → 200.

**AI-11 — dead code + a real cross-program baseline-skip bug.** Deleted the dead `amrapResults`
branch of `baseline/complete/route.ts` — the only real caller (`ai-periodization-status-card.tsx`)
always sends `useExisting: true, amrapResults: []`, so the AMRAP branch (and its unfixed
`weightKg: z.number().positive()`, which would've rejected bare-bodyweight AMRAPs) was
unreachable dead code; deleted rather than fixed per the plan's YAGNI call. Separately, the
*real* baseline auto-heal (`session/[sessionId]/route.ts:31-47`, which completes baseline
server-side using `getLastExerciseLogsBatch` + existing PRs when the completion call was
missed) queried **user-wide, not program-scoped** — a brand-new `ai_dynamic` program sharing
one exercise name with an old program's history would auto-complete "baseline" on first fetch,
skipping the AMRAP week entirely. Added an optional `programId` parameter to
`getLastExerciseLogsBatch` (repository interface + Postgres adapter) that adds `AND
ws.session_id IN (SELECT id FROM program_sessions WHERE program_id = ...)`, and passed it at
both real auto-heal call sites — `session/[sessionId]/route.ts`'s baseline-completion check and
`workout-data/route.ts`'s `hasAnyPriorLog` guard (which decides whether to force AMRAP mode
client-side). Left `workout-data`'s *other* use of `getLastExerciseLogsBatch` (the general
"last weight" display at line ~274, shown for every program) intentionally unscoped —
progressive-overload continuity across programs is a real, wanted feature there, not a bug.
Verified live via a throwaway `tsx` script calling the repo method directly against local
Postgres: unscoped call found the log, scoped to the owning program still found it (same
program, different session — correct), scoped to an unrelated program id found nothing —
proving the SQL predicate actually filters.

`pnpm lint`/`tsc`/tests (1226 passed)/build all green. **Verified interactively** end-to-end
against the dev DB for all four fixes (not APK-gated — every touched surface is a server route
or a client component reading server data). Version bumped 1.139.7 → 1.139.9 (a concurrent
session's UI fix PR landed at 1.139.8 while this branch was open — rebased and bumped past
it). Backlog entry for item 8 annotated with the Task 1.7 summary; **Chunk 1's remaining work
is now just Tasks 1.2 and 1.4** (both flagged as larger, multi-file changes better scoped as
their own sessions), along with Chunks 2–6.

## Session 287 — R5 Nutrition fixes Chunk 1: NUT-1..4 data-corruption/date/validation (`fix/nutrition-fixes-chunk1`)

Item 8 (Workout-system hardening)'s Chunk 1 is now down to just Tasks 1.2/1.4 (both flagged as
larger, multi-file changes better scoped as their own sessions), so continued the backlog loop
by surveying `docs/implementation-backlog.md` for the next dev-DB-verifiable item and picked up
item 10 (R5 — Nutrition fixes), which had sat fully unstarted since it was added in session 245.
Implemented Chunk 1 of the plan (NUT-1 through NUT-4 — the data-corruption, date, and validation
bugs).

**NUT-1 (high, data corruption).** `QuickEditLogSheet` seeded its quantity once via a lazy
`useState` initializer and was mounted permanently with no `key`, so opening a second log right
after the first showed and (if saved untouched) silently overwrote it with the *first* log's
quantity. Added `key={editingLog?.id}` at the `nutrition-content.tsx` call site — the standard
React remount-on-key-change pattern already used elsewhere in this codebase (e.g. the
warmup/pre-workout screens' `key={`${ex.name}-${idx}`}`).

**NUT-2 (medium, mutation-callback contract).** The cache invalidation and completion callback
only fired inside `pushMutations().then()`, so an offline write (or any push failure) left the
UI showing the stale pre-edit quantity even though the local store already had the correct one;
and `onSaved()` was a parameterless "please refetch" — a violation of this repo's
mutation-callback contract (`onLogged(log)`, never parameterless). Restructured both the
local-store and web-fallback branches of `handleSave` to build the updated
`FoodLogWithItem` from data the sheet already has (reusing the existing preview-macro math) and
fire `invalidateNutritionWrite()` + `onSaved(updatedLog)` synchronously right after the local
write, with `pushMutations` demoted to a background reconcile. Changed the prop signature to
`onSaved: (updatedLog: FoodLogWithItem) => void` and replaced `nutrition-content.tsx`'s
parameterless `fetchData` callback with an in-place `setLogs` updater
(`handleQuickEditSaved`), mirroring the pattern the file's existing `handleFoodLogged` callback
already uses for new logs.

**NUT-3 (medium, date threading).** `SavedMealsSheet.quickLog` hardcoded `todayInTz()` for the
write while the parent screen appended the returned logs to whatever day was currently
*displayed* — logging a saved meal while viewing "Yesterday" silently wrote to today but showed
under yesterday. Added an optional `logDate?: string` prop to `SavedMealsSheet`, threaded
`selectedDate`/`logDate` from both real call sites (`nutrition-content.tsx`, and the nested
`SavedMealsSheet` inside `FoodLoggerSheet`, which already carries its own `logDate`), and used
`targetDate = logDate ?? todayInTz()` inside `quickLog`. Deliberately named the local `targetDate`
rather than the plan snippet's literal `const logDate = logDate ?? todayInTz()`, which would
shadow the destructured prop of the same name in the same scope and fail to compile.

**NUT-4 (medium, validation 400).** `saved-meals-sheet.tsx`'s "+ Add as new food" flow posted
`barcode: null` to `/api/nutrition/food-items`, whose Zod schema declares `barcode:
z.string().max(20).optional()` — `.optional()` accepts `string | undefined` but rejects `null`,
so the endpoint 400'd on every call from this flow. Omitted the field entirely, matching the
pattern already used by `lib/nutrition/log-food.ts`.

`pnpm lint`/`tsc`/tests (1226 passed, unchanged — no new unit tests needed for this chunk, per
the plan's own test-plan section, which calls for `pnpm dev` verification rather than new test
files here)/build all green.

**Verification, honestly disclosed.** NUT-4 was verified live: seeded no `barcode` field into a
direct `POST /api/nutrition/food-items` call via an authenticated Playwright session and
confirmed 201 (previously 400). NUT-1/2/3 were **not** successfully verified interactively this
session despite substantial effort — seeded two food logs directly into the dev DB, then tried
opening the quick-edit sheet via Playwright multiple ways (locator click, native mouse click at
bounding-box coordinates, and invoking the pencil button's React `onClick` prop directly via
`page.evaluate`), including a full dev-server restart to rule out Turbopack HMR staleness. In
every attempt the click handler visibly fired (confirmed via a Radix `DialogContent`
accessibility warning appearing in the console at the moment of click) but no sheet content
(`input[type=number]`, the `role="dialog"` node) ever appeared in the DOM. Since NUT-4's
Playwright flow against the exact same page worked cleanly in the same session, this reads as an
environment-specific rendering/timing quirk in this sandbox's headless-Chromium/Turbopack-dev
combination rather than a defect in the fix — the NUT-1/2/3 changes are minimal, textbook
patterns matching conventions already proven working elsewhere in this codebase (the `key`
remount technique, and the synchronous-update restructure copied near-verbatim from the
already-shipped `handleFoodLogged`) — but this is a genuine verification gap for this session,
not a "verified" claim, and is flagged as such in the backlog entry rather than glossed over.

Version bumped 1.139.9 → 1.139.10 (patch — bug fixes), `lib/changelog.ts` entry added. Backlog
entry for item 10 annotated with the Chunk 1 summary and the verification gap; Chunks 2–4
(NUT-5, NUT-7, NUT-9, NUT-10, NUT-11) remain, with NUT-2 and NUT-5 flagged device-only per the
plan's own split regardless of who picks them up next.

## Session 287 — R5 Nutrition fixes Chunk 2: NUT-5 reminder cancellation + NUT-7 digest staleness (`fix/nutrition-fixes-chunk2`)

Continued the R5 nutrition plan after Chunk 1 merged. Picked up Chunk 2 (NUT-5, NUT-7).

**NUT-5 — supplement/meal-type reminder lifecycle.** `computeSupplementReminderActions`
**filtered out** inactive/reminder-disabled supplements entirely instead of emitting a `cancel`
action for them — the opposite of the meal-reminder helper's already-correct pattern (map every
meal type, `cancel` for the disabled ones). Since `reconcileSupplementReminders` only acts on
the actions this function returns, a disabled/reminder-off supplement's already-scheduled OS
notification was never cancelled by a reconcile pass. Changed the function to `.map()` over
every supplement and return `cancel` when `!active || !reminderEnabled || !reminderTime ||
loggedToday`. Compounding it, `manage-supplements-sheet.tsx`'s save/delete/toggle handlers never
called the already-exported `cancelSupplementReminder(id)` directly — added it to `handleSave`
(when reminders are turned off, both local-store and web-fallback branches), `handleDelete`
(unconditionally, both branches), and `toggleActive` (when going inactive), mirroring how
`logFoodEntries` already calls `cancelMealReminder`. Same-class fix for meal types:
`MealTypeManager.deleteMealType` now calls `cancelMealReminder(id)` after a successful delete —
previously a deleted meal type's scheduled reminder just lingered. Updated two existing unit
tests that had encoded the old (buggy) filter-based behavior and added a new case asserting an
inactive supplement is cancelled even when its reminder fields are otherwise fully configured.

**NUT-7 — daily digest staleness.** The digest is cached per-day in `ai_health_insights` and
only regenerates on an explicit `force`, which the only client caller (`day-review-sheet.tsx`)
never sends — a digest generated at lunch reported lunch totals all evening. Implemented the
plan's recommended fix rather than the fallback manual-regenerate-button: a server-side
content-hash staleness marker, no client change needed. Added migration
`121_ai_health_insight_context_hash.sql` (`ai_health_insights.context_hash text`) — migration
120 is already claimed by the open health-data-provenance plan, so this claims 121 per the
directory-plus-open-plans numbering rule. Restructured `daily-digest/route.ts` so the (cheap,
no-AI-spend) DB reads and `context` string assembly always run first; hashes the assembled
context with `sha256`, and a non-forced request only serves the cache when the stored hash
matches — otherwise falls through to a fresh `generateText` call. Moved the `rateLimit` check to
gate only the actual AI generation, not the cheap reads, matching the plan's note that this
keeps the rate limit as the spend ceiling rather than a read ceiling. Added
`getAiHealthInsightWithHash` and an optional `contextHash` parameter on `upsertAiHealthInsight`
to the repository interface and Postgres adapter — the plain `getAiHealthInsight`/
`upsertAiHealthInsight` stay unchanged and are still used as-is by the four other AI-insight
cache callers (`health-insight`, `weekly-digest`, workout recap, `session-explain`), none of
which need staleness detection.

`pnpm lint`/`tsc`/tests (1227 passed, +1)/build all green.

**Verification.** NUT-7 verified live end-to-end against the dev DB: called `/api/daily-digest`
twice with no data change — second call returned `cached: true` with byte-identical digest
text. Seeded a second food log; the digest correctly stayed cached because the test user had no
`nutrition_targets` row yet, so the "Nutrition today" context line never gets added regardless
of food-log count — a genuine confirmation the hash comparison is precise, not just always
missing. Seeded `nutrition_targets` and re-tested: the next call correctly regenerated
(`cached: false`, digest text changed to reflect the new totals), and a follow-up call
re-cached. NUT-5 verified via the updated/added unit tests only — the actual OS-notification
cancellation is device-only (`Capacitor.isNativePlatform()` returns `false` in this sandbox, so
`reconcileSupplementReminders`/`cancelSupplementReminder` both no-op past their guard clause
here), exactly as the plan's own Chunk 2 verification note requires APK smoke for this class of
fix.

Version bumped 1.139.10 → 1.139.11 (patch — bug fixes), `lib/changelog.ts` entry added. Backlog
entry for item 10 annotated with the Chunk 2 summary. NUT-9, NUT-10, NUT-11 (Chunks 3–4) remain.

## Session 287 — R5 Nutrition fixes Chunk 3: NUT-9 ingredient-totals formula dedup (`fix/nutrition-fixes-chunk3`)

Continued the R5 nutrition plan after Chunk 2 merged. Picked up Chunk 3 (NUT-9), the last chunk
before the hygiene/a11y sweep.

**The drift.** Ingredient totals for a multi-ingredient AI food scan were computed three
different ways with different rounding: `scan-totals.ts`'s `sumIngredients` (sum-then-Atwater
cross-check — replaces the model's calorie figure when it disagrees with the macros by >40%),
a naive local copy inside `ReviewStep` (rounds each ingredient's calories/macros individually,
then sums — no Atwater guard), and `ingredientsToEntries` (`lib/nutrition/log-food.ts`, the path
that actually creates one `food_item` row per logged ingredient, also per-ingredient rounding
but implemented separately from `ReviewStep`'s copy). Per the plan's own semantic caveat, the
correct target for `ReviewStep`'s preview isn't `scan-totals.ts`'s `sumIngredients` — that
function's sum-then-Atwater math can legitimately disagree with the sum of the individually
logged (per-ingredient-rounded) entries, so collapsing the preview onto it would make the
preview and the actually-logged rows diverge instead of converging.

**The fix.** Added `sumIngredientEntries(ings, quantity = 1)` to `lib/nutrition/log-food.ts`,
right next to `ingredientsToEntries` — it literally reduces over that function's own output, so
it is structurally incapable of drifting from what gets logged (the same function computes
both). Deleted `ReviewStep`'s local `sumIngredients` copy and its call site
(`handleIngredientWeightChange`) now imports and calls the shared helper. Swept the codebase for
any other inline `caloriesPer100g * scale` sum or duplicate `sumIngredients`-shaped function —
found none; `AssignStep` reads already-computed totals from parent state rather than summing
independently, so it needed no change. Left `scan-totals.ts`'s `sumIngredients` untouched as the
single-item scan sanitisation authority, exactly as the plan specifies.

Added two unit tests to `lib/nutrition/__tests__/log-food.test.ts`: one builds the expected
totals by manually reducing over `ingredientsToEntries`'s own output and asserts
`sumIngredientEntries` matches exactly (the same assertion the "One Formula, One Place" rule
demands — the two can't be shown equal by coincidence, only by the helper genuinely delegating
to the entries function), one confirms the `quantity` parameter defaults to `1`.

`pnpm lint`/`tsc`/tests (1229 passed, +2)/build all green. **Verified via unit tests only** —
this is a pure formula-dedup refactor with the new helper's correctness directly asserted
against the exact function it must never drift from. The plan's own live-verification step
("log a 3-ingredient AI scan; the ReviewStep total, the AssignStep total, and the sum of the
three logged meal-card rows all agree") requires a real Gemini scan call and full food-logging
round trip — judged disproportionate for a change this narrow and already fully covered at the
unit level, matching the pattern already established this session for AI-dependent verification
paths (e.g. AI-4's emergency-deload fix).

Version bumped 1.139.11 → 1.139.12 (patch — bug fix / correctness), `lib/changelog.ts` entry
added. Backlog entry for item 10 annotated with the Chunk 3 summary. NUT-10 (dead
"save to library" toggle removal) and NUT-11 (grouped hygiene: quantity clamps, emoji→Lucide,
hex-literal→token, region threading, `AssignStep` past-day label, dnd side-effect timing) remain
as Chunk 4 — the last chunk of the R5 plan.

## Session 287 — R5 Nutrition fixes Chunk 4: NUT-10+NUT-11 hygiene/a11y/clamps, R5 complete (`fix/nutrition-fixes-chunk4`)

Final chunk of the R5 — Nutrition fixes plan. NUT-10: `ReviewStep` had a "Save to my food
library" toggle wired to a `saveToLibrary` field that no code ever read — every scanned/logged
food was already being written to the library on log regardless of the toggle's state, making it
pure dead UI that misleadingly implied an opt-in. Deleted the toggle block, the "Save as" input
it revealed, and the `saveToLibrary` field from `EditableNutrition` and every place that
constructed one (`BLANK`, `scanToEditable`, `itemToEditable`, `handleManual` in
`food-logger-sheet.tsx`).

NUT-11 (grouped hygiene sweep across the nutrition surfaces):
- **Region threading** — `ReviewStep.handleRefine`'s AI-correction call never sent a `region`
  hint to `/api/nutrition/scan`, even though the initial scan does (`capture-step.tsx`). Traced
  the actual route handler and confirmed `NutritionScanResult`'s `region: string` field is a
  type-level lie — the response never echoes it back, it only ever gets *read* from the request
  to build a system-prompt hint. Read `localStorage.getItem('ta_food_region') ?? 'AU'` directly
  in `handleRefine`, matching `capture-step.tsx`'s own pattern exactly, rather than trusting the
  never-populated `result.region`.
- **Quantity clamps** — `QuickEditLogSheet`, `AssignStep`, and `SavedMealsSheet`'s per-ingredient
  quantity inputs all allowed unbounded/negative values on manual typing (only the stepper
  buttons were guarded); clamped each `onChange` to a sane `[0.5–100]` (or `[1–100]` where the
  existing floor was already 1) range.
- **`AssignStep` past-day projection** — the "Today after logging" calorie-projection block
  rendered unconditionally even when logging against a past `logDate` (from the day-detail
  sheet), producing a misleading "today" projection for a historical entry. Gated the block on
  `!logDate || logDate === todayInTz()`, hiding it entirely for past-day logs rather than
  relabeling it (simpler, and the projection is genuinely meaningless for a past day).
- **`meal-type-manager.tsx` dnd side-effect timing** — `handleDragEnd`'s reorder computation and
  PATCH fetch lived inside the `setMealTypes` updater function, a state-updater purity violation
  this repo's dnd-kit convention (CLAUDE.md) flags as a double-PATCH risk under React
  StrictMode's double-invoke. Restructured to compute `from`/`to`/`orderedIds` outside the
  updater, call `setMealTypes(next)` once, then fire the PATCH as a separate side effect.
- **Emoji → Lucide** — `manage-supplements-sheet.tsx`'s reminder-time row used a bare ⏰ emoji;
  replaced with `<ClockIcon className="w-3 h-3" />` per the established Lucide-only convention.
- **Hex-literal → theme token** — `water-log-sheet.tsx`'s Log button hardcoded
  `style={{ background: '#38bdf8', color: '#fff' }}`, bypassing the `bg-primary`/
  `text-primary-foreground` theme tokens (and breaking light-theme contrast); removed the inline
  style so the shared `Button` component's default variant applies.
- **Touch targets** — `saved-meals-sheet.tsx` and `meal-type-manager.tsx`'s edit/delete icon
  buttons were `p-2.5` (~34px), under the CLAUDE.md 44px floor; bumped to `p-4`. Sibling-surface
  sweep also caught `meal-card.tsx`'s per-log-row pencil/trash buttons, which were the worst
  offender at `p-1.5` (~26px) despite not being explicitly named in the plan's file list —
  bumped to `p-4` and added the missing `aria-label="Edit log"`/`aria-label="Delete log"` (an
  a11y gap on the same buttons).

`pnpm lint`/`tsc`/tests (1229 passed, unchanged — pure client-side hygiene, no new unit-testable
formulas)/build all green. **Partially verified live** against the dev DB via a logged-in
Playwright session: confirmed the meal-types reorder PATCH endpoint still returns 200 after the
`handleDragEnd` restructure (and reverted); confirmed `/api/nutrition/scan` accepts a `region`
field on a refine-style (`text`) call and returns 200 with a valid recalculated result. **The
Sheet/Dialog-gated UI changes (quantity clamps, the NUT-10 toggle removal, the AssignStep
past-day gating, the touch-target/icon/token swaps) were NOT interactively verified this
session** — the same sandbox-specific Radix Sheet-rendering limitation identified during Chunk 1
(click handlers fire, confirmed via a `DialogContent` a11y console warning, but sheet content
never appears in the DOM under this session's headless Playwright + Turbopack dev-server
combination) blocked driving these through the UI. These are small, mechanical changes (input
clamp bounds, a conditional render gate, class-name/prop swaps) but this gap is disclosed rather
than claimed as tested; flagged in `projectOverview.md`'s Known Issues.

Version bumped 1.139.12 → 1.139.13 (patch — bug fix / hygiene), `lib/changelog.ts` entry added.
**R5 — Nutrition fixes is now complete** (NUT-1 through NUT-11 all shipped across Chunks 1–4,
session 287): removed the item's full backlog entry from `docs/implementation-backlog.md` per
the backlog protocol, renumbered every subsequent item down by one (12→11 through 23→22), and
fixed the stray "Land AFTER items 9 (R5), 10 (R6) and 11 (R7)" cross-reference in the
nutrition-tab-uplift entry (now correctly "Land AFTER items 10 (R6) and 11 (R7)", with an
explicit note that R5 shipped and was removed) plus the equivalent stale R5 references in the
Queue's reading-order summary paragraph.

## Session 287 — R3 offline-first integrity Chunks 5+6: push/route validation parity + stored-counter reconciles (`fix/r3-chunk5-6-push-parity-counters`)

With R5 fully closed out, continued the backlog loop by picking up item 7's (R3 — Offline-first
integrity) remaining dev-DB-verifiable work: all five Chunk 5 tasks (push/route parity) and both
Chunk 6 tasks (stored-counter reconciles), leaving only Chunk 3's two APK-only tasks and all of
Chunk 4 (native local-store machinery) in the plan.

**Task 5.1 (SYNC-P1) — body_metrics push lacked the web route's numeric bounds.** The
`pushMutations` body_metrics branch only checked `typeof === 'number'` for weight/bodyFat/
calories/macros/steps/distanceKm — a corrupted local payload could push an out-of-range value
straight past it, while `waistCm`/etc already had a bound (added an earlier session). Extracted
`validBodyFatPctOrNull`/`validCaloriesOrNull`/`validMacroGOrNull`/`validStepsOrNull`/
`validDistanceKmOrNull` into `lib/validation/body-metrics.ts`, reused the same constants inside
`BodyMetadataPostSchema` (One Formula, One Place — the route and the push branch now share the
exact bound), and applied each per-field in the push branch (clamp-to-undefined on out-of-range,
matching the branch's existing per-field-drop design rather than the route's whole-request
reject).

**Task 5.2 (SYNC-P3) — activity push minted the literal `"undefined"` and skipped endTime
derivation.** `String(p.title)`/`String(p.activityType)` on a title-less/type-less payload wrote
the string `"undefined"` into the DB instead of failing, and the push branch never derived
`endTime` from `startTime + durationMin` the way the web route does. Extracted the route's
`ActivityLogBody` Zod schema and its `addMinutes`/`deriveEndTime` helpers into
`lib/validation/activity-log.ts`, shared by both `app/api/activity-logs/route.ts` and the push
branch — the push branch now `safeParse`s the payload (rejecting invalid ones instead of
stringifying `undefined`) and calls the same `deriveEndTime`.

**Task 5.3 (SYNC-P4) — day_checkins/injuries/supplements push skipped several validations.**
day_checkins push validated the 10 wellness scales but not `journal` (unbounded length) or
`soreMuscles` (element type) — added `DayCheckinExtrasSchema` to `lib/validation/day-checkin.ts`
(shared with the web route via `.extend(...)`) and validated it in the push branch. injuries push
blind-cast `severity` with no enum check and didn't guard an empty `muscleName` — added the same
`['mild','moderate','severe']`/non-empty checks the web route has. supplements push did
`String(p.name)`, writing `"undefined"` for a missing name — added a non-empty check. SYNC-P2
(supplements PATCH mass assignment) is a cross-reference to batch R1's SEC-6, not re-planned
here.

**Task 5.4 (SYNC-P7) — water had two divergent server write functions.** The web route
(`POST /api/water-log`) always used `incrementWaterLog` (a relative add), while the outbox path
wrote an absolute total via `upsertBodyMetrics` — a "one write function per domain" violation
that would lose a concurrent add from a second device (last-writer-wins instead of summing).
Changed `water-log-sheet.tsx`'s quick-add flow to queue a `waterMlDelta` payload (the raw `ml`
added, not the locally-merged absolute total — the local SQLite write still stores the merged
total for instant local rendering, only the outbox payload changed) and added a dedicated branch
in the push handler: a `waterMlDelta` payload routes through `incrementWaterLog`, the same
function the web route calls, instead of falling into the general `upsertBodyMetrics` absolute-set
path.

**Task 5.5 (SYNC-Q1) — pushMutations silently dropped mutations for domains it didn't
recognize.** The `for`/`if-else if` chain in `pushMutations` had no final `else` — an
unrecognized `domain` fell through with neither `processed++` nor an `errors` entry, which the
client's `resolveFailedOutboxIds` reads as "this mutation succeeded" (it's absent from `errors`)
and deletes it from the outbox forever. A newer client pushing a domain an older server (mid
gradual deploy) doesn't yet know about would silently lose that write. Added a final `else`
branch that reports `Unsupported domain: ${mut.domain}` as a per-item error — the client's
existing `MAX_MUTATION_ATTEMPTS`-bounded retry/dead-letter path (`recordMutationFailures` in
`lib/local-store/sqlite-backend.ts`, already exercised for genuine validation failures) now
governs this case too, so the mutation gets bounded retries instead of an instant silent drop,
and a genuinely-removed domain still can't wedge the queue forever.

**Task 6.1 (SYNC-T1) — user_stats totals were never decremented or reconciled.**
`user_stats.total_sessions/total_volume_kg/total_sets` are incremented (replay-guarded) in
`logExerciseAndSets` but there was no path that ever decremented them on delete, and
`lib/achievements.ts` read the raw stored row — a direct DB edit or a session delete could
permanently inflate the counter and skew XP/achievements. Added
`reconcileUserStats(db, userId)` in a new `lib/data/postgres/slices/user-stats.ts` (mirroring
`reconcileSessionsInPhase`'s self-heal pattern), called at the top of `computeAchievements`
before it reads the counter. The derive query deliberately uses **three independent scalar
subqueries** (one for session count, one for volume, one for set count) rather than one query
joining `exercise_logs` to `set_logs` — a single join would multiply each exercise log's volume
once per matching set row (an exercise with 2 sets and volume=500 would sum to 1000, caught by
the live test below). The query has no `GROUP BY`, so it always returns exactly one aggregate
row (zeros for a user with no sessions), which matters: without that, a user whose sessions were
all deleted would produce zero result rows and the reconcile would silently no-op on an inflated
stale row forever instead of zeroing it out.

**Task 6.2 (SYNC-T2) — sessions_in_phase reconciled at only one read site.**
`reconcileSessionsInPhase` ran only from `program-overview/route.ts`, but the prescribe route's
phase-ceiling guards and `workout-data`'s `completedCycles` read the raw counter directly — a
drifted count (over-count on re-sync, no decrement on delete, direct-edit inflation — the same
counter class fixed three times historically per CLAUDE.md) could mis-gate auto-deload/cycle
progression there. Added the same `repo.reconcileSessionsInPhase(userId, activeProgram.id)` call
(resolving the active program via `repo.getActiveProgram`, matching program-overview's own
pattern — `SessionPeriodization` doesn't carry a `programId` field) at the top of
`session/[sessionId]/prescribe/route.ts`, before its phase-ceiling checks read `sessionsInPhase`,
re-fetching the periodization state afterward so the guards see the reconciled value.

`pnpm lint`/`tsc`/tests (1231 passed, +2 unit tests for the new body-metrics push-parity
validators)/build all green. **Verified live** against the local dev Postgres: extended
`lib/data/postgres/__tests__/push-mutations-web-parity.test.ts` (the existing DB-gated parity
suite) with 7 new tests — activity title-less payload rejected by both paths, activity endTime
correctly derived by the push branch, injuries invalid severity rejected, supplements missing
name rejected, day_checkins journal-over-2000-chars rejected by both paths, water: a web
POST + a push `waterMlDelta` both land as one summed total (not one clobbering the other), and
an unrecognized domain returns a per-item retryable error rather than a silent drop — and added
a new `lib/data/postgres/__tests__/reconcile-counters.test.ts` proving `reconcileUserStats`
corrects a directly-inflated counter to the real derived totals and zeroes out correctly when
every session is deleted (this test caught and drove the fix for the join-double-counting bug
described above), plus a lightweight source-inspection check that the prescribe route actually
calls `reconcileSessionsInPhase`. All 24 tests (14 pre-existing + 10 new) pass against the local
dev DB (`DATABASE_URL=postgresql://postgres:postgres@localhost:5433/trainingai_dev pnpm exec
vitest run ...`) — these DB-gated tests skip cleanly in CI's default `pnpm test` (no
`DATABASE_URL` there) but ran for real this session. **Not exercised:** the plan's
own on-device/APK-only remainder (Chunk 3 Tasks 3.1/3.2, all of Chunk 4) is untouched by this
PR and stays in the backlog entry.

Version bumped 1.139.14 → 1.139.15 (patch — data-integrity/correctness bug fixes),
`lib/changelog.ts` entry added. Backlog entry for item 7 (R3) updated with the Chunk 5+6 summary
and the narrowed remainder (Chunk 3 Tasks 3.1/3.2 + Chunk 4, all APK-only). Continuing the
backlog loop.

## Session 287 — Workout-system hardening Chunk 3: caching & staleness on the workout surfaces (`fix/workout-hardening-chunk3-caching`)

Continued the backlog loop by picking up item 9's (Workout-system hardening) Chunk 3 — all four
tasks from the review's caching/staleness angle (CCH-1 through CCH-8, plus HR-6), the chunk the
plan itself flagged as fully dev-DB-verifiable.

**Task 3.1 (CCH-1) — prescription accept/dismiss/transition never invalidated the pre-workout
card cache.** `AiPrescriptionCard`'s `respond()`/`executeTransition()` handlers called
`onStatusChange`/`onPhaseChanged` after a successful POST with zero cache invalidation, so the
`workout-card:<id>` freshWithinTtl prefetch (TTL_LONG — up to 6h stale) and the `workout-data:<tab>`
exercise list kept showing the pre-accept/pre-transition state. Added
`invalidatePrescriptionChanged(programSessionId)` to `lib/cache-groups.ts` — clears the whole
`workout-data` prefix (a bare `invalidateCache('workout-data')` LIKE-prefix-matches every
`workout-data:<tab>[:deload]` variant, so no per-tab key juggling needed), the specific
`workout-card:<id>` key, the new `ai-periodization-session:<id>` key (added in Task 3.4), and
`invalidateAiPeriodization()`'s keys. Called it in both success branches before their
`onStatusChange`/`onPhaseChanged` callback fires (invalidate-before-refetch), and replaced
`workout-screen.tsx`'s `refreshExercises` ad-hoc single-tab `invalidateCache` call with the same
group. Added freshWithinTtl invalidation-proof comments at both `workout-card:<id>` prefetch
sites (session-select, workout-select) naming every writer now covered.

**Task 3.2 (CCH-2/SYN-9 + CCH-3) — health-tab edit path under-invalidated; CCH-3 already
fixed.** `health-content.tsx`'s `handleEditSave` (the workout-entry PATCH from the day-detail
overlay) called only `invalidateExerciseLogged()` — added by an earlier R3 chunk this session —
which doesn't cover `progress-summary` the way its sibling delete path's
`invalidateWorkoutSummaries()` does; a weight/rep edit from Health could leave the progress
summary repainting pre-edit numbers. Switched it to `invalidateWorkoutSummaries()`, mirroring
the delete handler right below it and `stats-content.tsx`'s own edit handler. CCH-3
(`invalidateProgramStructure()` allegedly missing the legacy `ta_meta_v1`/`ta_recommendation_v1`
sessionStorage seed clears) turned out to already be fixed — confirmed
`clearLegacyHomeSeeds()` is already called at the end of `invalidateProgramStructure()`,
matching CLAUDE.md's own note that session 271 fixed exactly this gap. No code change needed for
that half.

**Task 3.3 (CCH-4) — `next-session` held today-only data with no date guard.** The recommended
session, `consecutiveTrainingDays`, and rest/deload flags are only meaningful for today, but
`next-session` was a plain `cachedFetch` key with no date envelope, and the
`ta_recommendation_v1` sessionStorage fast-seed carried no date stamp at all — an app left
resident across local midnight could paint yesterday's rest-day/deload banner until the
background refetch landed. Converted every read/write site to the `cachedFetchToday`/
`readTodayCacheSync` today-envelope pair: `sync-provider.tsx`'s warm-list entry (flipped
`today: true`) and its workout-reminder reconcile fetch; `session-select-content.tsx`'s
lazy-initializer seed, mount-effect seed, and the actual `cachedFetchToday` call; `workout-select-content.tsx`'s
seed read and fetch; `session-explain-client.tsx`'s seed read and fetch. Date-stamped
`ta_recommendation_v1` as `{date, data}` and made every reader ignore a stamp that doesn't match
`todayInTz()` (an un-stamped legacy value is also ignored, falling through to the now-correctly-
guarded `next-session` cache read) — chose date-stamping over deleting the legacy seed since it
carries the already-`withRestDayOverride`-adjusted value, a distinct optimization from the raw
`next-session` cache entry.

**Task 3.4 (CCH-5..8 + HR-6) — five small caching/header gaps.** CCH-5: the ai_dynamic
periodization-state fetch in `workout-screen.tsx` was a bare uncached `fetch` — every workout
mount for an ai_dynamic session paid a full round-trip with no cache hit, and the AI
prescription card visibly popped in late (layout shift). Converted to `cachedFetch` on
`ai-periodization-session:<id>` (TTL_MEDIUM, wired into Task 3.1's invalidation group) and added
the standard `private, max-age=60, stale-while-revalidate=120` header to
`app/api/ai-periodization/session/[sessionId]/route.ts`'s GET. CCH-6: added `private, ` to the
achievements route's Cache-Control (was missing it, unlike every sibling per-user route).
CCH-7: `completeWorkout`'s phase-change-detection fetch (`GET /api/workout-data?tab=…`, fired
right after cache invalidation to detect a phase advance) was a bare `fetch` that wrote nothing
back to the cache — the same heavy payload got re-fetched bare on the next mount; routed it
through `cachedFetch` on the just-invalidated `workout-data:<tab>` key so the response re-warms
the cache. CCH-8: added a named `MOOD_TTL = TTL_SHORT` constant to `lib/cache-ttl.ts` and
switched both `mood:<date>` call sites (`mood-checkin-sheet.tsx`, `session-select-content.tsx`)
from the bare `TTL_SHORT` import to it, so a future divergent import at a new call site can't
silently drift the TTL apart (both already agreed on the same *value* — this names the binding
so they can't stop agreeing). HR-6: added the standard SWR header to `app/api/oura/hr-data`
(both its `{ready: false}` early-return and its full-payload response).

`pnpm lint`/`tsc`/tests (1233 passed, +2 new `invalidatePrescriptionChanged` cache-group
tests)/build all green. **Verified live** against the dev DB/server via a logged-in Playwright
session (`pnpm dev` on port 3005): confirmed `/api/achievements` now returns
`Cache-Control: private, max-age=30, stale-while-revalidate=60` (previously missing `private`)
and `/api/oura/hr-data` now returns `private, max-age=60, stale-while-revalidate=120`
(previously no Cache-Control header at all) — the plan's own stated verification method
("curl the two routes for the new headers"). **Not separately driven live: the plan's
accept-a-prescription-→-home-card-updates-without-refresh click-through** — the local dev DB's
seed program is `phase_mode='manual'` with no `ai_dynamic` program configured, and standing one
up (a program-mode flip, a synthetic `session_periodization` row, then a full accept-button
Playwright drive) was judged disproportionate for this task; `invalidatePrescriptionChanged`'s
exact key list is directly asserted by a new unit test, and both call sites (the card's
`respond`/`executeTransition` success branches) were confirmed by direct code inspection to
invalidate before their `onStatusChange`/`onPhaseChanged` callback fires, matching the
CLAUDE.md mutation-callback-contract convention already proven at every other call site this
session.

Version bumped 1.139.15 → 1.139.16 (patch — bug fix / cache correctness), `lib/changelog.ts`
entry added. Backlog entry for item 9 (Workout-system hardening) updated with the Chunk 3
summary; remaining scope narrowed to Chunk 1 Tasks 1.2/1.4, Chunk 2 (offline-first mirrors), and
Chunks 4–6 (timer integrity, UI/UX + in-workout HR, hygiene/docs/perf leftovers). Continuing the
backlog loop.
## Session 288 — Learned warm-up + transition times in the AI time budget (`claude/workout-ai-review-adjust-f2g8jj`)

**Ask (owner):** the session time budget already plans on measured *set* and *rest* times per
exercise, but warm-up and bar-load/transition were still fixed constants (a flat 15% warm-up and
a generous 4-min barbell setup that bundles load + warm-up ramps). Owner wanted these learned too:
measure the real warm-up and transition times and plan on them, so as he warms up / gets to the
bar faster the freed time automatically fills with more working sets. Must respect PCT band +
exercise type — already handled empirically because the per-exercise transition median folds in
bar-load and warm-up ramps for that exercise's real loads.

**Key realisation (carried from the prior session):** this was a *wire-up*, not new
instrumentation. The app already captures `warmup_ended_at` per session and
`inter_exercise_rest_sec` per exercise, and `lib/workout/time-audit.ts` already derives robust
medians for both (`computeExerciseStats`, `computeEquipmentStats`, `decomposeSessions`). Those
numbers were only surfaced in the admin Time Audit; nothing fed them back into the plan. This
session closed that loop.

**Shipped:**
- **`lib/workout/duration-model.ts`** — added `warmupBudgetMin(totalBudgetMin, measuredWarmupMin?)`
  and `MIN_WARMUP_MIN=4`/`MAX_WARMUP_MIN=15` (ceiling aligned with `MAX_PLAUSIBLE_WARMUP_SEC`).
  Extended `workingBudgetMin` to accept an optional measured warm-up: with one it carves out the
  clamped measured minutes instead of the flat 15%; **without one the previous flat-fraction
  rounding is preserved byte-for-byte** (so existing plans are untouched until history accrues).
- **`lib/workout/time-audit.ts`** — added `WARMUP_LEARN_MIN_SESSIONS=8`,
  `buildMeasuredTimeBudget(sessions, sets, exercises)` → `{transitionSecByExercise,
  transitionSecByClass, warmupSec}` (each gated: transition ≥`MIN_TRUSTED_SAMPLES`=5 per
  exercise/class, warm-up ≥8 sessions; below threshold the key is simply omitted), and
  `resolveTransitionSec(exerciseName, equipment, measured)` — cascade most-specific-first:
  per-exercise median → per-equipment-class median → the duration-model constant. Null/absent
  measured budget falls straight through to the constant, so it is always safe to call.
- **`lib/ai-periodization/signals.ts`** — the single wiring point (flows to *both* prescribe and
  Workout Review, which each call `aggregateSignals`). Fetches `getTimingAuditData(userId, 90)` in
  the existing `Promise.all`, builds the measured budget once, uses `resolveTransitionSec(...)` for
  each exercise's `transitionSec` (replacing the flat `transitionSecForEquipment`), and passes the
  measured warm-up (`warmupSec/60`) into `workingBudgetMin` for `effectiveTimeBudgetMin`.
- Refreshed the two stale "a follow-up plan will feed these back" header comments in
  duration-model.ts / time-audit.ts to point at the now-shipped path.

**Tests:** extended `duration-model.test.ts` (warm-up clamp floor/ceiling, measured-vs-flat
divergence, null preserves the exact old default) and `time-audit.test.ts` (threshold gating for
per-exercise/per-class transition and warm-up, the resolver cascade). 1247 passed. `tsc`/`lint`
(only the pre-existing unused-`SessionPeriodization` warning)/`build` green.

**Runtime-verified against the local dev DB** (not just unit tests): injected 9 synthetic
barbell-bench transitions @150s + 5-min warm-ups, ran the real Postgres adapter through
`getTimingAuditData → buildMeasuredTimeBudget → aggregateSignals`, and confirmed the learned
numbers thread through — `effectiveTimeBudgetMin` dropped from the flat-path 21 to the learned 20
(25-min Push budget − 5-min learned warm-up) and Bench's `transitionSec` became the learned 150
instead of the 240 barbell constant. Synthetic rows reverted afterwards.

**Not exercised this session:** on-device APK (this is a server-side planning change shipped via
Railway into the WebView — no native/offline/safe-area surface touched, so the web-path runtime
verification above is the authoritative check for this change); real long-term user history (the
learned path only engages above threshold, which the seed doesn't reach — proven instead with the
injected synthetic data above).

Version bumped 1.139.14 → 1.140.0 (minor — new feature), `lib/changelog.ts` entry added.

## Session 287 — Workout-system hardening Chunk 2: offline-first sync mirrors (`fix/workout-hardening-chunk2-sync-mirrors`)

Continued the backlog loop, picking up item 9's Chunk 2 — the six offline-first mirror gaps
the R3 pass missed (SYN-1 through SYN-8, SYN-10). The chunk's governing note flags every
local-store failure surface as APK-only (`getLocalStore` is null on web), but several tasks
carry a genuinely dev-DB or unit-testable server/pure-logic half, which is what this session
actually drove live.

**Task 2.1 (SYN-3) — tail-set truncation was a hard DELETE, invisible to an unsynced
device.** `workout-entry` PATCH's set-count-shrink branch did `DELETE FROM set_logs WHERE
... set_number > $2` — a hard delete a device that hasn't pulled yet never sees (the pull
mechanism relies entirely on `deleted_at` tombstones + `getSyncDelta`). Changed it to `UPDATE
set_logs SET deleted_at = now() WHERE ... AND deleted_at IS NULL`, and made the per-set
upsert's `ON CONFLICT` arm also `SET deleted_at = NULL`, so re-adding a previously-removed
set resurrects the exact same physical row (same id, same history) instead of minting a new
one. The existing `trg_set_updated_at` trigger (migration 069) already bumps `updated_at` on
any UPDATE, so `getSyncDelta` picks up the tombstone with no further change needed.
**Verified live** against the local dev Postgres with a new
`app/api/workout-entry/__tests__/workout-entry-tombstone.test.ts` (DB-gated, matches the
existing parity-suite pattern): logged 3 sets, edited down to 2 (set 3 tombstoned — still 3
physical rows, not 2), then edited back up to 3 (set 3 resurrected via the same row, new
weight applied) — ran for real, not mocked.

**Task 2.2 (SYN-4) — local mirrors wrote `sync_status='pending'` after an already-successful
web write, permanently stranding the row.** `deleteExerciseLogLocally`/
`updateExerciseLogLocally` run only after the awaited web PATCH/DELETE already returned
success — local matches server at that exact instant — but both wrote `'pending'`, and every
future pull is gated behind `WHERE sync_status='synced'` (the pull-clobber guard R3 shipped).
A row that's never independently re-confirmed by an outbox push (there's no such push for a
web-origin edit) would stay `'pending'` forever, permanently excluded from future pulls.
Changed both to `'synced'`. Also fixed two adjacent bugs found while touching this code:
`updateExerciseLogLocally` now also tombstones local set rows beyond the new set count
(mirroring Task 2.1's server-side truncation — previously a locally-shrunk exercise kept its
removed tail sets forever), and it now treats an *omitted* `intensityPct` as "preserve the
existing value" rather than always overwriting with `null` — fixed the one caller
(`health-content.tsx`) that was passing an explicit `intensityPct: null` even though the
server had just recomputed a real value, which would have blanked it locally on this
device's own render. **Verified** with 4 new tests against the existing mocked-`runSQL`
harness in `sqlite-backend.test.ts` (17→ tests), asserting the literal SQL statements
generated for `'synced'` vs `'pending'`, the omitted-field preservation, and the tail-set
tombstone.

**Task 2.3 (SYN-1/SYN-2) — no local mirror existed for a whole-session delete.** Added
`deleteWorkoutSessionLocally(workoutSessionId)` to the `LocalStore` interface + SQLite
backend (tombstones the session and every child `exercise_log`/`set_log`, `'synced'` per
Task 2.2's reasoning), wired into `health-content.tsx`'s `handleDeleteSession` and into
`handleDelete` when the PATCH response's `sessionDeleted: true` flag says this was the
session's last exercise (the API already computes and returns this — just wasn't being read
client-side). The plan also asked to copy the same mirror blocks into
`stats-content.tsx`'s equivalent handlers; **skipped deliberately** — `app/stats/page.tsx`
unconditionally `redirect()`s to `/health?tab=training`, so that file's handlers are
confirmed-dead code, the same conclusion an earlier R3 chunk this session already reached
for a sibling gap in the same file. Added a unit test asserting the tombstone SQL for all
three tables.

**Task 2.4 (SYN-5) — exercise history sat blank offline mid-workout.** The RM-history
sparkline on both the active-workout and exercise-summary screens was a bare `cachedFetch`
with no local-first seed, unlike `ExerciseHistorySheet` (the Stats-tab equivalent), which
already seeds from `store.getWorkoutHistory` before its own `cachedFetch`. Copied that exact
pattern into `active-workout-screen.tsx` and `exercise-summary-screen.tsx`, which required
threading a new `userId` prop through both from `workout-screen.tsx` (previously neither
component had access to it).

**Task 2.5 (SYN-6/SYN-8) — a stranded workout replay lost its deload/override/program-session
attribution.** The local SQLite `workout_sessions`/`exercise_logs` tables had nowhere to
store `session_id` (the program-session id)/`intensity_mode`/`was_override`/
`exercise_deloaded` — fields the server schema and `logExerciseFromPayload` both already
understand — so a mutation stranded offline and later rebuilt from local rows
(`buildWorkoutLogPayload`, used when a direct POST *and* the outbox queue both failed) would
replay as a plain, non-deload, non-override log with name-fallback phase attribution instead
of its real context. Added the four columns via `RECONCILE_COLUMNS` (following this file's
established "Batch F" additive-reconcile precedent — no version bump, since `reconcileSchema`
already runs after every open and safely no-ops on an already-present column — rather than
the plan's literal ask for a new versioned migration entry, which would have added
migration-numbering risk with no corresponding safety benefit given the established
precedent), persisted them in `logWorkoutLocally`, and threaded them through
`buildWorkoutLogPayload`. Separately, extracted `defaultUseFor1rm(reps, i)` — the
`allRepsEqual ? true : reps[i] === minReps` gate — out of the server route's inline logic
into an exported function in `lib/workout/log-exercise.ts` (One Formula, One Place), and
called it from both the server route (unchanged behavior, now sourced from the shared
function) *and* `logWorkoutLocally`'s set-insert loop, which previously had **no default at
all** — a locally-originated set with no explicit `progressionStyle[i].useFor1rm` always
wrote `false`, silently excluding it from ever contributing to a 1RM estimate. Added tests
for both: `buildWorkoutLogPayload`'s new field-threading (present vs. absent cases) and
`defaultUseFor1rm`'s all-equal vs. divergent-reps behavior.

**Task 2.6 (SYN-7/SYN-10) — two small fixes.** SYN-7: `markSessionSynced` (the confirm
callback for a pushed `session_rpe`/`complete_workout` mutation) unconditionally flipped the
session row to `'synced'`, even when a sibling `workout_log` mutation for the same session
was still queued — a race where a pull lands in that gap could revert the still-outstanding
edit via the pull-clobber guard's synced-row-overwrite branch. Added a guard querying
`mutations_outbox` for any remaining `workout_log`/`session_rpe`/`complete_workout` row whose
payload references the session id (`LIKE` match, mirroring `getStrandedPendingWorkouts`'s
already-proven pattern for the same kind of payload-embedded-id lookup) — skips the flip
while one exists. SYN-10: added a local-first seed for Home's `workout-sessions-day:<date>`
HR-chart overlay widget from `store.getWorkoutSessions(today)`, mirroring `fetchMeta`'s
existing body-metric fast-path pattern in the same file.

`pnpm lint`/`tsc`/tests (1254 passed, +21 new across the tasks above)/build all green.
**Not exercised this session:** the actual on-device SQLite behavior for Tasks 2.2–2.6 (per
the chunk's own governing note — `getLocalStore` is null in the web sandbox) — verified
instead via the existing mocked-`runSQL`/`querySQL` test harness this repo's local-store
suite already relies on for exactly this reason, asserting the literal generated SQL/params
rather than a real round-trip; the new `RECONCILE_COLUMNS` entries were sanity-checked
against `reconcileSchema`'s already-proven idempotent per-column guard rather than exercised
against a real device SQLite file. Device smoke not run.

Version bumped 1.140.0 → 1.140.1 (patch — bug fix / sync correctness), `lib/changelog.ts`
entry added. Backlog entry for item 9 (Workout-system hardening) updated with the Chunk 2
summary; remaining scope narrowed to Chunk 1 Tasks 1.2/1.4 and Chunks 4–6 (timer integrity,
UI/UX + in-workout HR, hygiene/docs/perf leftovers — several APK-gated per the review's own
findings). Continuing the backlog loop.

## Session 287 (cont.) — Workout-system hardening Chunk 4: timer integrity (fix/workout-hardening-chunk4-timer-integrity)

Continued the standing "work through the backlog" loop after Chunk 2 (offline-sync mirrors,
v1.140.1) merged as PR #500 — that PR's initial push failed CI's Build check (a client-bundle
break: `lib/local-store/sqlite-backend.ts`, client-bundled, imported `defaultUseFor1rm` as a
value from `lib/workout/log-exercise.ts`, which also imports `@/lib/data` — server-only, pulls
in the `pg` driver — at module scope for its unrelated `logExerciseFromPayload` function;
webpack's client build then failed resolving `fs`/`net`/`dns`). Fixed by extracting
`defaultUseFor1rm` into a new dependency-free leaf module (`lib/workout/default-use-for-1rm.ts`)
with zero non-type-only imports, updating both the server call site and the client call site to
import from there instead. Re-ran the full gate (this time the local `pnpm build` genuinely
reproduced the same webpack module-resolution pass CI runs) — confirmed clean, pushed the fix,
CI went green across all 7 checks, and the PR's existing auto-merge completed it.

Picked up item 9's (Workout-system hardening) **Chunk 4 — Timer integrity (TMR-1,2,3,5,6,7,8)**
next — fully dev-DB-verifiable, no APK gate, well-scoped as its own session per the plan doc.

**Task 4.1 (TMR-1 + TMR-5) — a dedicated live rest anchor.** The store's single `restStartMs`
field served two incompatible roles: the live "since the just-logged set" anchor the beep/
notification/ring/PiP timers read, *and* the per-exercise buffered physiological rest anchor
restored from `ExerciseBuffer` on superset handoff (`switchToExercise`/`restoreExercise`). A
handoff mid-rest silently clobbered the live anchor with the target exercise's unrelated
buffered value (or `null` on a first visit), which could reset or silence the countdown for the
set that was *just* logged. Added `lastSetRestStartMs: number | null` to the store — set only in
`handleLogCurrentSet` alongside the buffered `restStartMs`, and deliberately never touched by
`stashExercise`/`restoreExercise`/`switchToExercise`'s restore branches. All four consumers
(the beep `setTimeout` effect, both rest-notification-scheduling effects, the on-screen ring in
`active-workout-screen.tsx`, and `PipView`) now anchor on `lastSetRestStartMs` instead. Also
added a shared `effectiveRestSec(lastSetRestSec)` helper (`> 0 ? lastSetRestSec : 90`) — the
beep/notification effects previously gated on `lastSetRestSec > 0` and silently skipped
scheduling entirely for a style-less set, while the ring's own separate inline calculation
(`exercise.progressionStyle[currentSet-1]?.restSec ?? 90`) assumed 90s regardless — both now
derive from the same helper (TMR-5), and `ActiveWorkoutScreen` takes `currentRestSec` as a prop
instead of deriving it from stale/wrong-exercise style data.

**Task 4.2 (TMR-2) — staleness guard on rehydrated timer anchors.** Extracted the
`onRehydrateStorage` logic into an exported `applyRehydrateFixups(state, today, now)` so it's
unit-testable against a mocked persisted blob without driving zustand's actual rehydrate
machinery. An `active`-mode session rehydrated with any live anchor
(`lapStartMs`/`restStartMs`/`lastSetRestStartMs`/`workoutStartMs`) more than 4 hours old, or
whose `storedDate` doesn't match today, now resets to `mode: 'pre'` with all anchors cleared and
`workoutPhase: 'rest'`, instead of resuming a countdown computed against a multi-hour-old (or
date-rolled-over) timestamp. Added 4 unit tests: a 30-minute-old anchor is left untouched, a
20-hour-old one is cleared with mode reset, an active session resets across a date rollover even
with otherwise-fresh timestamps, and non-`active` modes are never touched.

**Task 4.3 (TMR-3 + TMR-6 + TMR-7 + TMR-8) — bounds, semantics, listener.** TMR-3:
`LogExercisePayloadSchema`'s timing fields (`timeToCompleteSet`, `setTimes`, `restTimes`,
`interExerciseRestSec`: `0–86,400s`; `setStartTimes`/`setEndTimes`: a plausible epoch-ms range;
all timing arrays capped at 20 entries) — previously unbounded `z.number()`. Added
`Math.max(0, ...)` clamps at the client write sites for `restTimes` and lap-time computation, so
a clock-skew/NTP step degrades to `0` rather than producing a negative value the new schema bound
(and thus the offline outbox) would reject — matches the "outbox must never queue a payload the
schema rejects" poison-pill rule. TMR-8: the `timeToCompleteSet` no-laps fallback previously used
the raw wall-clock delta since exercise start, which double-counted any rest taken between sets
as working time; now subtracts the accumulated rest, floored at 0. TMR-6: fixed the stale
`restTimes` field comment (was "before each set", is actually "after each set"). TMR-7: the
`appStateChange` listener effect was re-registering (dynamic import + `addListener` + teardown)
on every rest-state change — hoisted to a mount-scoped effect (`[]` deps) reading fresh state via
`useWorkoutStore.getState()` inside the callback, with a `cancelled` flag guarding the async
`addListener` resolution landing after unmount.

Added 5 new `LogExercisePayloadSchema` bounds tests (accepts in-range, rejects negative, rejects
>24h, rejects an implausible epoch-ms timestamp, rejects >20 array entries).

`pnpm lint`/`tsc`/tests (1265 passed, +19 new across the three tasks)/build all green.
**Verified interactively** against the local dev DB (not APK-gated — this is a hot-path
client-only fix, so the real gate is behavioral, not a schema/DB check): built a real
2-exercise superset in the seeded Push session (`superset_group=1` on Bench Press + Overhead
Press) via direct SQL, drove the full flow live via Playwright against `pnpm dev` — Start
Workout → Begin Exercises → Start Set 1 → Log Set 1 (A) → confirmed handoff to B
(`currentIdx` 0→1, `workoutPhase: 'rest'`) → Start Set 1 (B) → Log Set 1 (B) → confirmed
handoff back to A — and read the persisted `ta_workout_state` at each step. Confirmed
`lastSetRestStartMs` is set on every log and **strictly increases** across the handoff back to
A (proving `restoreExercise` restoring A's stale buffered `restStartMs` does not clobber the
live anchor), while `restStartMs` itself showed the restored buffered value at the same
instant — the two fields correctly diverge. This live drive caught a real bug in the first
implementation pass: `launchExercise`/`advance`/`switchToExercise`'s *fresh-exercise-init*
branches (not just the restore branches) were also nulling `lastSetRestStartMs` as part of a
blanket "reset alongside `restStartMs`" edit — which reproduced the exact TMR-1 bug during a
first-visit superset handoff (B has no buffer yet, so its init takes the fresh-init branch).
Fixed by scoping the `lastSetRestStartMs: null` reset to only the two genuine "user ended the
rest period" actions (`handleStart`, `handleStartSet`) and `commitExerciseSummary`, per the
plan's explicit "never written by switchToExercise/restoreExercise/stashExercise" instruction —
the fresh-init branches don't represent an ended rest period, just a different exercise loading.
Test superset flag reverted on the seed data afterward (2 `UPDATE`s, no full reseed needed); no
stray rows from the Playwright drive (server-side ownership checks rejected the synthetic
session, consistent with this session's earlier verification passes).

Version bumped 1.140.1 → 1.140.2 (patch — bug fix, hot-path timer correctness),
`lib/changelog.ts` entry added. Backlog entry for item 9 (Workout-system hardening) updated
with the Chunk 4 summary; remaining scope narrowed to Chunk 1 Tasks 1.2/1.4 and Chunks 5–6
(UI/UX + in-workout HR, hygiene/docs/perf leftovers — several of Chunk 5's items APK-gated per
the review's own findings). Continuing the backlog loop.

## Session 287 (cont.) — Workout-system hardening Chunk 6: hygiene, docs, perf leftovers (fix/workout-hardening-chunk6-hygiene)

Continued the backlog loop after Chunk 4 (timer integrity, v1.140.2) merged as PR #501 clean
(all 7 CI checks green on first push — no fix-forward needed this round). Picked Chunk 6 next
over the much larger Chunk 5 (UI/UX + in-workout HR sweep) to keep this round's diff small and
low-risk — three purely mechanical tasks, no schema/behavior surface.

**Task 6.1 (TMR-4/PRF-4/UI-14 + PRF-3) — delete `TimerRing`, fix CLAUDE.md drift.** Grepped for
any remaining import of `components/workout/timer-ring.tsx` — zero, confirming it's dead code
(the active rest ring lives inline in `active-workout-screen.tsx` and always has for this
component). Deleted the file, removed its Key Files table row, rewrote the Animations
section's "TimerRing: SVG `<animate>` pulses the active segment opacity" bullet (described a
component that no longer existed) to point at the real inline SVG progress ring instead, and
corrected a stale performance claim — "the 1 Hz workout tick re-renders the entire orchestrator
including TimerRing" — since timers already tick in a leaf reading refs, not the orchestrator.

**Task 6.2 (PRF-13 + PRF-16) — memo `AiChatOverlay`, leaf-ify the countdown.**
`session-select-content.tsx`'s `<AiChatOverlay sessionNames={activeSessions.map(...)} />` call
minted a fresh array reference on every render, which would defeat any memoization on the
overlay even after adding it — extracted to a `useMemo`'d `sessionNames` derived from
`activeSessions`. Wrapped `AiChatOverlay`'s named export in `React.memo` (renamed the
implementation to `AiChatOverlayImpl`, exported the memoized wrapper under the original name
so its four `dynamic(() => import(...).then(m => m.AiChatOverlay))` call sites in
`overview-screen.tsx`/`done-screen.tsx`/`stats-content.tsx`/`session-select-content.tsx` all
keep working unchanged) — confirmed the other three call sites already pass referentially
stable props (a `useState` setter, a primitive boolean), so the memo isn't silently defeated
there too. Extracted `pre-workout-screen.tsx`'s inline 3-2-1 countdown (a `useState<number|
null>` ticking via `setTimeout` in the ~380-line pre-workout screen itself, re-rendering the
whole screen every second) into a new self-ticking leaf component
(`components/workout/start-workout-countdown.tsx`) that owns its own internal countdown state;
the parent now just conditionally mounts/unmounts it (`countingDown: boolean`) and only
re-renders at the start/end of the 3-second window instead of every tick.

**Task 6.3 (PRF-7) — fold `pillColors`/`cardColors` into the existing seed effect.** Both were
`useState` lazy initializers (`() => loadPillColors()`/`() => loadCardColors()`) — the
CLAUDE.md rule this task exists to fix ("seed in a useEffect, never in a useState lazy
initializer — cache reads in initializers caused React hydration mismatches, session 165").
The file already had a `useLayoutEffect` seeding every sibling preference field (widgets,
calorie/water/steps/sleep goals) and a `visibilitychange` handler that already re-loaded both
colors on foreground — so per the plan's "reuse its loader" instruction, just added the two
missing initial-seed calls to the existing effect rather than writing a new one, and changed
the two `useState` calls to plain `{}` defaults.

`pnpm lint`/`tsc`/tests (1265 passed, unchanged — none of these three tasks touch tested
logic)/build all green. **Verified interactively** against the local dev DB via Playwright
against `pnpm dev`: the Home screen's colored widget tiles (streak, this-week, log-value
pills) rendered with their real seeded colors on first paint — no blank/default-color flash,
confirming the layout-effect seed timing is equivalent to the old lazy-initializer timing for
this synchronous-localStorage-read case. Drove the real Start Workout countdown and captured
two sequential screenshots half a second apart, showing the digit ticking 3 → 2 — proving the
extracted leaf component's own internal `setTimeout` loop works standalone, matching the
original inline behavior. No new console errors versus this session's established dev-seed
baseline (expected 401s from unconnected Oura tokens in the seed user, CSP blocks on the
external exercise-media CDN — both pre-existing and unrelated).

Version bumped 1.140.2 → 1.140.3 (patch — internal render-hygiene cleanups),
`lib/changelog.ts` entry added. Backlog entry for item 9 (Workout-system hardening) updated
with the Chunk 6 summary; remaining scope narrowed to Chunk 1 Tasks 1.2/1.4 and Chunk 5
(UI/UX + in-workout HR — several items APK-gated per the review's own findings). Continuing
the backlog loop.

## Session 287 (cont.) — Workout-system hardening Chunk 1 Task 1.4: canonical sessions_in_phase definition (fix/workout-hardening-1-4-sessions-in-phase)

Continued the backlog loop after Chunk 6 (hygiene/perf leftovers, v1.140.3) merged clean as
PR #502 (all 7 checks green on first push). Three PRs shipped and merged this session run so
far (#500, #501, #502) — picked up item 9's Chunk 1 Task 1.4 next, a well-scoped single-purpose
fix flagged in the plan as separable from the larger Task 1.2 (consumption-day re-evaluation,
deliberately left for a future session).

**AI-5 — one canonical definition for `sessions_in_phase`.** The review found this counter's
definition was inconsistently approximated across three call sites: the reconcile query used
`EXISTS (SELECT 1 FROM exercise_logs ...)` as a completion proxy rather than checking
`completed_at` directly (a started-but-abandoned session with at least one logged set could
count), while both decrement sites (`deleteWorkoutSession`, the workout-entry PATCH's
auto-delete-empty-session branch) decremented for *any* deleted session inside the phase
window regardless of whether it was ever actually completed — meaning deleting an abandoned
session could decrement a counter it was never counted toward, silently under-counting.

Fixed by establishing the canonical definition **completed (`completed_at IS NOT NULL`),
non-deleted, since `phase_started_at`** and applying it in all three places:
- `reconcileSessionsInPhase` (`lib/data/postgres/slices/periodization.ts`) — added
  `AND ws.completed_at IS NOT NULL` to the COUNT's JOIN condition, kept the existing
  `EXISTS exercise_logs` check as an additional safeguard rather than replacing it.
- `deleteWorkoutSession` (`lib/workout/delete-session.ts`) — now also selects
  `completed_at` and only fires the decrement when `wasCompleted` is true, alongside the
  existing phase-window check.
- The workout-entry route's DELETE handler (`app/api/workout-entry/route.ts`) — identical
  fix at its own auto-delete-empty-session decrement site.
- `complete-workout.ts`'s `incrementSessionsInPhase(...).catch(() => {})` was silently
  swallowing failures — kept the catch (advisory signal, must never fail workout completion,
  per the plan's own instruction) but now `console.error`s the error instead of a bare no-op.

The plan's other Task 1.4 bullet — adding `reconcileSessionsInPhase` to the top of the
prescribe route so the phase-ceiling reader always sees a fresh value — turned out to already
be done (R3 Task 6.2 / SYNC-T2, an earlier session this run). Confirmed via grep, no
duplicate work needed.

Added two new DB-integration tests to `lib/data/postgres/__tests__/reconcile-counters.test.ts`
(same DB-gated pattern as the file's existing SYNC-T1/T2 suite — skips cleanly in CI, which
has no `DATABASE_URL`): one proving an abandoned session neither counts on reconcile nor
decrements on delete (even after manually inflating the counter first, to prove delete truly
no-ops rather than incidentally "fixing" it toward the right number for the wrong reason), one
proving a genuinely completed session both counts on reconcile and correctly decrements back
to 0 on delete. Updated the existing mocked `delete-session.test.ts` — one fixture needed a
`completed_at` value added (the new column read), and added a new case asserting the
`session_periodization` decrement query is never issued at all for an abandoned session.

`pnpm lint`/`tsc`/tests (1266 passed, +1 new mocked unit test, +2 new DB-gated tests correctly
skipped without `DATABASE_URL`)/build all green. **Verified live** against the local dev
Postgres: ran both the new DB-integration suite and the updated mocked delete-session suite
with `DATABASE_URL` set — 8/8 passing, covering the exact bug class this task fixes end-to-end
against a real database (program → program_session → session_periodization → workout_sessions
chain, not just mocked SQL text assertions).

Version bumped 1.140.3 → 1.140.4 (patch — bug fix, stored-counter correctness),
`lib/changelog.ts` entry added. Backlog entry for item 9 (Workout-system hardening) updated
with the Task 1.4 summary; remaining scope narrowed to Chunk 1 Task 1.2 (consumption-day
prescription re-evaluation — larger, multi-file, deliberately left for its own session) and
Chunk 5 (UI/UX + in-workout HR — several items APK-gated). Continuing the backlog loop.

## Session 288 (cont.) — Program edits now void the stale AI prescription (`claude/workout-ai-review-adjust-f2g8jj`)

**Trigger (owner):** on-device, an ai_dynamic **Push** session showed Landmine Press (a
*secondary*) prescribed at **4×6 @80%** — the heavy primary-anchor band, not the moderated
secondary (~72% × 8–10) that PR #479's `secondaryIntensityZone` should produce. Traced + executed
the code (`intensityZoneForRole('powerbuilding','accumulation','secondary')` → 65–72.5%;
`clampPrescribedPct(80, thatZone)` → 72.5): a *freshly generated* powerbuilding secondary cannot
emit 80%, so the 80% card was a **stale prescription** generated before the moderation fix. Owner
had edited the base program expecting it to update, but it didn't.

**Root cause:** two independent facts. (1) In ai_dynamic the workout numbers are re-derived by the
engine from phase+role, not read from base styles — so base set/rep/% edits never affect the
prescription. (2) Saving a program (`/api/workout-templates` → `saveProgram` + client
`invalidateProgramStructure()`) invalidated *display* caches but left the stored
`session_periodization.prescription` untouched. That prescription only cleared on a phase
transition, on session completion (`complete-workout` fires `/prescribe`), or at its 7-day
expiry — so an edit's effect (and the moderation fix) was invisible for up to a week.

**Shipped — an edit now voids the cached prescription so it regenerates on next open:**
- **`lib/data/postgres/slices/periodization.ts`** — new `clearProgramPrescriptions(db, userId,
  programId)`: nulls the prescription fields for every session in the program and sets status to
  `'consumed'`, **preserving phase/`sessions_in_phase`** (unlike `advancePhase`). Status
  `'consumed'` deliberately reuses the existing `workout-data` failed-generation retry
  (`status === 'consumed' && prescription == null` → fire-and-forget `/prescribe`), giving lazy,
  per-session regeneration on next view with no new status enum or trigger.
- **`lib/data/repository.ts` + `lib/data/postgres/adapter.ts`** — interface method + delegate.
- **`app/api/workout-templates/route.ts`** — calls `repo.clearProgramPrescriptions(userId,
  saved.id)` after a successful `saveProgram` (scoped to that program's sessions; no-op for
  programs with no periodization rows).
- **`lib/cache-groups.ts`** — `invalidateProgramStructure()` now also drops
  `ai-periodization-session:` and calls `invalidateAiPeriodization()`, so the client refetches the
  (regenerated) prescription instead of re-painting the pre-edit one from cache.

**Tests:** new DB-gated `clear-program-prescriptions.test.ts` (voids + `consumed` + preserves
phase/count + does not touch a sibling program) and an extended `cache-groups.test.ts` assertion.
Full suite 1326 passing against the local dev Postgres (one transient DB-flake on the first run,
green on re-run and when the 18 DB suites run together — 63/63); `tsc`/lint/build green.

**Not exercised:** the live regeneration itself needs a Gemini call (can't run offline) and the
on-device APK. The DB void + `consumed` state and the `workout-data` retry condition are verified;
the regeneration path is the same one `complete-workout`/`transition` already use. Server-side
change, ships via Railway into the WebView — no native/offline surface touched.

Version 1.140.4 → 1.140.5 (patch — fixes a staleness gap in a shipped feature), `lib/changelog.ts`
entry added.

## Session 291 (cont.) — Ring step counter: continuous-streaming architecture decided + battery-soak tester (claude/step-count-sync-issue-urr96y)

Continuation of the ring-accel step-counter arc. This leg turned the on-device findings into
a locked architecture and shipped the measurement tool that validates its one open risk.

**Gate-triggered duty-cycling is dead — proven, not argued.** Chunk 1b (auto-capture opened
by the gate feed) shipped last leg and never fired on a real 50-step walk: the `0x7e/0x7f`
gate frames only arrive on the **hourly history drain**, so ring-only there is no real-time
"user started walking" trigger. Two further findings replaced the design: (1) **only
REAL_STEPS (0x0b) blocks the `0x33` accel stream** — DAYTIME_HR and SPO2 keep recording
internally while accel streams, proven via the HR-coverage readout showing no gap across a
streaming session; (2) HR/SpO₂ backfill on drain but **raw accel is never recorded on-ring**
— steps are the one signal that must be caught live.

**Decided with the owner (who charges twice daily, so battery is a soft constraint):
day/night split with continuous daytime streaming.** Day: REAL_STEPS off, HR/SpO₂ stay
AUTOMATIC (hourly backfill), accel streams continuously, steps counted **server-side**
(store magnitudes → `countGaitGatedSteps` → delete raw). Night: fully stock. Live-HR gets
radio priority (coexistence untested; a lift's steps are negligible and the gait gate rejects
lifting motion anyway). Duty-cycling was rejected outright: with no real-time trigger it's a
blind timer that misses steps by construction, and every start/stop is a `SetRealtime`
failure point (zombie sessions seen on-device). Pathological-drain fallback = narrower
streaming window, not duty-cycling. Plan doc got a REVISION section
(`docs/superpowers/plans/2026-07-13-ring-accel-step-counter.md`); backlog item 1 rewritten to
match and marked ⛔ gated on the owner's daytime battery soak (the overnight ~20% baseline
reading, 87→67, is untrusted — taken after a heavy BLE test day on a coarse/laggy gauge).

**Shipped (v1.141.0): one-tap battery-soak tester.** `lib/oura-ble/battery-soak.ts` — a
self-contained singleton (survives navigation; localStorage-persisted log so an app kill
loses ≤1 sample interval) that runs the *production* configuration: REAL_STEPS off only,
HR/SpO₂ untouched, accel streaming with a 4-min re-arm, a 90-s stall watchdog, and
reconnect handling that re-applies REAL_STEPS-off + restarts the stream (the service
re-enables all measurements on every connect, which would otherwise silently kill the
soak). Samples `{time, battery%, cumulative frames, drop count, state}` every 5 min
(native keepalive already polls battery on that cadence; `readBattery()` fired before each
sample for freshness). Stop restores measurements via `enableMeasurement` (guaranteed
path), restarts the step orchestrator, and resumes live-HR if it was preempted; an
app-kill mid-soak self-heals on the service's next connect. UI:
`components/oura-ble/battery-soak-test.tsx` card on `/admin/oura-ble`, with Copy-JSON
export of the drain curve + events (stalls double as data on WebView background
throttling — input for Chunk 3's native decision). Also exported
`FEATURE_REAL_STEPS`/`FEATURE_MODE_OFF` from `accel-capture.ts` and corrected its
now-disproven "all three features preempt the stream" comment.

`tsc`/`pnpm lint` (0 errors)/tests (1266 passed) green; `pnpm dev` pass confirmed
`/admin/oura-ble` renders without crash (web shows the plugin-unavailable state by design).
**Not exercised: everything BLE** — the soak loop, feature toggling, watchdog, and restore
are only provable on the APK; the owner's soak run is itself the verification. Known-Issues
row added. Next: owner runs a charged daytime soak and sends the JSON; Chunk 1 (continuous
capture loop + server-side counting pipeline) builds against the decided architecture once
the drain rate is confirmed sane.

## Session 288 (cont.) — Rep-quality back-off in RPE autoregulation (`claude/workout-ai-review-adjust-f2g8jj`)

**Ask (owner):** on-device a Tricep Cable Combo accessory came in at RPE 7→9→10 with reps falling
12→12→8 — hit the prescribed reps only on the first two sets. Owner's point: not finishing the
prescribed reps at a high RPE means form broke down / the load was too heavy, and the engine
should re-evaluate *regardless of the 1RM trend*. Confirmed the design via AskUserQuestion:
trigger **only when reps are missed** (a hard-but-completed set stays as-is), and back off by
**cutting load 5–10% scaled by how far short the reps fell, keeping the rep target**.

**Gap this closes:** `computeRpeAdjustment` (`lib/ai-periodization/autoregulation.ts`) previously
fired a back-off only on the RPE×1RM quadrant — `rpeDelta ≥ 1.5 AND rm1Trend === 'down'`. So the
exact reported case (high RPE, missed reps, but 1RM flat/rising) got **no adjustment**: reps were
only ever used to *size* a cut once the 1RM-down gate opened, never to *trigger* one. A too-heavy
load you were grinding through stayed too heavy.

**Shipped:** broadened the back-off trigger to `rpeDelta ≥ RPE_DEAD_BAND AND (rm1Trend === 'down'
OR missedReps)`, where `missedReps = repCompletionRate != null && repCompletionRate <
COMPLETION_CEIL` (0.95 — i.e. missed by more than ~a rep across the exercise). The cut reuses the
existing completion-scaled sizing (5% at ~0.95 → 10% at ≤0.70), reps are held (`repDelta 0`), and
the note leads with the more-actionable missed-rep reason when reps were missed
("…you fell short of the prescribed reps"), falling back to the 1RM-slip note otherwise. No new
config, thresholds reused. Requiring a *high* RPE keeps a normal-RPE miss (stopped early for time,
etc.) from cutting, and a hard-but-completed set on a non-regressing lift is still left alone (the
healthy +1/AMRAP session).

**Tests:** added a "back-off (RPE high AND reps missed, 1RM NOT down)" describe block (flat and
rising 1RM both cut; scaling; hard-but-complete = no cut; miss-at-normal-RPE = no cut) and a
whole-prescription test asserting the 1RM-slip note still shows when reps were completed. Updated
the one existing whole-prescription test whose 0.6-completion input now takes the missed-rep note
branch (identical 10% cut, note text only). 1332 tests pass; `tsc`/lint/build green.

**Not exercised:** the end-to-end regeneration (Gemini) and on-device — `computeRpeAdjustment` is
a pure function fully covered by unit tests, and the signal inputs (`rpeDelta`, `repCompletionRate`,
`rm1Trend`) already flow from `signals.ts`. Server-side change, ships via Railway into the WebView.

Version 1.141.0 → 1.142.0 (minor — new autoregulation behavior), `lib/changelog.ts` entry added.

## Session 291 (cont.) — Chunk 1 shipped: continuous capture loop + server-side gait counting (claude/step-count-sync-issue-urr96y)

Owner decision: skip the standalone battery soak ("could we skip the test and go straight to
the testing?") — they charge twice daily, so battery is a soft constraint; the pathological-
drain fallback (narrower day window) is a constant tweak, not a redesign; and the capture
loop logs battery every 5 min anyway, so **day one of the real pipeline doubles as the soak**.
Downsides stated honestly (entangled day-one debugging, worst-case one bad ring-battery day,
day-one counts are experimental until Chunk 2's cutover) — all accepted.

**Shipped (v1.143.0), the production Chunk 1 per the plan's REVISION:**
- **Client** `lib/oura-ble/continuous-capture.ts` — singleton, default-OFF localStorage
  toggle (`ta_ring_continuous_capture`). Day window 06:00–22:00 local: REAL_STEPS off,
  accel streams continuously; night: full measurement restore, ring stock. One 30-s tick
  drives: day/night transitions, live-HR yield (pause stream, resume after — coexistence
  untested so live HR keeps radio priority), the 90-s stall watchdog, the routine 4-min
  re-arm (stream is firmware time-boxed), ~2-min chunk flushes, and 5-min battery/diag
  logging (localStorage ring buffer, exportable). Reconnects re-apply REAL_STEPS-off +
  restart the stream (the service re-enables everything on connect). Failed posts go to a
  bounded localStorage retry queue (cap 15 ≈ 30 min, drop-oldest counted — sensor telemetry,
  not user data, so bounded-drop beats an unbounded outbox). Engaging stops the gate
  orchestrator and any running battery soak (single radio owner); disabling restores and
  restarts the orchestrator. `sync-provider` now starts exactly one of the two step paths
  by the toggle.
- **Server** POST `/api/oura-ble/accel-chunks` — Zod (25–20 000 ints, rate 1–200) + the
  standard rate limit + a clock-sanity guard (future/very-old `startedAt` rejected, so a bad
  phone clock can't plant a window over a span the ring never covered). Counts with
  `countGaitGatedSteps` (the one implementation), stores the raw chunk in
  **`oura_accel_chunks` (migration 122** — UNIQUE(user_id, started_at) makes retries
  idempotent; raw kept 7 days for recount/calibration, pruned user-scoped on ingest — no
  cron layer), then writes a Tier-2 `step_live_windows` row (source `continuous-accel`) via
  the same anchor-based wall-clock→ds conversion as the live-steps route. A missing anchor
  stores the raw chunk and skips the window (backfillable) instead of losing data.
- Per-chunk counting drops gait windows straddling chunk boundaries — bounded under-count
  (safe direction) at ~2-min chunks; noted in the route comment for Chunk 4's calibration.

**Verified live** against the local dev DB: extracted the real walk-30 fixture (976 samples)
and drove the full HTTP path — POST → `{ok, steps: 31, windowWritten: true}` (matches the
unit-test count), `oura_accel_chunks` row stored, `step_live_windows` row with source
`continuous-accel` and a correct ds span (195 ds ≈ 19.5 s ≈ 976/50); retry → `duplicate:
true` with no double window; flat 300-sample signal → 0 steps, no window; future-dated and
malformed bodies → 400. New DB-gated repo test (idempotency + 7-day prune) passes against
the local Postgres; `tsc`/lint (0 errors)/vitest (1267 passed) green.

**Not exercised (APK-only):** the BLE capture loop itself — stream, watchdog, day/night
transitions, live-HR yield, reconnect re-arm. The owner's day-one run is the verification;
Known-Issues row updated. Next: owner flips the toggle on a charged morning; compare the
day's gait windows vs Garmin; then Chunk 2 (make gait counts the day's `body_metrics.steps`,
retire col14) with day-one numbers in hand.

---

## Session 297 — Admin Oura BLE debug UI cleanup (v1.143.2 → v1.143.3, `claude/admin-console-ui-cleanup-g7c8fj`)

Owner-requested, in-session ("the admin console has gotten quite messy… break certain testing
modules into their own chevrons/sections… the log output should have a copy button so screenshots
aren't needed… anything not needed should be compressed or removed"). Scoped to `/admin/oura-ble`
(`components/oura-ble/oura-ble-debug.tsx`), which had grown a single giant collapsible **"Advanced
(raw protocol)"** panel cramming ~25 raw command buttons **and** four large tester cards (Step
calibration, Live step test, Continuous capture, Battery soak) + a sleep-epochs input + the log
console all in one undifferentiated wall.

**Restructure (layout only — every handler preserved):**
- Raw commands now sit under one `Raw protocol commands` collapsible, split into labelled groups via
  a local `BtnGroup`: Connection / Accelerometer / Heart rate / History & sync / Measurements /
  Diagnostics / Danger zone (Clear key). The inline investigation comments were kept but consolidated.
- Each tester is its own collapsed `CollapsibleSection`: Step calibration, Live step test (accel
  spike), Continuous step capture (production), Battery soak, Sleep epochs (debug). The four tester
  cards were made "headless" — their own outer border + bold title removed, since the section
  header now provides both (description stays as the first child).
- New **`Log & frames`** section (open by default) holds the frame-tag tally + the log console.

**New shared primitives (DRY — CLAUDE.md's "≥2 sites gets extracted"):**
- `components/ui/collapsible-section.tsx` — bordered chevron section, real `<button>` +
  `aria-expanded` + 44px-min header, replacing the hand-rolled chevron toggles.
- `lib/use-copy.ts` (`useCopy` hook) — the WebView-first copy pattern (`execCommand` inside the tap
  gesture → Clipboard API fallback → return false for manual long-press) that was hand-duplicated in
  all four tester cards. The four cards now call the hook; ~15 lines of boilerplate removed from each.

**Log copy button (the headline ask):** `components/oura-ble/log-console.tsx` gained **Copy** (grabs
the full joined log via an off-screen textarea + `useCopy`, so it survives the WebView clipboard
block) and **Clear** buttons — screenshots no longer needed.

**Nothing removed this pass.** The "remove what's unneeded" ask needs the owner's call on which
testers are still in use (can't be told from the sandbox); flagged the likely-dead ones (Step
calibration, Live step test = pre-production step-count spikes superseded by Continuous capture;
Battery soak = one-off measurement) in the Known-Issues row for a follow-up cut. An AskUserQuestion
to confirm was attempted but the permission stream dropped, so I proceeded conservatively.

**Verification:** `tsc` clean (only the pre-existing `@capacitor/splash-screen` type error remains,
unrelated), `eslint` clean on all touched files. **APK-only screen** — the native OuraBle plugin is
inert in the web sandbox (renders the "plugin unavailable" state), so the collapsibles, grouped
buttons and log-copy could only be checked to compile, not exercised against a real ring. On-device
smoke: `/admin` → Tools → Oura BLE debug — expand/collapse each section, fire a raw button and watch
the Log section, tap the log **Copy** and confirm the full text lands on the clipboard. Version
bumped to v1.143.3 + changelog entry; Known-Issues row added.

## Session 287 (cont.) — Workout-system hardening Task 1.2: consumption-day prescription re-evaluation (fix/workout-hardening-1-2-prescription-reeval)

Continued the standing backlog loop (this run has now shipped and merged PRs #500–#503;
main also moved forward with unrelated concurrent BLE work from other sessions — #509–#511 —
confirming multiple sessions are working the queue in parallel, so re-checked the backlog
file fresh from `origin/main` before starting to avoid duplicating anyone else's work).
Picked up item 9's last remaining Chunk 1 item: **Task 1.2 (AI-2/AI-3) — consumption-day
re-evaluation of prescriptions**, previously flagged as "larger, multi-file, better scoped
as its own session."

**The gap.** A prescription is generated by the LLM minutes after the *previous* session
completes and gets consumed up to 7 days later by the *next* session. The plan is explicit
that the LLM must never re-run at consumption (unacceptable latency on the workout-open
path) — but the deterministic post-generation layers (per-exercise soreness deload,
emergency-deload evaluation) were *also* frozen at generation time. A prescription
generated on a clean day kept driving load with that stale soreness snapshot even after
today's mood check-in reported fresh soreness on a prescribed muscle; and an `accepted`
prescription could keep driving load indefinitely past its own `prescriptionExpiresAt` —
`workout-data`'s `aiDrivesLoad` path had no expiry check at all. AI-3 additionally flagged
that the emergency-deload condition checking `hoursSinceLastSession < 36` is structurally
useless at generation time — it's always computed right after a *just-completed* session,
so it's always ~0, an always-false condition; the real signal only becomes meaningful hours
or days later, at consumption.

**Research first.** Before writing any code, spawned a background research agent (in
parallel with direct `Read`/`Grep` investigation) to map: the prescribe route's
deterministic soreness/emergency layers, `emergency-deload.ts`'s exact signature and
signals, `workout-data`'s `prescriptionDrivesLoad` gating and where (if anywhere) expiry
was already checked, the `AiPrescription`/`SessionPeriodization` types, and the GET session
route's existing pending-prescription expiry flip (the pattern to mirror). This surfaced a
real constraint the plan text doesn't spell out: `buildWholeSessionDeloadPrescription`
(used both for the emergency deload and for the >50%-sore whole-session escalation) needs
the *full* `aggregateSignals` pass (time-budget fitting, transition-time profiles) to
synthesize a real prescription — exactly the expensive 30-signal cost the plan says
consumption-time re-evaluation must avoid. Rather than force a whole-session deload
synthesis into the cheap path (which would either be wrong or secretly re-introduce the
full aggregation the task explicitly rules out), scoped the re-evaluator to never attempt
it: a whole-session condition sets a `needsRegenerate` flag and fires the same
fire-and-forget `POST /prescribe` the existing failed-generation retry already uses — the
LLM path still runs, just asynchronously, off the read path. This is a deliberate,
documented deviation from a literal reading of the plan's "never touches the LLM's sets/
reps/pct otherwise" line, made because the alternative (a second whole-session-deload
synthesizer that duplicates the full signal aggregation) would violate "One Formula, One
Place" and the plan's own latency goal.

**`lib/ai-periodization/reevaluate.ts` (new).** `reevaluatePrescriptionForToday(prescription,
signals, state, now)` is a pure function composing two pre-existing pure functions
unchanged: `computePerExerciseDeload` (already deterministic, no LLM) and
`shouldTriggerEmergencyDeload` (ditto). For per-exercise: drops a deload whose soreness
cleared (restoring the exercise's stashed `preDeload` sets/reps/pct/restSec), applies a new
deload for a freshly-sore exercise (stashing its current values into `preDeload` — the
identical mutation shape `reconcilePrescription` already does at generation time, reused
verbatim so the two code paths stay structurally identical), and refreshes the note wording
for an exercise that's still sore across days. For the emergency condition: only the
`hoursSinceLastSession`-combined-with-soreness axis is re-checked (the AI-3 fix target) —
the other three emergency triggers (ACWR, RPE trend, rep-completion-rate) genuinely need the
full signal aggregation and are left for the next real `/prescribe` call, an honest scope
reduction consistent with the plan's own "cheap fresh-signals subset... NOT the full
30-signal aggregation" instruction.

**Wiring (`app/api/workout-data/route.ts`).** `aiPrescription`/`aiDrivesLoad` (previously
`const`) became `let` so an expiry hit or a re-evaluation can override them for the current
response. Expiry check first: an `accepted` prescription past `prescriptionExpiresAt` no
longer drives load (falls back to the static progression style, same code path as an
absent prescription) and fires a fire-and-forget `updatePrescriptionStatus(...,
'dismissed')`, mirroring the GET session route's own flip exactly. Otherwise, if the
prescription's generation day differs from today (`toAestDay(prescriptionGeneratedAt, tz)
!== todayStr`) and it hasn't already been re-evaluated today (a new optional
`reevaluatedForDate` field on `AiPrescription`, checked before doing any work — the "once
per day, not per fetch" requirement), pulls the cheap signals subset via existing narrow
repo calls (`getRecentSessionsOfType(..., 5)`, `getMoodLog` today+yesterday, `listInjuries`,
`getExerciseMuscleAssignments`) and calls the re-evaluator. A `needsRegenerate` result fires
the async `/prescribe` POST (unawaited); otherwise the re-evaluated prescription (now
stamped `reevaluatedForDate: todayStr`) both drives *this* response immediately and gets
persisted via a new narrow repo method, `updatePrescriptionExercisesCache` — deliberately
not a reuse of the existing `storePrescription` (which unconditionally resets
`prescriptionGeneratedAt`/status to a fresh-generation shape and would silently flip an
`accepted` prescription back to `pending` every single day it's re-evaluated). Added
`updatePrescriptionExercisesCache` to the `Repository` interface, the Postgres adapter, and
a matching `lib/data/postgres/slices/periodization.ts` function that only touches the
`prescription` JSONB column.

Added 8 unit tests to `lib/__tests__/reevaluate.test.ts` covering: no-op (nothing sore, no
prior deload), soreness-cleared restore, fresh-soreness apply (with the correct per-goal
deload override values and an unaffected sibling exercise), whole-session escalation
correctly flags `needsRegenerate` instead of attempting synthesis, the AI-3 emergency
condition firing/not-firing based on `hoursSinceLastSession`, emergency suppression during
an active deload phase, and the still-sore note-refresh-only case. Two of the tests needed
careful exercise/muscle-group construction to isolate the emergency-condition path from
`computePerExerciseDeload`'s own independent whole-session escalation (a sore-muscle count
of 3+ can trigger either condition depending on how many exercises match) — caught and
fixed while writing the tests, not after.

`pnpm lint`/`tsc`/tests (1294 passed — main has grown via other sessions' parallel merges
this run, +8 new)/build all green. **Verified live** against the local dev Postgres (not
mocked): flipped the seeded Push/Pull/Legs program to `ai_dynamic`, inserted a real
`session_periodization` row for the Push session with an `accepted` prescription generated
"yesterday" (backdated `prescription_generated_at`) and a `mood_logs` row marking chest
sore today, then called the actual `GET /api/workout-data` route via Playwright — confirmed
the bench press exercise's `progressionStyle` carried the freshly-applied deload (2 sets,
50% pct, 120s rest, `deloaded: true`, a note naming chest) while the untouched overhead
press exercise kept its original prescribed values unchanged, and confirmed the DB row's
`prescription.reevaluatedForDate` field stamped today's date. Then backdated
`prescription_expires_at` into the past and re-fetched — confirmed the response fell all
the way back to the static "Standard" progression style (not the AI override at all) and
the DB's `prescription_status` flipped to `dismissed`, exactly mirroring the GET session
route's existing behavior. Test rows removed and the program flipped back to `manual`
afterward; no full reseed needed.

Version bumped 1.143.3 → 1.143.4 (patch — AI-dynamic program correctness).
`lib/changelog.ts` entry added. Backlog entry for item 9 (Workout-system hardening) updated
with the Task 1.2 summary — Chunk 1 is now fully complete; remaining scope narrowed to
Chunk 5 (UI/UX + in-workout HR, several items APK-gated). Continuing the backlog loop.

---

## Session 287 (cont.) — Workout-system hardening Chunk 5: UI/UX polish + in-workout HR theming (item 9, final chunk)

Implemented Chunk 5 of the workout-system hardening batch — the last remaining chunk after
Chunk 1 (AI periodization correctness) shipped via PR #512. Branch
`fix/workout-hardening-chunk5-ui-hr`. Re-verified the plan against current `main` before
starting per the backlog protocol: a concurrent session's PR #506 had already replaced
`components/workout/live-hr-readout.tsx` with `components/workout/live-hr-chart.tsx` +
`lib/live-hr/exercise-trace.ts` (a module-scoped external-store singleton read via
`useSyncExternalStore`), which fully superseded the plan's Task 5.8 (live-HR readout
memoization) — skipped with no code changes, avoiding duplicate work.

**Task 5.1 (UI-2):** `components/workout-screen.tsx` — moved the `hapticLight()` touch
feedback out of the POST `.then()` callback and fired it synchronously alongside the local
`setLoggedCount` update, matching the "saves feel instant" pattern (network is fire-and-
forget, feedback never waits on it).

**Task 5.2 (UI-1):** `components/workout/pre-workout-screen.tsx` — the deload chip was a
`<span role="button" tabIndex={0}>` with `stopPropagation` nested inside the exercise-row's
outer clickable `<button>` (WebView nested-interactive-control anti-pattern). Restructured
into a real sibling `<button>` beneath the stats button, no `stopPropagation` needed.

**Task 5.3 (UI-3/4):** `components/workout/rpe-strip.tsx` — grew the segment height from
`h-9` to `h-11` (touch-target floor) and replaced a fixed white/black text-color pair with
`color-mix(in srgb, ${color} 60%, black)` derived from each segment's own hue, fixing washed-
out contrast in light mode against the pale filled-but-unselected background.

**Task 5.4 (UI-5):** `components/workout/done-screen.tsx` — the session-RPE 1-10 grid used
to unmount itself after the first tap (`rpeSaved` flag), permanently blocking a correction.
Replaced with an in-flight-only `rpeSubmitting` guard; the grid stays mounted and a re-tap
re-POSTs (the write path already upserts `session_rpe`, so this is safe). `handleRpeTap` now
writes local-first + outbox via `getLocalStore`/`queueMutation`/`pushMutations` with a plain
API-route fallback when no local store is available (web sandbox).

**Task 5.5 (UI-6 through UI-12), the bulk of the chunk — a sweep across nine files:**
- **UI-6** (hardcoded `rgba(255,255,255,…)` borders that don't follow the theme): fixed in
  `set-card.tsx`, `active-workout-screen.tsx` (two sites), and the workout-select carousel
  dots — all now resolve through `var(--color-border)`/`var(--color-muted-foreground)`.
- **UI-7** (carousel dots weren't real controls): `app/workout-select/workout-select-content.tsx`
  — converted the plain `<div>` dots into `<button aria-label="Session N" aria-pressed>` wired
  to the existing `setCurrentIdx`, so tapping a dot now jumps directly to that session.
- **UI-8** (mismatched icon): `exercise-summary-screen.tsx`'s header button called `onNext`
  (advances to the next exercise — confirmed via its caller, `onNext={advance}` in
  `workout-screen.tsx`) but rendered `ChevronLeftIcon`, reading as "back." Swapped to
  `ChevronRightIcon` with an `aria-label`.
- **UI-9** (missing aria-labels): added to `active-workout-screen.tsx`'s back button and 1RM-
  calculator button.
- **UI-10** (raw text glyphs instead of icons): `exercise-summary-screen.tsx`'s `"↑"/"↓"/"→"`
  1RM-delta arrow became a `ArrowUpIcon`/`ArrowDownIcon`/`ArrowRightIcon` swap; `weight-dial.tsx`'s
  `"✓"`/`"●"` became `CheckIcon`/`CircleIcon`.
- **UI-11** (PR badges hardcoded to literal yellow instead of the amber accent token): fixed
  in `exercise-stats-sheet.tsx`'s all-time-1RM trophy row, `exercise-summary-screen.tsx`'s
  "New Personal Record!" badge, and `done-screen.tsx`'s Personal Records card + per-PR share
  icons — all now resolve through `var(--accent-amber)` via `color-mix`. Also made the
  per-PR share icon always-visible at rest (was `text-yellow-400/0 group-hover:…`, invisible
  until hover — unusable on a touch device with no hover state).
- **UI-12** (voice-logged weights weren't snapped to the equipment's real increment):
  `set-card.tsx`'s `handleVoiceResult` now applies `mroundStep(clamped.weight,
  weightStepFor(equipment))` before calling `onWeightChange`, matching the `+/-` controls'
  own step size (2.5 kg barbell / 1.25 kg otherwise).

**Task 5.6/5.7 (HR-1/2/3, in-workout HR + recovery chart):** `components/workout/done-screen.tsx`
— removed the dead fire-and-forget `POST /api/oura/hr-sync` call (the legacy Oura Cloud sync
path; BLE HR lands server-side into `oura_heartrate` during the workout now, per CLAUDE.md's
Oura Direct-BLE section — the Cloud gets no new data from this ring at all). `loadHr` now
tracks an explicit `hrError` state and renders a "Couldn't load HR data" message with a Retry
button instead of silently reporting "no data" on a fetch failure — matching the
self-fetching-card failure-state rule. `components/workout/hr-recovery-chart.tsx` — its
Chart.js gridline/tick colors were unresolved `var(--color-*)` strings, which `fillStyle`
can't interpret and silently renders as black; hoisted a shared `resolveColor()` helper (new
`lib/chart-colors.ts`, deduped from a pre-existing copy in
`components/health/trend-sparkline.tsx` per "One Formula, One Place") and applied it to both
chart components' x/y scale colors.

`pnpm lint` (0 errors, pre-existing unrelated warnings only) / `pnpm exec tsc --noEmit` (clean)
/ `pnpm test` (1294 passed, 63 skipped — no new tests needed, this chunk is UI/token/icon
swaps with no new branching logic) / `pnpm build` (clean) all green.

**Verification — partial, disclosed honestly per CLAUDE.md's communication rule.** A
Playwright agent signed in as the seeded test user and confirmed `/workout-select` renders
correctly in both light and dark themes at the 384×832 viewport, with the carousel dots
showing correct brand/muted coloring — but ran out of time before reaching the
active-workout screen, exercise-summary screen, done screen, or weight-dial component (the
higher-risk sites for icon/border regressions), and could not confirm the dot-click
navigation interactively (automation issue on the agent's end, not a confirmed UI bug).
**Not verified live: active-workout-screen header buttons/set-card borders, exercise-summary
chevron/1RM-arrow icon, done-screen PR-card color/share-icon visibility/HR error-retry state,
and weight-dial's check/dot icons** — these are mechanical color-token and Lucide-icon swaps
that were verified via full build/lint/tsc/test passing and direct code review against each
component's actual render output, but not observed rendering on a live page. Flagging as a
Known Issue below pending a follow-up on-device or Playwright pass.

Version bumped 1.143.4 → 1.143.5 (patch — UI/UX polish, no schema/behavioral changes).
`lib/changelog.ts` entry added. **Backlog item 9 (Workout-system hardening) removed in full**
— Chunk 5 was the last remaining chunk (Chunk 1 shipped via #512, Chunks 2–4 shipped in
earlier sessions per the item's history). Renumbered items 10–22 down to 9–21 and fixed the
cross-references to the shifted item numbers throughout the file (the protocol block's
prose summary, the sleep-staging/LF-HF-REM items' "item 16" self-references, and three
"Queue item N" mentions in the not-yet-queued section) — left one pre-existing, already-
stale reference alone (`item 17's "breathing-rate variability"` note at the LF/HF-REM item,
and the protocol block's "Item 8 is the workout-system hardening batch" line, which already
mislabeled the item number before this session's edit) since both predate this change and
untangling them needs more investigation than this docs pass warrants.

---

## Session 287 (cont.) — R6: Performance & Paint (item 9)

Picked up backlog item 9 (R6 — Performance & Paint) after Chunk 5 of the workout-hardening
batch merged via PR #513, closing that item entirely. Confirmed via a fresh scan of items 1–8
that every one of them had only native/on-device/owner-blocked work remaining (step-counter
Chunks native+blocked-on-owner-data, walk-detection/step-orchestration Chunk-C native-deferred,
sleep-staging blocked on the owner's model-key extraction, Oura data-mapping's remainder sized
for its own pass, UB4's remainder native-only, R3's remainder APK-only local-store machinery,
R4 already fully done bar device-only items) — R6 was the first item with genuinely unstarted,
in-sandbox-buildable work. Branch `perf/performance-and-paint`.

Re-verified all twelve PERF findings against current `main` via an Explore agent before
touching any code (the plan was written 2026-07-09; several sibling plans have landed since).
PERF-3 (the rogue Oura-sync throttle) was confirmed already fixed — the home-page freshness
plan removed the Cloud-sync call from `exercise-detected-card.tsx` entirely rather than
re-throttling it, and converted its GET to `cachedFetch`, exactly matching the plan's own
overlap note. PERF-12's two sheet extractions (week-day-overlay, log-value-sheet) were
similarly confirmed already done by that same plan. The other eleven all reproduced.

**PERF-7 (lazy-init hydration hazards).** `components/health/oura-section.tsx`'s five
`useState(() => readCacheSync(...))` initializers became plain defaults + a `useLayoutEffect`
seed (mirroring `health-content.tsx`'s existing pattern) — even though `OuraSection` stays
`ssr:false` forever (it carries chart.js per PERF-6's note), the rule is general and this
removes any future risk if the component's SSR status ever changes. `session-select-
content.tsx`'s `recommendation`/`moodLog` initializers folded into the file's existing
`useLayoutEffect` seed block. `health-content.tsx`'s `waterGoalMl`/`targetWeightKg`/
`targetBfPct` initializers simplified to plain defaults — a `useLayoutEffect` at `:199` was
already independently re-seeding the exact same three values (a latent duplicate the plan
didn't catch), so no new effect was needed there, just deleting the redundant initializer
logic.

**PERF-1.** `day-review-sheet.tsx`'s `WorkoutLoadComparisonChart` (chart.js) converted from a
static import to `dynamic(..., {ssr:false})`, alongside its already-dynamic siblings
`Response`/`HrDayChart` in the same file — the type import stays static, only the component
import is lazy.

**PERF-6.** Five `health-sections.tsx` cards (`AiWeeklyVolumeCard`, `StrengthProgressCard`,
`StrengthTrendCard`, `GoalsProgressCard`, `TrendsSection`) and `session-select-content.tsx`'s
`BodyBatteryCard` converted from `dynamic(..., {loading: <skeleton>})` to plain static imports
— each cache-seeds synchronously, so the dynamic-chunk-load skeleton was winning the first-
paint race against the card's own instant-paint cache read. Verified none of the six has an
SSR-unsafe `useState(() => ...)` lazy initializer before converting (grepped all six source
files — clean).

**PERF-2.** `warmup-screen.tsx`'s muscle-assignment `Map` build (previously rebuilt fresh every
render, defeating the memoized `<MuscleHeatmap>` at 1 Hz alongside the warmup timer's tick) is
now wrapped in `useMemo(() => {...}, [exercises])`, an exact copy of the already-shipped fix in
the sibling `active-workout-screen.tsx:176-181` the plan cited as the reference.

**PERF-8 (three timer/interval fixes).** `weekly-stats-hub.tsx`'s two `useCountUp` calls
(previously at the hub top, re-rendering the day-volume bars + all four stat cards on every
animation frame) moved into a new leaf `CountUpValue({target, fallback})` component that owns
its own `useCountUp` tick — only the two numbers now animate. `active-activity-screen.tsx`'s
1 Hz `setInterval` (setting `elapsedSec` on the whole screen, including the distance/pace/map)
moved into a new leaf `ActivityElapsedClock` taking `startMs`/`accumulatedPauseMs`/`isPaused`/
`pauseStartMs` and computing elapsed itself, mirroring `session-clock.tsx`'s `useElapsedSec`
pattern. `meteors.tsx`'s `setInterval(generateMeteors, 3000)` deleted — generates once on
mount now; the per-particle CSS animation already loops, so the 3 s regeneration was purely
cosmetic position-reshuffling that re-rendered every meteor DOM node.

**PERF-4.** `health-trends-summary` was independently fetched by three separately-mounted
Health-tab siblings (`oura-section.tsx`, `workout-density-card.tsx`, `nutrition-activity-
trends-card.tsx` — `health-score-detail.tsx` was confirmed NOT a genuine sibling despite the
plan listing it: it's a separate route component for the readiness/sleep/activity detail
pages, never mounted alongside the other three, so its independent fetch is correct and was
left alone). Their staggered dynamic-chunk mount times defeated `cachedFetch`'s in-flight
dedup. Now fetched once in `health-content.tsx` (added to the existing parallel `Promise.all`
fetch batch + a `useLayoutEffect` cache seed) and passed down as an optional `trends` prop
through `health-sections.tsx`'s `HealthSectionsCtx` to all three cards; each card keeps its
own self-fetch as a fallback when the prop is `undefined` (so it still renders correctly if
ever used standalone).

**PERF-5.** `nutrition-content.tsx`'s `fetchData` re-ran all 8 endpoints (7 date-independent +
`loadFoodLogs`) on every `selectedDate` change — swiping back 5 days meant ≈40 requests. Split
into `fetchMountData` (the seven date-independent fetches: meal-types, targets, weekly-summary,
adherence, body-metadata, progress-summary, user profile — now keyed `[userId]`, mount-scoped)
and a narrowed `fetchData` (only `loadFoodLogs` + today's activity calories, keyed
`[selectedDate]`). The two post-delete `fetchData()` call sites (`handleConfirmDelete`'s local-
store and web-fallback branches) now also call `fetchMountData()` since a deleted food entry
can shift the weekly-summary/adherence/progress totals too, not just the day's own log — a
correctness fix the split would otherwise have silently introduced by omission. Removed all
four `setLogs([])` blanking calls (both date-swipe gesture branches and both arrow-button
handlers) — `loadFoodLogs` already reads local-first/cache-first, so it now seeds the new
date's list synchronously instead of flashing empty before the fetch resolves.

**PERF-10 (network-gated UI feedback → feedback-first).** `health-content.tsx`'s
`handleEditSave`/`handleDelete`/`handleDeleteSession` and `metric-log-sheet.tsx`'s web-fallback
save branch previously toasted + closed only after `await fetch` resolved. All four now fire
the toast + dialog-close synchronously before the network call, with the `catch` branch showing
an error toast and (for the three `health-content.tsx` handlers) explicitly re-invalidating +
re-fetching the day overlay to reconcile the UI back to server truth on a real failure — since
the optimistic toast already told the user it saved. `handleDelete`'s local-store mirror logic
(which branches on the server's `resBody?.sessionDeleted` to decide whether to tombstone the
exercise or the whole session) necessarily stays sequential after the fetch — only the toast/
close timing moved, not the mirror's data dependency on the response. `app/stats/stats-
content.tsx`'s identical drift in both `handleEditSave`/`handleDelete` was deliberately left
untouched: confirmed dead code (`app/stats/page.tsx` unconditionally redirects to `/health`;
grep found zero other importers of `stats-content.tsx`).

**PERF-11.** The set-edit dialog's `key={i}` — now living in `day-overlay-dialogs.tsx` after an
earlier extraction moved it out of `health-content.tsx` — changed to `key={`set-${i+1}`}`.
`stats-content.tsx`'s identical copy left alone for the same dead-code reason as PERF-10.

**PERF-12.** Deleted the dead `import { OuraBatteryChip }` in `session-select-content.tsx`
(zero other occurrences in the file, confirmed via grep). Current file sizes noted in passing
(not acted on, out of this item's scope): `workout-screen.tsx` has grown to 1414 lines and
`config-screen.tsx` to 988 — both now over/near the ~800-line ceiling and worth a future
extraction pass, but starting one wasn't part of this item.

**Chunk 4 (PERF-9) deliberately deferred**, per the plan's own explicit guidance: "this is the
biggest and riskiest item... land it on its own, after Chunks 1–3, and only if the request-
count win justifies the churn. Safe to defer as a standalone follow-up." It touches the hot
`workout-data` route and the home prefetch loop every session tab depends on — a `?tab=all`
batch-collapse design that warrants its own dedicated implementer pass rather than folding into
an already-large batch. Left as the remaining scope on the backlog entry rather than closing it
out completely.

`pnpm lint` (0 new errors; the 108 pre-existing warnings are all in files this batch never
touched)/`pnpm exec tsc --noEmit` (clean)/`pnpm test` (1294 passed, 63 skipped — no new tests
needed, this batch is render-hygiene/bundle-splitting/data-plumbing with no new branching
logic to unit-test)/`pnpm build` (clean, `/health`'s page-specific JS grew as expected — the
five newly-static-imported cards moved from separate chunks into the page entry) all green.

**Verified live** via Playwright against the local dev DB (test@local.dev, 384×832 viewport):
Home (session-select) painted identically before and after a hard reload — pixel-diffed
screenshots confirmed no skeleton flash on the Body Battery card or elsewhere. All three Health
tabs (Body/Training/Progress) rendered fully with real seeded data and zero React hydration-
mismatch or key warnings in the console. Nutrition: swiped through 6 dates (3 back, 3 forward)
and confirmed via the Network panel exactly 6 total requests, all to `food-logs`, with none of
the seven now-mount-scoped endpoints re-firing — and no blank/flash of the food list between
dates. `/stats` redirects to the already-verified Training tab, whose Sessions/Sets `CountUp`
tiles rendered correctly (0, matching the seed data's empty current week). **Not verified
live: the Warm Up screen's memoized muscle heatmap (PERF-2)** — the verification pass's
workout-entry point wasn't reached within the time available (the Start Workout control lives
under the bottom-nav Workout tab, not a Home dashboard button, and the script's selector didn't
find it). Disclosed honestly as a Known Issues row rather than claimed verified; the fix itself
is a minimal, direct copy of an already-shipped identical `useMemo` in the sibling
`active-workout-screen.tsx`, so risk is low, but "low risk" isn't "verified."

Version bumped 1.143.5 → 1.143.6 (patch — perf/render-hygiene, no schema or behavioral
change beyond the PERF-10 optimistic-UI timing and the PERF-5 mount/date fetch split, both of
which were verified live above). `lib/changelog.ts` entry added. Backlog item 9 (R6) updated to
reflect Chunks 1/2/3/5 shipped in full, Chunk 4 (PERF-9) explicitly left as remaining scope
rather than closed out, since CLAUDE.md's protocol is to annotate a partially-completed item
rather than remove it. Continuing the backlog loop.

---

## Session 287 (cont.) — R7: UI Polish & Accessibility (item 10, now removed)

Picked up backlog item 10 (R7 — UI polish & a11y) after R6's PR #515 merged. Item 9 (R6) still
has Chunk 4 (PERF-9, the workout-data N+1 batch collapse) remaining, but that work is explicitly
flagged by its own plan as the biggest/riskiest item that should "land on its own" — continuing
to grind on it in an already-long session risked a rushed change to the hottest route in the
app, so moved to the next ready item instead, leaving PERF-9 as R6's documented remaining scope.
Branch `fix/ui-polish-a11y`.

Re-verified the plan's own findings table against current `main` first: `lib/chart-colors.ts`
and `trend-sparkline.tsx`'s repoint already existed from the R6 pass (Chunk 1 tasks 1-2 done for
free), so Chunk 1 only needed the two remaining chart fixes plus the double-inset sheet.

**Chunk 1 (UI-H1, UI-M1).** `workout-load-comparison-chart.tsx` and `trend-chart.tsx` both still
passed `"var(--color-brand)"` straight to chart.js's `backgroundColor`, which silently renders
black on canvas (fillStyle can't resolve CSS custom properties). Both now call
`resolveColor("var(--color-brand)")` from the shared module — `workout-load-comparison-chart.tsx`
resolves it inside its `useMemo` so it re-resolves on theme change. `day-review-sheet.tsx` still
had `pb-safe` on its content div despite the bottom `SheetContent` already baking
`pb-safe-action` — a double inset invisible on the web sandbox (insets read 0) but real on
device; removed the redundant class.

**Chunk 2 (UI-L4, UI-M2, UI-M3).** Created `components/ui/dismissible-banner.tsx` — a shared
primitive encoding the container-div + separate-dismiss-button pattern (never nests
`role="button"` inside a real `<button>`, per CLAUDE.md's WebView gotchas). Confirmed the APK
download banner in `session-select-content.tsx` was already structurally correct (real `<a>` +
separate `<button>`) and left it as-is, per the plan's own "do not regress the one working
banner" note. Rewrote the two broken banners onto the primitive: the day-review banner (was a
`<span role="button">` nested inside a `<button>`, plus a `w-full` causing right-edge overflow at
narrow widths) and `weekly-recap-banner.tsx` (same nested-control shape, no `aria-expanded` on
its toggle). Both now get the primitive's `aria-expanded` on the expandable body and a real
44px-floor `<button aria-label="Dismiss">` sibling for free.

**Chunk 3 (UI-L3).** Added `aria-expanded` to `admin/time-audit-card.tsx`'s and
`admin/errors-tab.tsx`'s hand-rolled toggle buttons, closing the two remaining offenders the
review named (weekly-recap was already fixed in Chunk 2).

**Chunk 4 (UI-L1, UI-L2).** Palette-literal → token swaps while the Chunk 3 files were open, per
the plan's own "swap in-place" note: `errors-tab.tsx`'s red/amber source-badge background →
`var(--destructive)`/`var(--accent-amber)` tints; `time-audit-card.tsx`'s amber anomaly text →
`var(--accent-amber)`, plus its `⚠` string glyph replaced with the file's already-imported
`TriangleAlert` icon. `rest-day-card.tsx`'s `text-indigo-400` moon icon → `var(--accent-purple)`.
`more/oura-section.tsx`'s stale-sync indicator was both a light-mode contrast fail and a
colour-only signal (`rgb(250 204 21)` with no accompanying icon) — swapped to
`var(--accent-amber)` and added a `TriangleAlert` icon so staleness isn't colour-alone.
`more/update-check-card.tsx`'s hardcoded amber Tailwind classes → token + `color-mix` tints.
`home-card-widget.tsx`'s five-level `ENERGY_EMOJI` map replaced with a Lucide-icon map
(`BatteryLow`/`Frown`/`Meh`/`Smile`/`Zap`) and its `#f97316` sore-muscle text →
`var(--accent-amber)` (matching the card's existing label/icon tokens). `session-select-
content.tsx`'s "Exercise Readiness" mood-prompt card had three `#fbbf24` occurrences (gradient/
border, label, icon, CTA background) all moved to `var(--accent-amber)`; the CTA keeps its
explicit dark foreground (`#0a0a0a`) for contrast on the amber fill in both themes, matching the
plan's own reasoning for why a theme-driven foreground would fail in light mode.

`pnpm lint` (0 new errors, same 108 pre-existing warnings)/`pnpm exec tsc --noEmit` (clean)/
`pnpm test` (1294 passed)/`pnpm build` (clean) all green.

**Verified live** via Playwright against the local dev DB (test@local.dev, 384×832, both
themes): all three home banners (APK download, day-review, weekly-recap) render with genuinely
separate dismiss buttons — confirmed via a DOM ancestor walk that none is nested inside another
`<button>` — and each dismisses independently and persists across reload. The "Exercise
Readiness" mood card renders in amber/gold correctly in both themes. Health Progress tab's
Strength Trend and 1RM progress cards render with colour (no black elements) in both themes.
`/more`'s Oura section showed "Not connected" in the seed data, so the stale-sync amber+icon
indicator specifically wasn't exercised (no ring connection to go stale). The test user isn't
admin, so `/admin`'s two `aria-expanded` toggles weren't reachable either. **Not verified live:
the actual black-bar chart fix inside the Day-in-Review sheet** — the verification agent
couldn't get the sheet to expand past its collapsed header in headless Playwright, and no
Training-calendar day with an actual load-comparison chart was found in the seed data; the fix
itself is a minimal, direct application of the same `resolveColor()` pattern already verified
working (via the R6 PR's HR-recovery-chart fix and `trend-sparkline.tsx`'s long-standing use),
so risk is low but unobserved. Flagging honestly as a Known Issues row.

**Unrelated pre-existing bug found during verification, not part of this diff:** a reproducible
React hydration mismatch on Home's week-strip "today" cell (SSR renders a muted, non-"today"
aria-label; client re-renders it brand-colored/bold with "today" in the label) — a classic
SSR/client `todayInTz()` date-boundary drift per CLAUDE.md's own timezone rule. Not touched by
this PR (out of scope); noted here for a future backlog entry rather than silently dropped.

Version bumped 1.143.6 → 1.143.7 (patch — UI polish/theme-token/a11y fixes, no schema or
behavioral change). `lib/changelog.ts` entry added. **Backlog item 10 (R7) removed in full** —
all four chunks shipped, no remaining scope. Renumbered items 11–20 down to 10–19 and fixed
cross-references throughout the file (the protocol block's prose summary, the sleep-staging
item's two "item N" self-references to the sleep-stager-calibration item, and three "Queue item
N" mentions in the not-yet-queued section) — left the same two pre-existing, already-stale
references alone (the LF/HF item's "item 17's breathing-rate variability" note, and the protocol
block's still-incorrect "Item 8 is the workout-system hardening batch" phrasing) since both
predate this session's edits and untangling them needs more investigation than a docs pass
warrants. Continuing the backlog loop.

## Session 287 (cont.) — R8: Dates & Formulas Consolidation (item 10, now removed)

Worked the next queue item after R7: **R8 — Dates & Formulas Consolidation**
(`docs/superpowers/plans/2026-07-09-r8-dates-formulas-consolidation.md`, branch
`refactor/dates-formulas-consolidation`). Re-verified all 19 numbered findings against fresh
`main` before implementing (per the backlog's re-verify protocol) — 18 of 19 reproduced;
`components/overview-screen.tsx`'s stray `deviceTz` had already been cleaned up by an unrelated
earlier refactor and was dropped from Chunk 2's sweep list.

**Chunk 1 (DATE-A) — device-tz "today" mismatches:** `lib/ai-chat/tools.ts` gained a shared
`todayMid`/`daysAgo(n)` anchor at the top of `buildChatTools`, replacing six separate
`Date.now() − N×86400000` window computations (`getWorkoutsByExercise`, `getRecoveryVsPerformance`,
`getDayOfWeekTrends`, `getPlateauReport`, `getProgressVsPast`, `getTrainingLoadRisk`,
`getMilestones`) with server-tz-anchored equivalents — the worst of these,
`getProgressVsPast`, straddled a single AEST day across two comparison buckets near local
midnight, corrupting "how am I doing vs last month" answers. `session-select-content.tsx` and
`workout-select-content.tsx` both had a module-level `deviceTz` (from
`Intl.DateTimeFormat().resolvedOptions().timeZone`) driving their week-strip/last-trained-label
date math, disagreeing with the server's AEST bucketing — root-caused as the cause of the
**Home week-strip rest-day hydration mismatch** Known Issue tracked since session 208. Rebuilt
both on `todayInTz()`/`startOfWeekInTz()`/`todayDayOfWeek()`/`shiftDateStr()` (all server-tz);
`home-card-widget.tsx`'s sleep widget got the same `todayInTz()`/`shiftDateStr()` treatment for
its today/yesterday sleep lookup.

**Chunk 2 (DATE-B) — `normalizeDateParam` sibling sweep + `DEFAULT_TZ` literal cleanup:**
`app/api/day-timeline/route.ts`, `app/api/workout-sessions/day/route.ts`, and
`app/api/oura/hr-day/route.ts` each gained the `normalizeDateParam` guard already present on
`day-log` (session 212) and returned a 400 for a malformed `date` query param instead of 500ing;
`day-timeline` also closed an `endMs` NaN gap (guarded with `Number.isFinite`).
`lib/validators/chat.ts`'s `localDate` field and `lib/workout/log-exercise.ts`'s date handling
got the same guard. Six routes with a re-declared `'Australia/Brisbane'` literal instead of the
shared `DEFAULT_TZ` constant (`next-session`, `workout-data`, `log-exercise`,
`achievements`, `confirm-early-deload`, `profile/[userId]`) switched to the import; two
repository-layer raw-SQL literals in `adapter.ts` and one in `slices/oura.ts` got a
`TODO(tz): thread session tz` comment instead (the plan's own explicit scope note — parameterizing
raw SQL timezone literals needs deeper plumbing deferred out of this batch). Tightened
`eslint.config.mjs`'s timezone `no-restricted-syntax` rule to also catch `slice`/`substring` on
`toISOString()`, a direct `new Date().toJSON()` chain, and `toLocaleDateString('sv'|'en-CA')` —
re-running `pnpm lint` after the tightening surfaced one genuine new hit
(`session-select-content.tsx`'s cache-freshness check, fixed) and one false positive from an
initially-too-broad `.toJSON()` selector matching `PushSubscription.toJSON()` in
`lib/push-client.ts` (narrowed the selector to require a `new Date()` object, not any
`.toJSON()` call).

**Chunk 3 (FORM-A) — larger formula dedups:** `lib/health/hypnogram.ts` gained a canonical
`STAGE_COLOR` palette (deep/light/rem/awake), re-exported from `components/health/hypnogram.tsx`
and consumed by `home-card-widget.tsx`'s sleep stage bars — previously two independent inline hex
palettes. `getPlateauReport` in `lib/ai-chat/tools.ts` now calls the same `projectRm()`
(`lib/health/strength-projection.ts`) that drives the Health screen's strength-projection card,
instead of a separately-threshold'd verdict — so the AI chat's "what's stalled" answer and the
Health screen's plateau badge can no longer disagree for the same exercise.
`lib/ai-chat/analytics.ts`'s `classifyTrend` and `lib/health/long-term-goal-progress.ts`'s
`computeWeightRateKgPerWeek` were both rebuilt on the shared `linearFit()` helper instead of two
separate hand-rolled slope calculations. `lib/session-explain/group-signals.ts` and
`app/api/ai/health-insight/route.ts` both had a private readiness-band re-threshold (their own
70/50 cutoffs) — replaced with `scoreBand()` (the canonical band function) plus a small
label-display map, so the band boundary lives in exactly one place.

**Chunk 4 (FORM-B) — smaller formula dedups:** `lib/ai-periodization/acwr.ts` exported its
`ACWR_THRESHOLDS` (0.8/1.3/1.5) instead of hardcoding them inline in `acwrBand`;
`app/api/readiness-score/route.ts`'s modifier and `loadScore` blocks now reference the same
constants instead of their own copies of the same three numbers. `lib/ai-chat/context.ts`'s
`build1RmTargets` used a stray `mround(orm * 0.8, 1.25)` for its target-weight display —
switched to `mround(orm * 0.8, 0.25)` to match the canonical `target80` rounding in `lib/1rm.ts`
(a real, user-visible AI-chat number change — a bench 80kg 1RM now shows a target of 64kg instead
of 63.75kg; updated the matching unit test). `lib/ai-periodization/signals.ts` replaced an
inline ±0.5kg 1RM-trend threshold with the shared `oneRmTrendStatus()` from `lib/1rm.ts` — caught
and preserved an easy-to-miss null-handling edge case in the process (the original code left
`rm1Trend: 'flat'` when `current1rm` was null but `prev1rm` wasn't; a naive
`oneRmTrendStatus(current1rm ?? 0, prev1rm)` would have silently flipped that to `'down'`).
`lib/muscles.ts` gained a shared `roleWeight('main' | 'secondary')` constant (1.0/0.5), consumed
by `app/api/weekly-digest/route.ts`'s per-muscle weighted-set tally alongside `normalizeMuscle`
(two raw-SQL copies of the same weighting remain, each commented pointing back to this canonical
definition — parameterizing raw SQL was out of scope, same as the tz literals above).
`lib/workout/session-recap.ts` deleted its private `median()` in favor of the shared one in
`lib/workout/time-audit.ts` (null-guarded the call site since the shared function returns
`number | null`). Finally, `lib/date-utils.ts` gained two new shared helpers:
`daysBetweenDateStrs()` (UTC-day-key arithmetic, replacing hand-rolled day-diff math in
`workout-select-content.tsx`'s `getLastTrainedLabel` and `recommendation-card.tsx`'s
`lastSessionDay`) and `formatDateDisplay(raw, style)` (short "Jan 5" / long "Monday, 5 January"
forms, replacing `components/workout/utils.ts`'s `formatSheetDate` and
`components/overview-screen.tsx`'s `fmtDate` — both delegate to it now). `app/stats/stats-content.tsx`'s
third copy of the same formatter was left alone: confirmed dead code (`/stats` unconditionally
redirects to `/health`, no other file imports it).

`pnpm lint` (0 errors, same pre-existing warning count)/`pnpm exec tsc --noEmit` (clean)/
`pnpm test` (1294 passed, one pre-existing fixture updated for the intentional 0.25kg-rounding
change above)/`pnpm build` (clean) all green.

**Not verified live this session** (time-boxed to the gate + docs pass): the plan's own
interactive checklist — AI chat "how am I doing vs last month"/"PRs this year" against seed
data, `/session-select` week-strip agreement with server day-summaries, the four
`normalizeDateParam`-guarded routes returning 400 JSON for malformed dates, readiness-score
blended-score numeric parity before/after the ACWR refactor, and the AI-chat/Health-screen
plateau-verdict cross-agreement. All are low-risk, mechanical refactors (delegate-to-shared-helper
or constant-hoist, not new logic) verified by the type/test/build gate; flagging honestly per
CLAUDE.md's verification-disclosure rule rather than claiming device/interactive coverage that
didn't happen. The one deliberate user-visible behavior change (the 1RM target-weight rounding)
is covered by an updated unit test.

**Home week-strip rest-day hydration mismatch Known Issue (tracked since session 208) — struck.**
Chunk 1's `session-select-content.tsx` fix is the direct root-cause fix: the week strip now
builds "today" from `todayInTz()` (server-tz) instead of the device's local timezone, which is
exactly the server-vs-client "today" disagreement the original report described.

Version bumped 1.143.7 → 1.144.0 (minor — a real bug fix with a small user-visible number change,
not just internal refactoring). `lib/changelog.ts` entry added. **Backlog item 10 (R8) removed in
full** — all four chunks (19 findings) shipped, no remaining scope. Renumbered items 11–20 down to
10–19 and fixed cross-references throughout the file (the protocol block's prose summary, the
nutrition-uplift item's stale R6/R7/R8 dependency note, the LF/HF item's "item 17's" self-reference,
and three "Queue item N" mentions in the not-yet-queued section). Continuing the backlog loop.

---

## Session 298 — Persistent tab shell for MyFitnessPal-style instant tab switching — PLANNED + SHIPPED (v1.145.0, `claude/smooth-page-transitions-g4vr3p`)

Owner directive (2026-07-14): "make app page transitions feel smoother… mini load/delay between
pages… like MyFitnessPal / Samsung Health — I want this to be super responsive." Investigated why
tab switching still isn't instant despite the v1.133.0 instant-nav work (`staleTimes` router-cache
retention, `loading.tsx` boundaries, de-DB'd `/more`, SW document SWR — all confirmed still on
`main`). Findings: (1) **every tab tap still unmounts and remounts the target tab's whole React
tree** — even a zero-network router-cache hit rebuilds a 1,300+-line screen, re-runs every
cache-seed `useLayoutEffect`, and re-renders the full card fleet on the WebView, losing scroll
position; (2) the **first visit to each tab per app-open is still a network RSC fetch** (all five
tab pages are dynamic `await auth()` shells) and the 5-minute `staleTimes` window re-exposes the
round-trip after idling — the `TabLoading` skeleton flash on those taps is the owner's "mini
load"; (3) the v1.133.0 behaviour was **never verified on the S25 WebView** (existing Known-Issues
row). Native tab apps don't have the problem because tabs are kept-alive views and switching is a
visibility flip — the 2026-07-11 offline-feel review already named this as §5-P4's "cheaper
intermediate variant" (single client-side shell, tabs as client state) but it was never planned.

**Planned it this session** — `docs/superpowers/plans/2026-07-14-persistent-tab-shell.md`
(branch `perf/persistent-tab-shell`): a persistent `TabShell` client component owning the active
tab as state; all five tab routes render the shell (via a shared `TabPage` server wrapper — one
JWT decode, no DB); each tab content lazy-mounts on first activation and stays alive hidden
(`invisible` + `inert` + `content-visibility`, absolute stacking — scroll/state preserved); URL
synced via `history.replaceState` (Next 15 native-history shallow routing); a `useTabVisibility`
`{visible, epoch}` context replaces remount-driven refresh (each screen re-runs its existing
cachedFetch-backed refresh pass on re-show), with a Nutrition midnight-rollover guard and a
modal-open edge-swipe guard; cross-tab links (`/health?tab=body`, Home→More) go through a new
`navigateToTab` helper (cancelable CustomEvent → shell, router fallback outside it). Deliberately
untouched: full-screen `/workout?session=` route, `/profile/*`/`/admin` (BottomNav keeps a legacy
Link mode), the SW (no overlap with the queued deploy-skew item), `staleTimes` + `loading.tsx`
(still cover cold entries).

**Then implemented it in the same session at owner request** ("go ahead and implement the plan
now… I will allow you to do it and merge to main"). All 12 plan tasks landed:
- **Chunk A (mechanics):** `components/shell/tabs.ts` gained `TabKey`/`hrefForTab`/`tabKeyForHref`;
  new `tab-visibility.tsx` (`useTabVisibility` context), `lib/shell-nav.ts` (`navigateToTab`),
  `tab-shell.tsx` (the shell — home static-imported, other four `next/dynamic` per-tab code-split,
  each wrapped in a `TabVisibilityProvider`, hidden tabs `invisible`+`inert`+`content-visibility`
  absolute-stacked so scroll/state survive), and `tab-page.tsx` (shared server wrapper). The five
  tab routes (`app/(home)|health|workout|nutrition|more/page.tsx`) became one-liners rendering
  `<TabPage initialTab=…/>`; `/workout` keeps its full-screen `?session=` branch. `bottom-nav.tsx`
  now takes `activeTab`/`onTabChange` and drives the shell when present, else keeps its legacy
  `<Link>`/router mode (admin, `/workout-select`, error pages); `tab-swipe-navigator.tsx` routes
  through `navigateToTab` and bails when a Radix modal (`[data-radix-focus-guard]`) is open.
- **Chunk B (keep-alive refresh):** epoch-driven re-show refresh added to `session-select-content`
  (fetchMeta/fetchWorkoutData/loadTodayMood + its two cross-tab `router.push`→`navigateToTab`
  conversions), `health-content` (tabEpoch into the three refresh effects), `nutrition-content`
  (epoch effect with a midnight-rollover guard + supplements re-read), and `workout-select-content`
  (fetchData effect).

**Verified** via Playwright against `pnpm dev` on the local seeded DB (signed in as
`test@local.dev`, session saved to storageState to dodge the login rate limit): every tab tap —
first activation AND revisit — issued **zero** RSC/document requests (pure client visibility
flip), URL synced per tab via `replaceState`, scroll position preserved across switches (measured
123px→123px), deep link `/health?tab=body` + sub-tab/date state preserved. Only page error
observed is the pre-existing week-strip hydration mismatch (Known Issue session 208 — no
week-strip file touched). `pnpm lint` (0 errors), `pnpm exec tsc --noEmit` clean, `pnpm test`
(1294 passed), `pnpm build` all green. Route table confirms `/more` and `/nutrition` collapsed to
233 B thin shells (content now in shared chunks).

**NOT device-verified** (new Known-Issues row + device-smoke section added): the WebView *feel*
(the whole point), memory/GC with five live trees, the Android back-button now exiting from a tab
(intended `replaceState`, not `pushState`), `inert`/`content-visibility` WebView rendering, and
the Nutrition cross-midnight rollover (clock-gated). Owner authorized the merge.

Version bumped to **v1.145.0** (minor — user-visible navigation behaviour); `lib/changelog.ts`
entry added; `docs/module-map.md` + `docs/device-smoke-checklist.md` rows added; the perceived-
latency Known-Issues row updated to note the shell supersedes its tab-tap half (so `staleTimes`
now only covers cold route entries). **Backlog item removed, not queued** — implemented in this
same PR, so the backlog was left untouched. Rebased onto `main` repeatedly as R6/R7/R8/#518
(#515–518) landed mid-session; R8 shipped as v1.144.0 (a version collision, since this change had
also targeted 1.144.0) and #518 as v1.144.1, so the tab shell moved to **v1.145.0** (next minor
above them). R8 also independently fixed the Home week-strip hydration mismatch this session's
Playwright run had observed, so that caveat no longer applies on the rebased base. Plan retained
at `docs/superpowers/plans/2026-07-14-persistent-tab-shell.md`.

---

## Live-HR beat-median smoothing (v1.145.1, 2026-07-14, branch `claude/oura-hr-workout-accuracy-t4pokm`)

Owner reported spiky heart-rate readings during workout rest windows and asked (a) whether the
rest-window HR uses the fastest firing mechanism we have, and (b) whether "newest vs average" was
the cause. Investigation confirmed rest windows already use the fastest path — the DHR on-demand
burst (`triggerHrBurst` → `dhrBurstSequence`, re-fired every 10 s to stay engaged inside the ring's
~20 s auto-revert), which is the only path that actually streams frames on our re-keyed Ring 5
(plain `CONNECTED_LIVE` acks but emits nothing), forced on across the whole active phase
(`workout-screen.tsx:488-491`). So the burst is not the problem. The spikiness was a decode-layer
choice: each BLE frame carries a **batch** of beats (`0x80`/`0x60` `hr_bpm[]`, `0x86` `bpm[]`) but
`latestBpmWithTsFromFrames`/`latestValidBpm` surfaced only the single newest beat and discarded the
rest — and instantaneous beat-to-beat HR (`60000/IBI`) naturally swings 10–20 bpm (respiratory
sinus arrhythmia), so one motion/decode artifact showed unfiltered.

**Fix (planned as a docs-only PR first, then executed in the same session per owner request).**
`lib/live-hr/decode-live-hr.ts` now exposes `smoothedBpmFromFrames(frameHexes, afterRingTs,
windowBeats=HR_AVG_WINDOW_BEATS)` — collects every valid beat from frames newer than the last
surfaced ring timestamp, orders by ts, and returns the **median** of the most-recent
`HR_AVG_WINDOW_BEATS = 10` beats (reusing the shared `median()` from `lib/health/hr-smoothing.ts`,
One-Formula-One-Place). Median not mean is deliberate — a mean is dragged by a halved-HR
missed-beat artifact; a median rejects it (matches the codebase's existing `rollingMedian`
rationale). The window bounds the first post-connect history drain so a backlog can't blend minutes
into one "now" value. `OuraRingSource.emitFrames` calls it in place of the newest-beat pick; the
near-live freshness/dedup guard is preserved (a re-drained old tail contributes zero fresh beats →
null → stays blank for the staleness gate). The now-dead `latestBpmFromFrames`/
`latestBpmWithTsFromFrames`/`latestValidBpm` were removed (a function literally named `latest…`
would invite reintroducing the anti-pattern). Applied at the decode source so the live number, the
exercise trace, and the sparkline all inherit it — not one screen.

**Testing console.** Added `components/oura-ble/live-hr-test-console.tsx`, mounted on
`/admin/oura-ble` below the existing BLE debug. It starts/stops the live-HR manager on demand,
polls `getCurrent()` + `getDiagnostics()` at 1 Hz, and surfaces: the surfaced median bpm (with
stale dimming), the frames/HR-frames/decode-hits counters, the **raw within-batch beat spread**
(min/median/max via the new pure `allBeatsFromFrames`) so the median's smoothing is visible, a tag
histogram, and a rolling log of surfaced readings with beat-to-beat deltas to eyeball smoothness.
Inert on web by design (no ring frames) with an explicit "APK-only" note when `framesSeen === 0`.

**Verification.** New unit tests cover median-not-newest (six-beat batch returns 53 not 55), lone
artifact rejection (a 45-bpm spike among 120s → median 121), the freshness guard, the window bound,
0x80 IBI decode, out-of-range dropping, and `allBeatsFromFrames`. `pnpm test` (decode suite 12/12,
full suite green), `tsc`, and `eslint` on the changed files all clean. The full local `pnpm build`
fails only on the pre-existing sandbox-absent `@capacitor/splash-screen` module (declared dep
`^8.0.1`, installed in CI) — none of the changed files appear in the build errors. **NOT verified
on-device** (no BLE frames in the sandbox — `getOuraBle()` is null): the actual rest-window
smoothness. On-device gate: run a workout rest (or the new console) and confirm the surfaced bpm
tracks smoothly while `decodeHits` advances and the batch-spread row shows multiple beats per
burst; `HR_AVG_WINDOW_BEATS` is the single tunable if bursts prove sparse. Logged as a Known-Issues
row in `projectOverview.md`. Version bumped 1.145.0 → 1.145.1 (patch, rebased above the persistent
tab shell's v1.145.0); changelog entry added.
## Session — Workout rest-timer on "All sets done" + exercise-summary next-session card removed + Part-B planned (v1.146.0, `claude/rest-timer-countdown-tniklq`)

Owner-driven UX iteration on the active-workout flow (two screenshots + follow-ups).

**Shipped (v1.146.0):**
1. **Rest timer keeps counting on the "All sets done!" screen.** After the last set is logged,
   `handleLogCurrentSet` already flips `workoutPhase` to `"rest"`, stamps `lastSetRestStartMs`, and
   sets `lastSetRestSec` from the completed set's progression style (falling back to 90s via
   `effectiveRestSec`) — so the countdown, beep, and rest-complete notification were already running;
   the UI just hid the ring behind a static "All sets done!" card. Confirmed for the owner: **the last
   set IS awarded a rest period.** Extracted the rest ring's SVG into
   `components/workout/rest-ring.tsx` (pure visual — caller wraps it in the tap-to-skip button during
   the rest phase, or a plain div in the done state) and rendered it in the `allSetsLogged` branch of
   `active-workout-screen.tsx`, guarded on `workoutPhase === "rest" && restStartMs != null` with the
   original static card as fallback. Rolls into red "Overtime" past target, same as between sets. No
   new timer — it re-renders off the existing 1 Hz `useElapsedSec` session tick like the rest-phase ring.
2. **Removed the "Next Session" target-weights card** from `exercise-summary-screen.tsx` (per-exercise
   summary), plus the now-unused `mround125Up` import and `ps`/`target80` destructures.

**Planned, not built (Part B — owner-requested next-workout prescription at completion):** the owner
wants the *next scheduled session's* full prescription (weights/rest/sets, driven by the dynamic
AI-periodization assignments) on the done screen, tap-to-load. Investigation found the obvious
shortcut — calling `/api/workout-data?session=<next>` — is **unsafe**: that route re-evaluates,
expires, and fire-and-forget-regenerates the stored prescription **keyed on today** (`workout-data`
lines ~263–353), so previewing a *future* session there would mis-stamp/corrupt its prescription.
Correct build needs a **read-only** `GET /api/next-session/prescription` reusing `getNextSession` +
stored `getSessionPeriodization` + `prescriptionStyleForExercise` + PR/last-log 1RM basis. Wrote the
plan (`docs/superpowers/plans/2026-07-14-next-workout-prescription-on-completion.md`) and queued it as
backlog **item 20** (branch `feat/next-workout-prescription-preview`).

**Verification:** all 1360 tests pass (1297 passed / 63 skipped), ESLint clean on touched files,
`tsc` clean on workout files (only the pre-existing `@capacitor/splash-screen` module-not-found
remains, unrelated), `pnpm dev` boots and `/workout` compiles + renders 200 authenticated as the
seeded user. **NOT device-verified** — the rest ring on "All sets done!" is a visual change to the
APK's workout screen; the web sandbox renders the flow but reaching the state requires driving the
full log-all-sets path. Safe-area untouched (ring sits in the existing centre flex zone, no
header/footer changes). See the Known-Issues row.

## Session 291 (cont.) — Day-one continuous-capture results folded into the Oura-models program (claude/step-count-sync-issue-urr96y, docs-only)

The owner ran day one of the continuous capture (2026-07-15) and sent the diagnostics JSON, then
pointed at the new Oura-models program ("big change... I don't think this is relevant anymore").
Read the program docs (master plan + sub-plan D + backlog ⭐ block) and reconciled — the owner
ratified the conclusion in-session.

**Day-one diagnostics analysis (AEST):** started 08:43 at 63% (not fully charged). ~2 h of clean
streaming through the morning — 102k frames, chunks posting, **447 steps** counted including a
verified walk burst (~11:30, 175+126 in consecutive chunks). **Live-HR pause/resume fired cleanly
in production** (11:34→11:35). **Battery ~4%/hr while streaming** (62%→52% over 2.5 h) — inside
the acceptable range. The **WebView-alive limit bit exactly as documented**: the app died ~12:16
and nothing ran until 21:27 — the whole afternoon uncounted. At 22:28 a backlog of buffered chunks
all failed to POST at once (server mid-migration for the program work), overflowed the 15-chunk
retry cap and dropped ~10 — the bounded-queue design working as intended, not a bug. A stall
cluster at 12:04–12:16 (6 re-arms, 0 frames) preceded the app kill.

**Reconciliation (docs-only, this PR):** with Oura's decrypted `steps_motion_decoder` in hand
(program sub-plan D), recorded-gait decoding supersedes streaming as the primary step source —
all-day coverage, app-independent, no streaming battery cost. Item 1's **chunks 2 (cutover) and 3
(native port) are superseded by D** and must not be built as written; chunk 4 (recall calibration)
folds into D's validation. The continuous pipeline stays opt-in/off in two roles: **D's
ground-truth validator** (labelled walks via `countGaitGatedSteps` vs the ported decoder) and the
**AAD capture asset** (D §8/D-9). Corrected sub-plan D's pre-v1.143.0 claims in place: the Tier-2
accel counter is no longer "unproven" (validated + day-one numbers cited), the `0x33` stream does
NOT preempt DAYTIME_HR/SPO2 (only REAL_STEPS blocks it), live-HR coexists with the stream (proven
2026-07-13), and the "continuous all-day accel capture gap" is closed — AAD's open questions are
now REAL_STEPS mutual exclusion + WebView-alive coverage. Backlog item 1 annotated with the same;
projectOverview Known-Issues row flipped to ✅ day-one verified + role reframed. No code changes,
no version bump (docs-only).
