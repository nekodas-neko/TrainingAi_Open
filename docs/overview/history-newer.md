# Session Journal — batch (sessions ~217–286)

> Newest at top. Next batch: `history-current.md` (sessions ~287+). Previous batch:
> `history-newest.md` (sessions ~209–216). Index: `projectOverview.md` → Document Map.

## Session 286 — Health tab overhaul Chunk 6: missing-data states sweep — item complete (`feat/health-tab-overhaul`)

Continuing queue item 6 (health tab overhaul), plan
`docs/superpowers/plans/2026-07-10-health-tab-overhaul.md`, **Chunk 6 of 6 — the final chunk**.
Audited every `return null` in `components/health/*.tsx` and `app/health/**/*.tsx` against the
rule "self-fetching cards need an explicit failure state," distinguishing legitimately-hidden
states (no ring connected → `OuraSection` hidden is correct) from cases where a failed fetch is
indistinguishable from "nothing to show."

**The primary target, already flagged by CLAUDE.md itself.** `ai-insight-card.tsx` tracks a real
`error` state (set in its `catch` block on a raw `fetch` failure) but still `return null`ed on
`error || !insight` — vanishing on a genuine failure exactly like the project's own standing
rule warns against. Split the condition: `error` now renders an explicit "Couldn't load the AI
insight." line; `!insight` alone (AI declined, or the 429 rate-limit path — intentionally silent
by the original author's comment) still hides, since that's a legitimate "nothing to say" state.

**A load-bearing discovery: `cachedFetch`/`cachedFetchToday` never reject.** Before touching the
other candidate cards (`nutrition-activity-trends-card.tsx`, `workout-density-card.tsx`,
`trends-section.tsx`), read `cachedFetchCore` in `lib/sqlite/cache.ts` closely: its internal
`fetchPromise` catches every failure mode itself (`if (!res.ok) return`, `catch { /* Network
unavailable */ }`) and the outer promise always resolves — it never rejects. A first-pass fix
that attached `.catch(() => setError(true))` to a `cachedFetch(...)` call is therefore dead code
that can never fire (caught via a Playwright-driven forced-500 test before it shipped, not left
in the diff). Since `cachedFetch` genuinely cannot distinguish "the network call failed" from
"nothing to show," the only honest fix is Task 2.5's own established pattern (the HR chart fix
from Chunk 2): never `return null` — always render either data or an explicit "no data yet"
line, regardless of which of the two indistinguishable causes produced the empty state. Applied
that to `nutrition-activity-trends-card.tsx` ("No nutrition/activity trends yet.") and
`workout-density-card.tsx` ("No workout density trends yet."), each via a `loading` flag driven
by `.finally()` on the outer `cachedFetchToday` promise (which *does* always settle, unlike
`onData` firing).

**`trends-section.tsx` had the same disease with an extra wrinkle.** Its `!data ? null : ...`
branch left a genuine failure as pure blank space under the view-picker tabs (worse than the
other two cards — not even a skeleton, just nothing). Fixing the render branch alone wasn't
enough: `loading` was only ever set to `false` inside the `cachedFetch` `onData` callback, which
— per the discovery above — never fires on a failed fetch, so `loading` would stay `true`
forever and the render would be permanently stuck on the pulsing skeleton, never reaching the
new "Couldn't load this trend." branch at all. Fixed by moving `setLoading(false)` to a
`.finally()` on the outer promise, same pattern as the other two cards.

**Verification methodology — the standing "no evidence, no claim" rule applied literally.**
Rather than assume the fixes worked from reading the code, forced each underlying route
(`/api/health/trends`, `/api/health-trends`) to genuinely fail with a temporary `throw new
Error(...)` inserted after the auth/rate-limit checks (removed again the same session — never
committed), cleared `localStorage` so no stale cache seed could paper over the failure, and used
Playwright to confirm the actual empty-state text renders in the live DOM: "No nutrition/activity
trends yet." on the Body tab, "No workout density trends yet." on the Training tab, and
"Couldn't load this trend." on the Progress tab (the last one required two iterations — the
first Playwright check came back false because `loading` genuinely never became `false` until
the `.finally()` fix landed, which is exactly the bug the interactive test caught that a
`tsc`/build-only check never would have).

**Scope decision: `ai-periodization-status-card.tsx`, `ai-weekly-volume-card.tsx`, and
`strength-progress-card.tsx` left untouched.** All three follow the same `cachedFetch(...)
.catch(() => {})` → `return null` pattern, but each has a genuinely common "legitimately empty"
case in practice (a brand-new user with no active AI periodization sessions, no weekly-volume
targets, or no exercises with an estimated 1RM yet) — closer to the plan's own stated exception
("no ring connected → OuraSection hidden is fine") than to a hidden-failure bug. `aiVolume` is
additionally not reachable in the current default UI at all (deliberately omitted from
`TRAINING_DEFAULT_ORDER`, per an existing code comment). Judged not worth the noise of an error
line on every fresh-user page load for a supplementary card; left as a documented, deliberate
omission rather than silently skipped.

**Verification (static).** Full gate green: `pnpm lint` (0 errors, same 112 pre-existing
warnings)/`tsc --noEmit`/`vitest run` (1160 passed, unchanged — this chunk touches only render
branches, no new logic surface with dedicated tests)/`pnpm build` all green.

**This completes queue item 6 in full — all six chunks now shipped.** Backlog entry removed
from the queue entirely (not just annotated, per the standard "merged item must never linger"
rule) — items 7–18 renumbered down to 6–17, and the Reading-order preamble at the top of the
Queue rewritten to reflect the current, accurate state (it had also gone stale in a prior
session's edit, incorrectly describing item 6 as the already-shipped measured-time-model item
instead of the still-open health-tab-overhaul item — fixed in the same pass). Version bumped
1.137.0 → 1.137.1 (patch — the shipped change is a UX correction on failure paths, not a new
feature) with a `lib/changelog.ts` entry.

## Session 285 — Health tab overhaul Chunk 5: offline-first siblings (`feat/health-tab-overhaul`)

Continuing queue item 6 (health tab overhaul), plan
`docs/superpowers/plans/2026-07-10-health-tab-overhaul.md`, Chunk 5 of 6 — the offline-first
siblings the plan flagged as not covered by R3: `SleepContent` reading server-only while the
main Body screen reads the same sleep domain local-first, and injury writes going server-only
while injury reads were already local-first.

**Task 5.1 — Sleep detail local-first read.** Added a `getLocalStore(userId)` seed to
`app/health/sleep/sleep-content.tsx`, mirroring the pattern `health-content.tsx`'s `fetchMeta`
already uses for the same sleep domain — reads `store.getSleepSessions(cutoff)` and seeds
`sleepRows` before the existing `cachedFetch` reply lands, guarded so a later-resolving local
promise never clobbers state a faster network response already populated
(`setSleepRows(prev => prev.length > 0 ? prev : local)`). **A genuine schema gap surfaced
during implementation**: `LocalSleepSession` (the on-device SQLite sleep table's TypeScript
shape) only carries `id`, `date`, `durationHours`, `deepSleepHours`, `remSleepHours`,
`lightSleepHours` — none of the `sleepPhase5Min`/`sleepStart`/`sleepEnd`/phase-window fields
`SleepContent`'s Hypnogram and sleep-consistency card actually read. A local-only seed therefore
renders the score/detail chrome instantly but the Hypnogram/consistency cards stay in their
"no data yet" state until the network reply arrives — not a bug (every read site here already
guards with `!= null`, so an absent field degrades to "no data" rather than crashing), but a
real limitation worth flagging rather than silently shipping as if it were a full parity fix.
This exact gap already exists, unaddressed, in `health-content.tsx`'s own local-first sleep
seed (a pre-existing `as unknown as SleepRow[]` cast) — out of scope to fix here, since closing
it for real means extending the local SQLite table's schema (a local-migration task, per
CLAUDE.md's "assume partial application" rules for that surface), not a health-tab UI change.

**Task 5.2 — plan was stale, verify-first caught it.** Before touching `injury-sheet.tsx`, the
standing verify-first rule ("re-verify the plan against current main — plans can go stale while
they sit in the queue") turned up that the entire local+outbox write path the plan asked for
already exists: `injury-sheet.tsx`'s `handleSave`/`handleResolve`/`handleDelete` all call
`store.upsertInjury`/`store.deleteInjury` + `store.queueMutation({ domain: 'injuries', ... })` +
`pushMutations(userId)`, falling back to the raw API only if the local SQLite write itself
throws. `lib/data/postgres/adapter.ts`'s `pushMutations` already has an `mut.domain ===
'injuries'` branch, `getSyncDelta` already pages an `injuries` slice, and
`sqlite-backend.ts`'s `applyDelta` already handles the pull-side `delta.injuries` branch with
tombstone deletes. `node scripts/check-push-mutations.js` — the CI custom rule that fails the
build if `pushMutations` touches `this.db`/raw `sql` directly instead of the shared function
pattern — passes clean. Per CLAUDE.md's explicit guidance for exactly this situation
("reconcile first... if it's already done, remove the backlog entry... instead of forcing a
mismatched implementation just to clear the queue"), made zero code changes for this task —
just verified and documented that it's already shipped, presumably by other work not tracked
by this specific plan doc (it predates the plan's 2026-07-10 write date's assumptions).

**Verification.** Full gate green: `pnpm lint` (0 errors)/`tsc --noEmit`/`vitest run` (1160
passed, unchanged)/`pnpm build` all green. Dev-server pass: `/health/sleep` returns 200 with no
hydration/application-error markers, correctly exercising the web fallback path (`getLocalStore`
returns null in the web/dev sandbox, per the plan's own stated expectation) — **the APK is the
real gate for Task 5.1's actual local-read behavior**, not yet run on-device this session.

Bookkeeping: backlog entry for item 6 annotated — Chunk 5 shipped (both tasks accounted for,
one implemented, one verified-already-done); only Chunk 6 (missing-data states sweep) remains.
No version bump — Task 5.1's user-visible surface (an offline paint-speed improvement on one
detail page, gated by an on-device-only local store) is too negligible/unverifiable-in-sandbox
to warrant a changelog entry per CLAUDE.md's "if user-visible changes were shipped" threshold.

## Session 284 — Health tab overhaul Task 4.4: split the two hotspot files (`feat/health-tab-overhaul`)

Continuing queue item 6 (health tab overhaul), same-day follow-up to session 283. The prior
session deliberately deferred Task 4.4 (splitting `health-content.tsx`/`health-sections.tsx`
under the ~800-line ceiling) as its own remaining item, judging it too high-blast-radius to
rush at the end of an already-long session. Picking it up fresh here with the full session
budget for careful "pure move, no behaviour change" verification.

**Extraction from `health-content.tsx`.** Pulled the 7 inline `HealthMetricSheet` instances
into `components/health/metric-sheets.tsx` (props: `metricSheet`, `onClose`,
`metaRecentReversed`, `sleepReadings`) and the ~230-line day-overlay `<Sheet>` into
`components/health/day-overlay-sheet.tsx` (11 props covering the overlay state, session/HR
data, and 5 callback handlers for edit/delete/select actions). Went beyond the plan's literal
scope by also extracting the three dialogs the day-overlay triggers — the edit-exercise
`Dialog`, the delete-entry `Dialog`, and the delete-activity `Dialog` plus the delete-session
`ConfirmDialog` — into `components/health/day-overlay-dialogs.tsx`, since they're tightly
coupled to the same feature and pulling them too got the file the rest of the way toward the
line target. Each extraction cascaded a round of now-dead-import cleanup (`HrRecoveryChart`,
`EmptyState`, `cn`, `shortSessionName`, `modalWeight`, `avgReps`, `formatTime12h`, six lucide
icons, `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle`, `Dialog`/`DialogContent`/
`DialogHeader`/`DialogTitle`, `ConfirmDialog`, `Button`, `hrEmptyMessage`, `SessionHrData`) —
caught via `tsc`/lint after each step, not guessed at upfront.

**Extraction from `health-sections.tsx`.** Pulled the two largest inline card bodies the plan
named: the Sleep card (`components/health/body-cards/sleep-card.tsx`) and the resting-HR/HRV/
SpO₂ grid (`components/health/body-cards/rhr-hrv-spo2-card.tsx`). Both now call `useRouter()`
directly inside the extracted component rather than threading a `router` prop through from
`HealthSectionsCtx` — functionally identical (same `router.push` calls), just sourced locally
instead of via the ctx object. This left `router` genuinely dead in `HealthSectionsCtx`, its
destructure, and the `getHealthSections(...)` call site — removed from all three, which in turn
left the `useRouter()` call and import dead in `health-content.tsx` too (removed). This ripple
is a small deviation from a strictly literal "just move the JSX" reading of "pure move", but it
produces identical runtime behavior and is the honest result of chasing the unused-var warnings
each extraction step surfaced.

**Line count result:** `health-sections.tsx` 972→764 (well under the ~800 ceiling — 2 targeted
extractions were enough). `health-content.tsx` 1149→816 — close to but not strictly under 800.
The two items the plan explicitly named for this file (metric sheets, day-overlay sheet) were
both fully extracted, plus the bonus dialogs extraction; getting further under 800 would mean
splitting state-management logic (the `fetchMeta`/`fetchAllHealthData` callbacks, the ~30 state
hooks) rather than pure JSX moves, which was judged out of scope for a task explicitly framed
as "pure move, no behaviour change" — that's a different, riskier kind of refactor.

**Verification — interactive, not just static.** A "pure move" claim needs the actual moved
surfaces exercised, not just `tsc`/build passing (which only proves the code compiles, not that
sheets/dialogs still open and behave correctly at runtime). Used Playwright directly via the
globally-installed `/opt/node22/bin/playwright` package (not a project dependency, but the repo's
`PLAYWRIGHT_BROWSERS_PATH`/`chrome-linux/chrome` executable is available per the environment's
standing config) to drive the real dev server: logged in as the seeded test user, confirmed all
6 Body-tab group headers render, clicked the Sleep card and confirmed its `HealthMetricSheet`
opens, clicked the Body Weight and Resting HR tiles and confirmed their sheets open, clicked a
calendar day with real logged exercise data and confirmed the day-overlay sheet opens with
session content, expanded a session row and confirmed the Edit/Delete-session buttons render
and work, opened and cancelled the delete-session `ConfirmDialog`, and opened the edit-exercise
`Dialog` via its per-set pencil icon (confirmed the Save button renders). Zero console/page
errors across the entire pass — the only HTTP 400/401s were pre-existing Oura-sync calls
failing for the non-Oura-connected seed user, unrelated to this refactor (same pattern
observed in every earlier chunk's dev-server verification this session).

**Verification (static).** Full gate green: `pnpm lint` (0 errors, 0 new warnings after the
import cleanup)/`tsc --noEmit`/`vitest run` (1160 passed, unchanged — a pure move touches no
test-covered logic)/`pnpm build` all green.

Bookkeeping: backlog entry for item 6 annotated — **all of Chunk 4 (Tasks 4.1-4.4) is now
shipped**; Chunks 5-6 remain. No version bump / changelog entry — this is an internal
refactor with zero user-visible behavior change, so CLAUDE.md's "bump if user-visible" rule
doesn't apply.

## Session 283 — Health tab overhaul Chunk 4 (Tasks 4.1-4.3): Body-tab information architecture (`feat/health-tab-overhaul`)

Continuing queue item 6 (health tab overhaul), plan
`docs/superpowers/plans/2026-07-10-health-tab-overhaul.md`, Chunk 4 of 6 — the Body tab's IA
half of the review, done after Chunk 2 (which already deleted the two permanently-dead Oura
cards) so the regroup works against the real, live card set.

**Body-tab regroup (Task 4.1).** The old flat 14-card scroll scattered heart data across 4
separate positions (rhr/hrv/spo2, hrvBaseline, trainingLoad, sleepVsPerformance) and put sleep
far from its correlation card. Replaced `BODY_SECTIONS`/`BODY_DEFAULT_ORDER` with a
`BodyGroup[]` structure (`{ header, cards }`) rendered under 6 labelled headers: Body, Sleep,
Heart & recovery, Activity & intake, Ring, Injuries. New tiny `components/health/
section-header.tsx` primitive (`<h2>` with the standard uppercase-tracking-wide muted style —
grepped `components/ui/` first per the plan's instruction; no existing list-section-header
primitive was found, so this one is genuinely new). `BODY_SECTIONS`'s `cardKeys` field was dead
metadata (only ever used to derive the flat order, never read anywhere else) — removed rather
than carried forward into the new structure.

**Dead reorder mode deletion (Task 4.2).** `SortableHealthCard` was confirmed to be a total
no-op — its component body ignores both the `id` and `editMode` props entirely and just renders
a passthrough `<div>{children}</div>`. The Health tab header's `LayoutGrid` reorder-toggle
button had therefore never actually enabled drag-reordering; it only toggled dead state. Removed
the button, the `cardEditMode` state, and all three `<SortableHealthCard>` wrapper usages across
the Body/Training/Progress panels — each section renderer already sets its own `key` on its
returned element, so the wrapper was pure overhead. Deleted
`components/health/sortable-health-card.tsx` outright after confirming (via repo-wide grep) no
remaining references. `bodyOrder`/`trainingOrder`/`progressOrder` state and their `getHealthCardOrder`-seeded
initial values were left alone (still harmless, and `saveHealthCardOrder`/`saveHiddenHealthCards`
already have zero callers anywhere in the codebase — a broader vestige than this task's stated
scope, left for a future pass rather than scope-creeping this one).

**Sparkline consolidation (Task 4.3).** The `bodyFat` card's hand-rolled inline
`<svg><polygon/><polyline/></svg>` (custom gradient, per-point radius emphasis on the last dot)
was replaced with the shared `<Sparkline>` primitive `bodyWeight`/`leanMass` already use —
`showDots fill responsive` at the same 260×44 dimensions and `#f43f5e` accent color. The shared
primitive draws all dots the same size (no special last-dot emphasis), a minor visual
simplification the plan's "same data array, same accent prop" framing doesn't preclude.

**Verification.** Full gate green: `pnpm lint` (0 errors, same 112 pre-existing warnings)/`tsc
--noEmit`/`vitest run` (1160 passed, unchanged — this chunk is layout/render-only, no new logic
surface)/`pnpm build` all green. Dev-server pass: logged in as the seeded test user, confirmed
all 6 group headers ("Body", "Sleep", "Heart & recovery", "Activity & intake", "Ring",
"Injuries") render in the Body-tab HTML, the "Reorder cards" button no longer appears anywhere
in the DOM, and all three Health tabs (`?tab=body/training/progress`) still return 200 with no
`Application error`/hydration markers.

**Scope decision: Task 4.4 deferred.** The plan's Task 4.4 (splitting `health-content.tsx` and
`health-sections.tsx`, currently ~1150/~910 lines, under the ~800-line ceiling by extracting the
day-overlay sheet, the 7 `HealthMetricSheet` instances, and the largest inline card bodies into
`components/health/`) was deliberately not attempted this pass. It's the highest-blast-radius
task in the whole plan — it touches every card body across both files with a "pure move, no
behaviour change" requirement that needs careful verification of every moved surface (open each
metric sheet, the day overlay, edit/delete dialogs) — and the smaller Tasks 4.1-4.3 already
landed a complete, independently shippable unit of value (the actual IA regroup + dead-code
deletion + sparkline consolidation) without it. Left as the explicit remaining item for a future
session, alongside Chunks 5-6.

Bookkeeping: backlog entry for item 6 annotated in place with the Chunk 4 (Tasks 4.1-4.3)
summary (Task 4.4 + Chunks 5-6 remain, not started); version bumped 1.136.1 → 1.137.0 (minor —
new user-visible IA regroup, not just a bug/perf fix).

## Session 282 — Health tab overhaul Chunk 3: instant paint & fetch efficiency (`feat/health-tab-overhaul`)

Continuing queue item 6 (health tab overhaul), plan
`docs/superpowers/plans/2026-07-10-health-tab-overhaul.md`, Chunk 3 of 6 — the health tab still
flashed loading skeletons on repeat visits and re-rendered its whole ~27-card fleet on unrelated
state changes.

**Instant paint (Tasks 3.1–3.3).** `weekly-stats` was fetched via `cachedFetchToday` but never
seeded synchronously — added a `readTodayCacheSync('weekly-stats')` read alongside the other
seeds in the mount-time `useLayoutEffect`, so WeeklyStatsHub paints from cache instead of
skeleton on a repeat open. The `body-metadata` seed/fetch handling previously gated *all* fields
(today's tiles, the trend arrays, week-to-date) behind `isBodyMetadataFresh` — a stale (not-today)
cache entry meant 13 pulsing skeleton cards even though the trend data itself was perfectly fine
to show. Extracted a shared `setMetaFromPayload` callback (used by both the sync seed and the
network `cachedFetch` callback) that always paints `metaRecent`/`weekToDate` and clears
`metaLoading` immediately, and only gates `metaToday`/`calsBurnedToday` (today's tiles, which
already render "—" for null) behind the freshness check. `fetchMeta` previously `await`ed the
local-store read before starting its three network fetches — restructured into two promises
(`localSeedPromise`, `networkPromise`) that start together via `Promise.all`, so the network
requests fire immediately instead of waiting on the local SQLite read first.

**Render hygiene (Task 3.4).** Wrapped all 12 named health cards in `React.memo`
(`OuraSection`, `InjuryCard`, `NutritionActivityTrendsCard`, `WorkoutDensityCard`,
`StrengthProgressCard`, `StrengthTrendCard`, `GoalsProgressCard`, `TrendsSection`,
`AiPeriodizationStatusCard`, `AiWeeklyVolumeCard`, `WeeklyMuscleSetsCard`,
`ActivityHistoryCard`) via `export const X = memo(function X(...) {...})`, keeping the same
export name so `next/dynamic` and static import call sites needed no changes. Their existing
props were already reasonably stable (state values and `useCallback`-wrapped handlers, not
inline literals), so the memo wrap alone should meaningfully cut re-renders across the
~30-state-hook orchestrator without further call-site changes. The 6 `metaRecent`-derived
`HealthMetricSheet` `readings` props each re-derived `[...metaRecent].reverse()` inline on every
render — hoisted to a single `metaRecentReversed` `useMemo`. R6 (queue item 11, PERF-4/PERF-7 —
the plan's flagged overlap risk) had not landed yet at implementation time, so nothing needed
reconciling.

**Cleanup found along the way.** Fixing two new `react-hooks/exhaustive-deps` warnings (adding
`setMetaFromPayload` to the two effects that now call it) surfaced a real gap from the *previous*
session: Chunk 2 deleted the `ouraIndicators` case from `health-sections.tsx` but left the now-
unused `cn` import behind — removed it here.

**Verification.** Full gate green: `pnpm lint` (0 errors)/`tsc --noEmit`/`vitest run` (1160
passed, unchanged — this chunk is render/timing-only, no new test surface)/`pnpm build` all
green. Dev-server pass: logged in as the seeded test user, confirmed all three Health tabs
(`?tab=body`, `?tab=training`, `?tab=progress`) return 200 with no hydration/application-error
markers in the rendered HTML, and `/api/weekly-stats` returns real seeded data confirming the
new seed path's target endpoint is live. **Not exercised:** a React DevTools profiler pass
proving the memo wrap measurably reduces re-render count on sibling state changes (e.g. opening
the water-log sheet no longer re-rendering `OuraSection`/`TrendsSection`) — the plan's stated
verification step for Task 3.4 needs an interactive browser session this sandbox doesn't have;
the change is structurally correct (stable export names, stable call-site props) but the
before/after render-count comparison itself is unverified.

Bookkeeping: backlog entry for item 6 annotated in place with the Chunk 3 summary (Chunks 4–6 —
Body-tab IA regroup, offline-first siblings, missing-data states — remain, not started); version
bumped 1.136.0 → 1.136.1 (patch — perf/paint fix, no new user-visible feature surface).

## Session 281 — Health tab overhaul Chunk 2: post-re-key data honesty (`feat/health-tab-overhaul`)

Continuing queue item 6 (health tab overhaul), plan
`docs/superpowers/plans/2026-07-10-health-tab-overhaul.md`, Chunk 2 of 6 — closing the gap where
the health tab quietly lost most of its Oura content at the 2026-07-07 direct-BLE re-key: dead
Cloud-only cards left rendering nothing forever, and one decoded-but-discarded BLE signal.

**Respiratory rate (Task 2.1).** The sleep-staging rollup (`adapter.ts`, the `phases.length ===
0` heuristic-stager branch) already called `breathingFromIbi(b.ibi)` per epoch to feed the
stager's `breathVar` signal, but discarded the function's other output, `rateBrpm`. Hoisted the
call so both fields are read from the same computation; the night's `respiratoryRate` is now the
median of per-epoch rates when at least 6 epochs (~30 min) have signal, else `null`, written to
the new `respiratoryRate` field on the `sleepRows.push()` object — `upsertOuraSleep`'s existing
`COALESCE(EXCLUDED.respiratory_rate, sleep_sessions.respiratory_rate)` means old Cloud-sourced
rows are never clobbered by a null. The DB-backed fallback test
(`oura-ble-sleep-fallback.test.ts`) needed more than its existing IBI seed data — the prior
seed pushed the same 3-value IBI triplet on every event, and `breathingFromIbi`'s `MIN_BEATS`
(40) and detrended-signal-amplitude gates both reject that as noise, always returning `null`.
Replaced it with a synthetic respiratory-sinus-arrhythmia stream — an ~800ms baseline beat
interval modulated by a real ~4.2s breathing cycle — so the algorithm has a genuine oscillation
to detect; the new assertion checks the night's stored rate lands in the 8–22 br/min
plausibility band.

**Dead Cloud-only cards (Tasks 2.2–2.4).** Three OuraSection sub-cards (Activity, Stress &
Recovery, Advanced biometrics) and the Body-tab `ouraIndicators` chip strip were all gated on
`oura_daily` fields the Cloud API stopped writing at the re-key — permanently `null` for every
day since, so the cards were dead weight that could never show data again. Deleted all four,
along with their now-unused helper functions (`ScoreBar`, `ContributorRow`, `readinessColor`)
and imports (`cn`, `scoreBand` in `oura-section.tsx`). Kept the 24h HR chart, Time Worn tile,
battery, ring info, and the Readiness/Sleep contributor links — none of those are Cloud-gated.
Also relabeled the Activity detail page's blend card (was "Oura N", now "Base (app-computed)" —
the base score has been `computeActivityScore`'s own calculation since the re-key, not Oura's),
and removed the dead recommended-bedtime card + `sleep_regularity` mention on Sleep detail and
the dead temperature-deviation card on Readiness detail (same frozen-Cloud-only class).

**HR chart gap rendering (Tasks 2.5–2.6).** The HR day chart previously interpolated a straight
line across any missing stretch — including the ring's real power-gating gaps — making a "no
data" period look like a smooth, plausible reading. Added `withGapBreaks`, a pure function that
inserts a `null` break between bucketed points more than 20 minutes apart, paired with
`spanGaps: false` on the chart.js dataset so those gaps now render as visible breaks. Extracted
the function to a sibling `hr-day-chart-gaps.ts` file rather than keeping it inside
`hr-day-chart.tsx` as the plan specified — importing the `.tsx` component directly from a `.ts`
test file failed vite's import-analysis in this repo's esbuild/vitest config (unrelated to JSX
correctness; the component itself compiles and type-checks fine). The OuraSection HR card no
longer vanishes when today has zero readings — it now shows an empty state ("No HR captured yet
today — the ring records periodically while worn"), matching the self-fetching-card rule. The
heart-rate detail page (`/health/heart-rate`) gained the same `HrDayChart` under its stat grid
(dynamic import, `ssr: false`), fed by the same `oura-hr-day:${date}` cache key/endpoint
`OuraSection` already uses — previously the 24h series only rendered on the main Body tab.

**Verification.** Full gate green: `pnpm lint` (0 errors, same 113 pre-existing warnings)/`tsc
--noEmit`/`vitest run` (1160 passed, up from 1157)/`pnpm build` all green. The DB-backed
sleep-fallback test passed against the local dev Postgres (4/4, including the new respiratory-
rate assertion). Dev-server pass: logged in as the seeded test user, confirmed `/health`,
`/health/heart-rate`, `/health/activity`, `/health/sleep`, `/health/readiness` all return 200;
`/api/oura/hr-day` returns the expected empty-readings shape and the heart-rate page renders the
"No HR captured yet today" empty state for it; `/api/sleep-sessions` confirmed the new
`respiratoryRate` field is present in the response shape end-to-end (`null` for the seed data,
since the seeded test user has no BLE raw samples). **Not exercised:** real BLE night
respiratory-rate values and HR-gap rendering against an actual ring's power-gating pattern —
sandbox uses synthetic frames per the plan's own device/redecode note; existing stored nights
still need one owner Redecode pass to backfill the new respiratory-rate field.

Bookkeeping: backlog entry for item 6 annotated in place with the Chunk 2 summary (Chunks 3–6 —
instant paint, Body-tab IA, offline-first siblings, missing-data states — remain, not started);
version bumped 1.135.1 → 1.136.0 (`lib/changelog.ts` entry added, user-visible UI changes:
dead-card removal + HR chart honesty + respiratory rate).

## Session 280 — Health tab overhaul Chunk 1: cache correctness & route hygiene (`feat/health-tab-overhaul`)

Backlog-driven implementer pass, working queue item 6 (health tab overhaul, owner-requested
2026-07-10), plan `docs/superpowers/plans/2026-07-10-health-tab-overhaul.md`. Six-chunk plan;
this pass ships Chunk 1 only (the plan's own sanctioned partial-landing point — "chunks 1–2 are
the high-value core if the item is worked across multiple sessions") and leaves the item in the
queue annotated with what shipped.

Verify-first re-check against current `main` before implementing: all five cache-invalidation
gaps the plan found (2026-07-10) were still present unfixed. Closed them: `weekly-muscle-sets`
added to `invalidateExerciseLogged`; `health-trends-summary` added to both
`invalidateBodyMetricWrite` and `invalidateActivityWrites`; `training-load` added to
`invalidateActivityWrites`; the `health-trends:` prefix added to `invalidateNutritionWrite`;
`sleep-performance-correlation` added to both `invalidateBiometrics` (previously untested — no
test existed for this group at all) and `invalidateOuraSync`. `oura-stats` converted from a
bare `cachedFetch`/`readCacheSync` key to `cachedFetchToday`/`readTodayCacheSync` so a cached
entry from a previous day is treated as a miss instead of momentarily flashing yesterday's
wear/battery — the file's existing lazy-init `useState` seed pattern (a separate hydration-risk
issue) is deliberately left alone since it's owned by the queued R6 PERF-7 task, per the plan's
own "coordinate, don't fight" instruction. New `HEALTH_TRENDS_SUMMARY_TTL` constant in
`lib/cache-ttl.ts` replaces the raw `TTL_LONG` literal duplicated across its 5 call sites
(`oura-section.tsx`, `workout-density-card.tsx`, `nutrition-activity-trends-card.tsx`,
`health-score-detail.tsx`, `heart-rate/page.tsx`). The `/api/health/trends` and
`/api/health-trends` routes previously shared one rate-limit bucket key
(`` `${userId}:health-trends` ``) at different limits (10/60s vs 20/60s), so they contended
against each other — renamed the first route's bucket to `:health-trends-summary` so they're
independent. `AiInsightCard` now reads/writes `getCached`/`setCached` keyed on
`ai-health-insight:<section>:<date>` before/after its POST, closing the gap where a few
detail-page visits (each firing an uncached POST) exhausted the route's 10/hr budget and later
cards silently showed errors; the manual refresh button still forces a fresh POST and re-caches
the result.

**Verification.** Full gate green: `pnpm lint`/`tsc`/`vitest` (1157 passed, up from 1156 — new
`invalidateBiometrics` test plus extended assertions on 5 existing group tests) all green;
`pnpm build` succeeded. Dev-server sanity pass against the local seeded DB: `/health` and
`/health/readiness` render 200; confirmed the rate-limit bucket split empirically — 11 rapid
calls to `/api/health/trends` returned 200×9 then 429×2 (limit 10), while `/api/health-trends`
stayed unaffected at 200 both before and after. Chunk 1 has no local-store/APK-only surfaces, so
nothing was left unexercised for this pass.

Backlog entry annotated in place (not removed — 5 chunks remain: post-re-key data honesty
Chunk 2, instant paint Chunk 3, Body-tab IA Chunk 4, offline-first siblings Chunk 5,
missing-data-states sweep Chunk 6). Version bumped 1.135.0 → 1.135.1 with a `lib/changelog.ts`
entry.

## Session 279 — Measured workout time model + budget margins (`feat/measured-time-model`)

Backlog-driven implementer pass, plan `docs/superpowers/plans/2026-07-10-measured-time-model-budget-margins.md`
(owner-requested 2026-07-10 — sessions overrun the 60-min budget). Ships all 9 tasks in one pass
and removes the item from the backlog.

New `lib/workout/time-profile.ts` builds per-exercise time profiles from `set_logs` history: a
measured seconds-per-rep (pooled across an exercise's sets, robustStats-outlier-excluded) and a
measured rest-seconds median bucketed by %1RM effort band (light <70 / moderate 70-80 / heavy
80-90 / max ≥90), each gated on ≥10 outlier-excluded samples with a fallback ladder (band →
exercise-overall → caller's constant). `lib/workout/duration-model.ts` gained
`WARMUP_FRACTION`/`FINISH_EARLY_FRACTION`/`workingBudgetMin()` (replacing the flat
`SESSION_WARMUP_MIN = 10` with `budget × (1 − 15% − 10%)` — a 60-min budget now targets 45 min of
working time instead of 50) and `effectiveSetWorkSec()`/measured-override fields on
`DurationExercise`, so `estimateExerciseDurationSec` uses the measured tempo/rest when available.
`fitToBudget` (`lib/ai-periodization/time-budget.ts`) now trims against the same effective values
— previously a session that looked like it fit on the optimistic constants could still overrun in
practice because the trim-priority comparison used the constants even when a measured value was
known to be much higher.

Verify-first catch: the plan's `getAvgSetDurationPerExercise` → `getSetTimingRows` replacement
snippet dropped three soft-delete filters (`isNull` on `setLogs`/`exerciseLogs`/`workoutSessions`
`deletedAt`) that the original function had — preserved them in the actual implementation rather
than copying the plan verbatim, since dropping them would have let deleted sets/sessions leak into
the measured profiles. `lib/ai-periodization/signals.ts` now derives both the new `timeProfile`
per exercise and the existing `avgSetDurationSec` fallback from one `getSetTimingRows` query
(previously two separate DB round-trips via the old SQL-median function). The AI prompt
(`lib/ai-periodization/prompt.ts`) now tells the model the exercise's `measured_sec_per_rep` and
`measured_rest_by_band` when known, and the deterministic enforcement in the prescribe route
(`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`) resolves the measured rest via
`resolveMeasuredRestSec(profile, prescribedPct)` at all three sites (main-path budget input,
main-path duration estimate, deload-path both) — closing the gap where measured values reached
the AI's prompt but the deterministic trim/estimate math silently ignored them. An
over-budget-at-floors note now appends to the prescription's `reasoning` when even maximally-trimmed
sets still exceed the working budget (role floors are absolute, so an oversized session can't
always be trimmed to fit) — surfaced instead of failing silently, per the plan's explicit
rollout-notes warning that the owner's current program is known to already overrun under the new
stricter budget. `app/api/generate-program/route.ts` and `app/api/builder-chat/route.ts` (the
sibling sweep) now size against `workingBudgetMin()` instead of the flat 10-minute allowance.

**Test-file gotcha**: `tsconfig.json` excludes `**/__tests__/**`, so `pnpm exec tsc --noEmit`
never actually re-typechecks test fixtures the way the plan's Task 5 Step 2 assumed — the plan's
"tsc will flag fixtures missing `timeProfile`" didn't happen because tests aren't in the checked
set at all (Vitest/esbuild transpiles without full type-checking). Added `timeProfile: null` to
the one affected fixture (`lib/__tests__/prompt-deload-awareness.test.ts`) anyway for type
accuracy, though it wasn't strictly required for tests to pass.

**Verification.** Full gate green (1156 tests passing, up from 1139 — 14 new time-profile tests +
3 duration-model + 2 time-budget). Dev-server end-to-end check against the local seeded DB (real
Gemini prescription call, not mocked): `GET /api/ai-periodization/session/<id>` confirmed
`effectiveTimeBudgetMin: 45` for a 60-min-budget session (matches `workingBudgetMin(60)`) and both
the null-profile (0 samples, all-null fields) and no-profile (`undefined` → `null`) fallback paths
ran without error for the seed's sparse timing history — the correct outcome per the plan's own
framing ("profiles being mostly null is correct; the check is that both branches run clean, not
that every exercise has measured data"). `POST /api/ai-periodization/session/<id>/prescribe`
returned a real prescription with `estimatedSessionDurationMin: 39` fitting inside the 45-min
working budget. `POST /api/generate-program` still generates a program correctly with the new
`workingBudgetMin`-sized target-exercise-count math. **Not exercised:** real Gemini output
variance across many calls (only one live call made), and prod `set_logs` timing-history data
drift vs the clean local seed (the null-dropping + ≥10-sample gates are the defence per the
plan's rollout notes).

`docs/module-map.md` gained a row for `lib/workout/time-profile.ts`. Version bumped 1.134.0 →
1.135.0 with a `lib/changelog.ts` entry (user-visible planner behaviour change). Backlog item
removed (fully shipped in one pass); every scattered `item N` cross-reference and the reading-order
note renumbered in the same PR.

## Session 278 — Home page freshness/performance Chunks 3-5: local-first reads, render hygiene, UI polish (`perf/home-freshness-caching-chunks-3-5`)

Backlog-driven implementer pass, continuing queue item 6 (home-page freshness/caching/performance,
owner-requested 2026-07-10), plan `docs/superpowers/plans/2026-07-10-home-page-freshness-and-performance.md`.
Chunks 1-2 shipped v1.130.1 (session 273); this pass ships the remaining Chunks 3-5 and removes
the item from the backlog.

**Chunk 3 — local-first reads.** `session-select-content.tsx`'s sleep widget, trained-days/streak
and week-to-date now seed from the on-device local store before the network fetch resolves
(APK-only — the web sandbox has no local store, so these paths are no-ops there and only the
pre-existing network-fetch fallback is exercised in-sandbox). Verify-first caught two places the
plan's literal snippets diverged from actual server semantics: `getCalendarData`/
`getRecentTrainedDays` key a "trained" day on having at least one logged exercise, not on
`completedAt` being set, so the local fill uses `store.getWorkoutHistory()` (which already joins
non-deleted `exerciseLogs`) instead of a naive `completedAt` filter; and the server's `weekToDate`
calorie figure is `foodLogCalories + metricsOnlyCalories` (food-logs take priority per day, to
avoid double-counting) while `LocalFoodLog` carries no calorie field at all (only
`foodItemId`+`quantityMultiplier`, needing a food-item join). Implemented `steps`/`waterMl` to
exactly match server semantics (including the previously-missed `activity_logs` steps), scoped
`calories` to a documented body-metrics-only best-effort — real data, just possibly incomplete on
food-logged days until the network response (fired immediately after) supersedes it — rather than
attempting the join under time pressure or fabricating a number.

**Chunk 4 — render hygiene & orchestrator slimming.** `OuraScoreChipRow`, `DeloadBanner`,
`RestDayCard`, `EarlyDeloadCard`, `GoalsCheckinCard` wrapped in `React.memo`; call sites
stabilized (`handleGoalsReviewNow`/`handleGoalsRemindLater` converted from re-created-per-render
`async function`s to `useCallback`s, `EarlyDeloadCard`'s inline `onConfirm`/`onDismiss` and
`ExerciseDetectedCard`'s `onReview` hoisted into `useCallback`s) — memo with unstable props is a
silent no-op, so this had to land together. The "Log value" sheet (state + `handleSaveLog` +
`openLog`) and the week-day overlay sheet (state + `handleWeekDayClick`) extracted into
`app/session-select/components/{log-value-sheet,week-day-sheet}.tsx` as props-driven children —
`WeekDaySheet` now owns its own `day-log:<date>` fetch (parent just tracks the open date),
`LogValueSheet` takes `metaToday`/`metaRecent`/`setMetaToday`/`fetchMeta` directly rather than a
new `onSaved` abstraction, keeping the save semantics (local-first write, outbox, optimistic
fallback) byte-identical per the plan's "no refactors beyond the move" instruction. Orchestrator
down to 1,323 lines from ~1,590 — short of the plan's ~1,200 target (honest partial progress, as
the plan itself frames it; further extraction rides with R6 PERF-12 if picked up later).

**Chunk 5 — UI tokens, a11y, touch targets.** New `lib/health/recovery-band.ts` (`recoveryBand()`)
replaces a duplicate inline `recoveryColor()` found in `muscle-recovery-card.tsx` during the
sibling-surface sweep (also fixed a real bug there: the old code appended a hex-alpha suffix
(`color + "18"`) to the color string for translucent backgrounds, which breaks once the color is a
`var(--token)` string instead of a hex literal — replaced with `color-mix()`). `--accent-red`
doesn't exist in `globals.css`; used `--destructive` as the closest existing token instead of
inventing a new hex, per the plan's own fallback instruction. Token fixes: admin badge and Save
button (`text-white` → `text-destructive-foreground`/`text-primary-foreground`), goals-checkin and
early-deload CTAs, the muscle-status donut ring/background (`bg-white/10` → `bg-foreground/10`),
week-strip day pills. New `readableOn(hex)` YIQ contrast helper added next to `accentCardStyle` in
`lib/utils.ts` for the Start Workout button, whose background is a user-picked accent color with
no established token. `readiness-card.tsx`/`body-battery-card.tsx`'s clickable-`<div>` expanding
headers converted to real `<button type="button" aria-expanded>` (verified no nested interactive
controls in either card's full render tree first). Touch targets bumped to ≥44px on the header
reorder/refresh buttons (`min-h-11 min-w-11`), the APK-banner dismiss button (`p-2.5 -m-1`,
same visual size, bigger hit area), and the metric-tiles Log pill; the 36px avatar button accepted
as-is per the plan's own allowance (large corner target).

**Verification.** Full gate (`pnpm lint`/`tsc`/`vitest`/`build`) green after every task. Chunk 3
verified as pre-existing-hydration-mismatch-unrelated via a `git stash` A/B Playwright comparison
(the week-strip "today" `aria-label`/class hydration warning reproduces identically on unmodified
`main` — a pre-existing bug, not a regression, out of scope here). Chunk 4's two sheets verified
via Playwright against `pnpm dev`: LogValueSheet opened, accepted input, and saved without console
errors; WeekDaySheet opened with the correct fetched day data. Chunk 5 verified via Playwright at
384×854 in both light and dark theme: zero console errors, keyboard Enter toggles
`aria-expanded`, no white-on-light-background text observed on any touched surface. **Not
exercised:** the S25 APK — Chunk 3's local-first paths, Chunk 5's touch-target sizing, and any
Samsung-WebView-specific rendering were only checked in the web sandbox/Playwright, never on
device.

Backlog item removed (fully shipped across two sessions, v1.130.1 + v1.134.0); the reading-order
note and every scattered `item N` cross-reference renumbered in the same PR (dozens of individual
fixes, verified via `grep -n "item [0-9]"` sweeps) since removing a mid-list item shifts every
item after it. `docs/module-map.md` gained a row for `lib/health/recovery-band.ts`. Version bumped
1.133.0 → 1.134.0 with a `lib/changelog.ts` entry.

## Session 277 — Instant tab navigation & fast app open, all three chunks (`perf/instant-nav-app-open`)

Backlog-driven implementer pass, working queue item 3 (instant tab navigation & fast app open,
owner-requested 2026-07-11), review `docs/reviews/2026-07-11-offline-feel-performance-review.md`,
plan `docs/superpowers/plans/2026-07-11-instant-nav-and-app-open.md`. Ships all three chunks
(A/B/C, 10 tasks) in one pass and removes the item from the backlog.

**Chunk A — instant nav.** `next.config.ts`'s `experimental.staleTimes: { dynamic: 300, static: 300 }`
keeps visited/prefetched tab RSC payloads in the client router cache for 5 minutes (Next 15's
default `dynamic: 0` discarded them immediately, so every bottom-nav tap refetched from Railway —
the ~1s navigation delay). New shared `components/shell/tab-loading.tsx` (`TabLoading`) backs
`loading.tsx` boundaries on all five tab routes; `app/page.tsx` moved into an `app/(home)/` route
group so its boundary doesn't leak to `/sign-in`/`/admin`. `/more` no longer runs a Postgres query
per navigation (`getRepository`/`getUserByEmail` removed from `app/more/page.tsx`) —
`equippedTitle` now derives client-side from the existing `more-user-profile` cache/fetch path in
`more-content.tsx`, the same tradeoff every other tab already makes. **Empirically verified** (Task
5) via a Playwright script driving real `<Link>` clicks against `pnpm dev` (the plan's
authoritative `pnpm build && pnpm start` check was not possible — `next start` forces
`NODE_ENV=production`, which the DB client statically requires SSL the local dev Postgres doesn't
support, a documented CLAUDE.md gotcha): first-visit tab taps each issued exactly one `?_rsc=`
fetch; **revisits within the 5-minute window issued zero.**

**Chunk B — More-tab pull-to-sync fixes.** `handlePullSync` no longer calls `invalidateCache('')`
(the app-wide cache nuke that wiped every screen's instant-paint seed on every pull — the last
surviving instance of that pattern) — it now invalidates only the domains the pull actually
changed, mirroring `sync-provider.tsx`'s existing domain-flag group invalidation exactly. The
frozen Oura Cloud POST is now gated on BLE freshness (`isBleDataFresh`/`/api/oura-ble/freshness`),
same as `sync-provider.tsx`'s `maybeSyncOura` — the ring itself is still drained by the shared
`PullToSync` component regardless. `ConfigScreen`'s dynamic import gained a skeleton `loading:`
fallback instead of rendering nothing during chunk load.

**Chunk C — fast app open.** `public/sw-template.js`'s final pages handler is now
stale-while-revalidate for top-level navigations (serves the cached document instantly, refreshes
in the background) instead of network-first — app open no longer blocks on a full round-trip to
Railway even with a warm cache. Auth pages (`/sign-in`, `/pending`, `/register`) stay network-first;
the offline-fallback chain from the v1.130.0 offline-shell rework is preserved. Verified via
Playwright with a persistent browser context (required for SW/CacheStorage to survive across
script invocations): SW registers and activates, `/offline` is precached, a reload is served
`fromServiceWorker: true`, and a killed-server + `context.setOffline(true)` navigation still opens
the page. `sync-provider.tsx`'s Phase 3 cache-warm fan-out (~20 fetches) is now deferred 2.5s so
the visible tab's own fetches win the network on cold start. `@capacitor/splash-screen@^8` added +
configured in `capacitor.config.ts` (5s auto-hide safety) + hidden on mount in
`capacitor-native-init.tsx` — **native half compile-gated only** (no Android SDK in-sandbox; needs
an owner APK rebuild to take effect), confirmed the plugin doesn't break the web build.

**Console-error triage:** the final Playwright sweep (all five tabs, repeated tab-taps, pull-to-
sync, reload) surfaced 24 console entries — a WeekStrip "today" hydration mismatch and a batch of
401s on cold-load API calls. **Verified pre-existing, not a regression**: the identical error set
(same hydration diff, same 401 set, same `/api/oura/sync` 400) reproduces on a clean `origin/main`
checkout in a separate git worktree, confirming this PR introduces no new console errors.

`pnpm lint`/`tsc --noEmit`/`pnpm test` (1139 passed)/`pnpm build` all green. Version bumped
1.132.0 → 1.133.0 (minor — user-visible navigation/startup behaviour) with a changelog entry.
Backlog item removed in full; downstream items 4-21 renumbered to 3-20 throughout
`docs/implementation-backlog.md` (reading-order note rewritten, ~20 cross-references fixed).
Added a device-smoke-checklist.md section (§8) for the on-device checks this plan's own Task 11
calls for. **Not exercised — everything on-device:** real `?_rsc=` behaviour in the S25 WebView
(only `pnpm dev` + Playwright verified), the splash screen (compile-gated only), real cold-open
timing, and the BLE-freshness gate's fresh-data branch (no BLE rows on the local dev DB, so
`handlePullSync` always fell through to the Cloud-sync branch in testing).

## Session 276 — Oura BLE Phase 5 own-scores addendum: personal baselines + readiness reweight (`feat/oura-ble-phase5-baselines`)

Backlog-driven implementer pass, working queue item 4 (Oura BLE Phase 5 — own readiness/sleep/
activity scores, at the time this session started; renumbered from 3 after session 275's
instant-nav planning PR inserted ahead of it), plan
`docs/superpowers/plans/2026-07-08-oura-ble-phase-5-own-scores.md`'s "Addendum (2026-07-09)"
section (A1–A4) — the last remaining piece of that item after four earlier sessions (244/246/267)
shipped Chunks 1–5. Ships the addendum in full and removes the item from the backlog.

**A3 — migration 116 `oura_daily_summary` + rolling personal baselines.** New table
(`lib/data/postgres/migrations/116_oura_daily_summary_baselines.sql`): one row per bedtime night
holding that night's raw signals (sleep duration/efficiency/stages, HRV, resting HR, recovery
index, nightly temperature, MET) plus five trailing personal baselines (HRV/RHR/temp/sleep/MET)
carried forward as ecore-style asymmetric-EMA state. `lib/health/personal-baseline.ts` ports
open_oura's `baseline_update_lt_mean_and_dev` (`ported/baseline.rs`) faithfully — **fetched the
actual pinned Rust source via `curl` from `Th0rgal/open_oura`** rather than guessing constants
from memory (per the external-field-verification rule), including its own unit test
(`warm_up_then_settle`) ported verbatim. `lib/health/temperature-baseline.ts` ports
`nightly_temperature_calculate` (`ported/temperature.rs`, 7-sample sliding median → 30-sample
windows, min-of-maxima with a range gate) the same way, pinned test vectors included. Wired into
the rollup: `lib/health/daily-summary.ts`'s `computeDailySummaries` is a pure function replaying
each metric's baseline forward night-by-night (age = nights of history accrued *before* tonight,
matching ecore's semantics) — `lib/data/postgres/adapter.ts`'s `aggregateOuraRawSamples` now
collects per-night temperature samples (0x46/0x69 chronologically merged with 0x75) and recovery-
index HR bins, plus calendar-day MET averages (0x50, newly queried), and does a full delete-then-
reinsert of `oura_daily_summary` per rollup pass — consistent with the file's existing derive-
don't-drift pattern for sleep/HR-series, and necessary since the EMA state is inherently
sequential. New DB-backed test (`oura-ble-daily-summary.test.ts`) seeds two synthetic nights and
verifies `n_history` accrual, a real temperature deviation forming from night 2, and idempotency
on re-run.

**A2 — Recovery Index wired in; A4 — baseline-relative readiness reweight.** New
`lib/health/readiness-composite.ts` (`computeReadinessComposite`) implements the recovered
open_health weights (RHR 17%, Previous Night 15%, HRV Balance 15%, Temperature 13%, Sleep Balance
12%, Prev-Day Activity 10%, Recovery Index 10%, Activity Balance 7%). Baseline-relative
contributors (RHR/HRV/Temperature/Sleep Balance) read a z-score computed from the *prior* night's
baseline state against tonight's raw value (mirroring how `tempDevC` already works) and fall back
to neutral+`provisional:true` before 14 nights of history — no fabricated precision. Recovery
Index has no calibratable hours→score mapping per the addendum, so it's always neutral/
provisional; its raw hours are surfaced separately for display only, never scored. Wired into
`app/api/readiness-score/route.ts`: when Oura Cloud's own score isn't available (the frozen-
since-re-key path) and at least one `oura_daily_summary` row exists, this composite replaces the
old crude sleep(40)+hrv(30)+rhr(20)+load(10) formula for `score`/`readinessDisplayScore`; the old
components are kept for the ACWR/early-deload logic that still depends on them. New response
fields (`ownReadinessContributors`, `recoveryIndexHours`, `baselineNights`) — `ReadinessScoreResponse`
callers (`health-score-detail.tsx`'s optimistic local-store fallback) updated to match. Verified
end-to-end against the local dev DB: seeded two nights' `oura_daily_summary` rows (16 nights of
accrued history) for the test user, logged in via `pnpm dev`, and confirmed the API returns the
correctly-weighted composite (60, matching a hand-computed sum of the seeded contributor scores)
instead of the old crude formula's 85 — provisional flags correctly gate the contributors with no
real signal (prev-day activity, activity balance, recovery index).

`pnpm lint`/`tsc --noEmit`/`pnpm build` all green; `pnpm test` 1139 passed (0 new warnings, one
pre-existing DB-test flake under heavy parallel local-Postgres load reproduced identically with
this session's changes stashed out — confirmed unrelated, not investigated further). Version
bumped 1.131.0 → 1.132.0 (minor — user-visible readiness-score behaviour change) with a
changelog entry. Backlog item (Oura BLE Phase 5) removed in full; rebased once against session
275's instant-nav planning PR landing mid-session (redid the item removal + renumbering against
its inserted item 3, downstream items renumbered 5–22 → 4–21 throughout the file — reading-order
note rewritten, ~20 scattered cross-references fixed).

## Session 275 — Offline-feel / perceived-latency review + implementation plan → backlog item 3 (docs-only, `claude/offline-app-performance-kit6ym`)

Owner-requested review: with the offline local DB, the app was expected to feel native —
instant tab loads, instant data, instant tile updates — but instead app open takes seconds,
widgets lag, and tab navigation has a ~1 s delay. The ask: audit the screens, explain why it's
laggy, confirm whether the queued backlog items suffice, and write it up as a doc; the owner
then asked for the implementation plan and the queue slot in the same session. Ran three
parallel code sweeps (tab-navigation path, cold-start/resume path, per-screen instant-paint +
write→tile), hand re-verified the load-bearing findings, and reconciled everything against the
queued backlog.

**Verdict (the review's headline): the queue was necessary but not sufficient.** The data-layer
gaps are correctly owned (all re-verified), but the two *dominant* latency sources were
unowned. (1) **Every bottom-nav tap performs a network RSC round-trip to Railway** before the
new screen can mount: all five tab routes are dynamic `await auth()` server components, no
`experimental.staleTimes` override means Next 15's default `staleTimes.dynamic=0` discards the
`prefetch={true}` payloads immediately, the SW handles navigations network-first, and zero
`loading.tsx` files exist so the old screen freezes for the entire round-trip (the ~1 s).
`/more` additionally runs a real Postgres query (`getUserByEmail`) per navigation. The
session-252 view-transition removal was confirmed shipped — the residual is pure network.
(2) **Every app open blocks on a network-first document fetch** even with a warm SW cache —
verified still true of the v1.130.0 offline-shell rework that landed mid-session (it fixes
*offline* availability; online loads stay network-first). Plus: no splash-screen plugin (blank
void during load) and a ~35-40-request startup stampede. **New findings:** NEW-1 (high) —
More-tab pull-to-sync calls `invalidateCache('')` (`app/more/more-content.tsx:93`), the empty
prefix wiping every cache key + mirror app-wide, so one pull reverts every screen to skeletons
(health-content lost this pattern 2026-07-03, home went targeted in v1.130.1 — More is the last
instance); NEW-2 — the same handler fires the frozen Oura Cloud sync with no BLE-freshness
gate; NEW-3 — `ConfigScreen` dynamic-imports with no loading fallback.

**Deliverables:** (1) `docs/reviews/2026-07-11-offline-feel-performance-review.md` — full
causal chains for tap→paint and cold-start, a symptom→owner coverage map, four fix packages
(P1 instant tab nav / P2 fast app open / P3 More-tab fixes / P4 = the unqueued bundle-shell
Track A endgame). (2) `docs/superpowers/plans/2026-07-11-instant-nav-and-app-open.md` — three
independently-landable chunks: A (`staleTimes` router-cache retention with an empirical
verification gate before anything builds on it, shared `TabLoading` + five `loading.tsx`
boundaries with home moved into an `(home)` route group so the boundary doesn't leak to
`/sign-in`, `/more`'s Postgres query replaced by its existing client profile path), B (More
pull-to-sync → sync-provider's domain-flag invalidation + the BLE-freshness gate + a
ConfigScreen skeleton), C (SW document stale-while-revalidate written against the v1.130.0
template preserving its precache/retention/offline chain, a 2.5 s warm-fetch stagger,
`@capacitor/splash-screen` with a 5 s auto-hide hang guard — needs an owner APK rebuild) —
**queued as backlog item 3**, branch `perf/instant-nav-app-open`; items 3–21 renumbered +1
with every cross-reference swept (including several found already internally stale on `main`
from the two parallel session-271/273 renumbers — fixed rather than propagated).

**Process note:** while this session's docs were in flight, PRs #429–#432 landed on `main`
(offline shell v1.130.0, home-freshness chunks 1+2 v1.130.1, walk-detection plan + chunks
v1.131.0) and two sibling sessions claimed numbers 271–274. This branch was merged onto the
new `main` and every stale claim reconciled: the review carries a same-day reconciliation
block (START-4 marked shipped, home rows marked shipped, SW findings re-verified against the
landed template), the plan's SW task was rewritten against the v1.130.0 template (the original
coordinate-with-item-2 constraint resolved itself), and this session renumbered 271→275.
Docs-only, no version bump. **Not exercised:** static review only — no on-device/browser
timing was performed; the `staleTimes` router-cache semantics are inferred from Next 15 docs
and the plan's Task 5 verifies them empirically (dev + prod build) before Chunk A lands.

## Session 274 — Ring-triggered walk detection + GPS battery hardening, Chunks 1+2 (`feat/ring-triggered-walk-detection`)

Backlog-driven implementer pass, working queue item 1 (owner-reported 2026-07-11: battery drain
+ dead walk/run auto-detection), plan
`docs/superpowers/plans/2026-07-11-ring-triggered-walk-detection-gps-battery.md`. Chunk 3 (native
always-on pipeline) is explicitly deferred per the plan's own instruction — did not start it.

**Chunk 1 — GPS watchdog: off-switches that don't need live timers.** The passive-detection GPS
watcher's stall timer and probe-timeout gate both run in WebView `setInterval`/`setTimeout`,
which Android throttles or suspends with the screen off while the GPS foreground service keeps
running natively — a diagnosed root cause of the reported battery drain. Added
`lib/activity/gps-watchdog.ts`, a pure `evaluateWatchdog(input)` function (absolute watcher cap
`WATCHER_MAX_MS`, hard probe-timeout cap `PROBE_HARD_MAX_MS`, data-driven stall gap
`STALL_GAP_MS`), unit-tested (6 tests) against the plan's own given test cases. Wired into
`lib/activity/auto-detection-service.ts` via `runWatchdog(now)`, called from every occasion code
is provably known to run regardless of timer throttling: each GPS point (`onPoint`, evaluated
with the *previous* `lastPointMs` so a stale gap finalizes the old session before the new point
contaminates it), each gate tick, and app `resume` (`@capacitor/app`'s `resumeHandle` listener,
now mounted unconditionally in both gated/ungated modes rather than only inside the
motion-detection-available branch). `lib/stores/auto-detection-store.ts`'s `onRehydrateStorage`
now finalizes (via `endSession()`'s own quality gates) rather than silently drops a persisted
in-flight session whose last point is >3 min stale — the app-death-mid-walk case; a fresh
in-flight session (e.g. a mid-walk deploy reload) is left in place so tracking resumes seamlessly.
The pre-existing test asserting the old (buggy) drop-on-rehydrate behaviour was rewritten, not
deleted — confirmed it failed first (`expected null to be 1000`) before fixing it, added the two
plan-specified new cases. Task 1.4 added observability: a non-persisted `detectionDiag` store
field (`gateState`, `gpsSinceMs`, `lastPointMs`, `trigger`) published by a `publishDiag()` helper
from every gate transition, watchdog action, and GPS start/stop, rendered as one muted line on
the Profile screen's `BackgroundLocationCard` (`Detection: tracking · GPS on 12m · last fix 8s
ago · trigger: ring`) — text-only, no new UI primitives — so the battery-drain/orphaned-watcher
hypotheses are confirmable without adb.

**Chunk 2 — the ring's walk-specific gate window becomes the GPS trigger.** The second reported
symptom (walk/run auto-detection dead) traced to both existing "Walk detected" sources being
broken: the Oura-Cloud detected-workouts feed froze at the 2026-07-07 re-key (retired from Home
in session 273), and the phone-GPS-only path rarely finalizes a background session. The ring's
own paired `0x7e`/`0x7f` step-gate windows (already decoded for step counting) are walk-specific
and a strictly better trigger than the phone's any-motion significant-motion sensor. Extracted
the gate-frame buffering/pairing/dedup pipeline verbatim out of `lib/oura-ble/step-orchestrator.ts`
into a new shared `lib/oura-ble/gate-feed.ts` (`subscribeGateFeed`, first-subscriber-attaches /
last-unsubscribe-detaches plugin listeners) so the step orchestrator and passive activity
detection don't each run their own pipeline off the same plugin frame listeners — the
orchestrator now keeps only its own accel-frame (`ACCEL_FRAME_TAG`) listener for step counting
and consumes gate windows/disconnect via the shared feed; its pure core
(`step-orchestrator-core.ts`) and 15 existing tests are untouched. New
`lib/oura-ble/__tests__/gate-feed.test.ts` (5 tests, real synthetic `0x7e`/`0x7f` hex fixtures
matching the existing step-features test style): pairing emits once, out-of-order re-delivery of
the same ds is deduped, non-gate tags are ignored, disconnect/live status mapping. Wired
`subscribeGateFeed` into `auto-detection-service.ts` (gated branch only): a live paired window
proves the ring path is live and disarms the phone sensor (`triggerSource: 'ring'`), a walking
window dispatches `motionTrigger` directly (repeated windows during probing/tracking are no-ops —
the reducer only accepts the event when idle), a ring disconnect falls back to re-arming the
sensor. Deliberately, non-walking windows do NOT end a session — GPS itself (stall + motorised +
the Chunk-1 watchdog) still owns ending, so a standing pause at a traffic light can't kill an
in-progress walk; a ring-idle early stop is a possible future battery lever, left YAGNI'd. The
gate's `armMotion` command now no-ops while the ring is the live trigger. Web / plugin-absent /
old-APK builds are unaffected: `subscribeGateFeed` resolves with no listeners attached when
`getOuraBle()` returns null, so nothing changes on those platforms.

`pnpm lint`/`tsc --noEmit`/`pnpm test` (1117 passing, 0 new warnings)/`pnpm build` all green.
**Not exercised — everything requiring a live ring or on-device GPS/battery behaviour:** the
plan's stated on-device soak (walk with the ring open/recently-open, confirm the Profile diag row
shows `trigger: ring`, GPS turns on within ~60s of walking and shuts off reliably afterward) is
still owner-run; a pocket walk with the app fully killed is explicitly NOT expected to work yet —
that gap is Chunk 3 (native, deferred, own go/no-go after this soaks on-device). Version bumped
1.130.1 → 1.131.0 (minor — user-visible detection-behaviour change) with a changelog entry.

## Session 273 — Home page freshness & caching, Chunks 1+2 (`perf/home-freshness-caching`)

Backlog-driven implementer pass, working queue item 7 (home page freshness/caching/performance,
`docs/superpowers/plans/2026-07-10-home-page-freshness-and-performance.md`) — items 1-5's
remainders were all native/deferred, owner-blocked, or sized for their own pass. This plan's own
self-review explicitly sanctions a partial landing: "Task 1 and Task 2 are the
perceived-freshness wins and can ship alone if a session runs short" — took that option, landing
Chunks 1+2 of 5 and leaving Chunks 3-5 (local-first reads, render hygiene, UI polish) for a
future pass. Re-verified every referenced file/line against current `main` first; all matched
the plan's assumptions closely (line numbers drifted slightly, logic identical).

**Chunk 1 — retire dead Cloud syncs on home; Refresh drains the ring.** `handlePullSync` no
longer POSTs `/api/oura/sync` (the Oura Cloud has been frozen since the 2026-07-07 re-key) —
`PullToSync` already drains the ring in parallel, so the old call was ~15 wasted round-trips per
pull that could never return new data; deleted the dead `toast.error('Oura sync failed')` with
it. The header Refresh button now calls `syncOuraRing()` (a BLE drain) instead of firing the same
dead Cloud POST — previously Refresh could never surface new Oura data at all.
`exercise-detected-card.tsx`'s rogue Cloud-sync-on-mount (5-min self-throttle + a bare `fetch`)
was deleted entirely; its GET now goes through `cachedFetch('oura-unreviewed-workouts', …,
TTL_MEDIUM)`, registered in `invalidateOuraSync()` and busted from `exercise-review-sheet.tsx`'s
save/dismiss handlers so a reviewed session doesn't reappear. `lib/oura-ble/sync.ts`'s
`syncOuraRing()` now polls the plugin status after kicking a drain — **verify-first finding**:
the plan assumed `status.state === 'draining'`, but `OuraBleStatus`'s `state` enum has no
`'draining'` value at all; the real (optional, native-ingest-build-only) field is
`draining?: boolean` — used that instead, with the existing bounded-timeout fallback for
older/web builds where the field is absent. Once settled, `invalidateOuraSync()` fires and a new
`ta:oura-ble-synced` window event lets `session-select-content.tsx` bump `refreshTick` (the
existing mechanism for re-triggering readiness/body-battery/training-load/oura-hr-day). The
`oura-ble-debug.tsx` tester's Redecode also now invalidates on completion (success or the
slow-response fallback path).

**Chunk 2 — cache correctness.** Extracted `clearLegacyHomeSeeds()` (the sessionStorage removal
of `ta_recommendation_v1`/`ta_meta_v1`) into `lib/cache-groups.ts` and call it from **both**
`invalidateWorkoutSummaries()` (already had it inline) and `invalidateProgramStructure()` (never
had it) — a Config save previously left home re-painting the pre-edit session
list/recommendation on next mount. Fixed the dead optimistic "trained today" stamp in
`completeWorkout()`: it was reading-then-writing the calendar/streak caches with `updateCache`
*after* `invalidateWorkoutSummaries()` had already cleared those same keys, so the stamp was a
guaranteed no-op — the streak/week-strip never showed "trained today" until the network refetch
landed. Reordered to read the cached payloads first, await the invalidation, then `setCached` the
stamped values back in. Added SWR `Cache-Control` headers to the two home GET routes that lacked
them (`/api/mood`, `/api/admin/pending-count`) and a deliberate-`no-store` comment on
`/api/body-metadata`; replaced two `5 * 60` TTL literals in `mood-checkin-sheet.tsx` with the
canonical `TTL_SHORT`. Dropped home's redundant `calendar-data:<month>` fetch from
`fetchWorkoutData` — `streak-data`'s 90-day window is a strict superset of what home reads
(`activityDays` was never consumed here); the calendar screen's own fetch of that key is
untouched. Corrected `CLAUDE.md`'s stale-hazard list: `ta_streak_v1`/`ta_calendar_v2_*` are
verified dead in source (no remaining seed sites) and were dropped; the two live legacy keys now
note they're cleared via the shared helper.

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full suite green (1104 passed, 2 new tests —
a jsdom-environment `cache-groups-legacy-seeds.test.ts` covering both invalidation groups);
`pnpm build` succeeds; the repo's own Custom Rules greps (timezone, safe-area) run clean
locally. Playwright network-panel checks against `pnpm dev` (signed in as the seeded test user):
confirmed zero `/api/oura/sync` calls fire from home mount + the header Refresh button (the one
`/api/oura/sync` POST observed came from `SyncProvider`'s own pre-existing, separately-gated
app-open sync — expected, unrelated to this plan, and returns 400 for a non-Oura-connected test
user as before); confirmed zero `/api/calendar-data` requests fire from home load, with
`/api/streak-data` still firing as the sole source. **Not exercised:** the workout-completion
optimistic-stamp fix (Step 2.2) via a full end-to-end workout completion — verified by code
trace only, matching the plan's own suggested DevTools-network-throttle method was not run live
this session. The actual BLE drain paths (Chunk 1's `syncOuraRing`/`afterDrainSettles`) are
no-ops off-device per the plan's own scope — code-read only, no ring in this sandbox.

Version bump 1.130.0 → 1.130.1 (patch) + changelog entry + `docs/module-map.md` gained the
`clearLegacyHomeSeeds()` cross-reference and a new `ta:oura-ble-synced` event row. Backlog item 7
annotated with Chunks 1+2 shipped; Chunks 3-5 (local-first reads, render hygiene/orchestrator
slimming, UI tokens/a11y/touch-targets) remain, explicitly sized for their own pass per the
plan's own chunking.

## Session 272 — Planning: ring-triggered walk detection + GPS battery hardening → backlog item 1 (docs-only, no version bump) (`claude/activity-tracking-battery-nc94z5`)

Owner report: step accuracy is now excellent (±5% vs a Garmin companion over a 12.5k-step day —
12,500 vs 12,900), but the phone is chewing battery ("I'm assuming our activity tracking is
causing this"), auto walk/run tracking "hasn't been working since the latest fix", and the stated
end goal is: *ring records movement → triggers GPS tracking → enough data confirms a walk → walk
ends → GPS sleeps → walk presented to the user*. Planning session — investigated, wrote the plan,
queued it; no implementation.

**Diagnosis (battery).** The passive-detection GPS pipeline's only off-switches run in throttled
WebView JS: `auto-detection-service.ts` enforces the 3-min probe timeout via a 30-s `setInterval`
and session end via a 3-min `setTimeout`, while the `@capacitor-community/background-geolocation`
watcher is a **native foreground service** that keeps GPS hot regardless of whether those timers
ever fire. With the screen off, Android throttles/suspends WebView timers → one significant-motion
fire can leave high-accuracy GPS running for hours, and nothing anywhere caps watcher lifetime.
Two aggravators: (1) this only became *reachable* when the v1.80.1 permission card got the owner
to grant "Allow all the time" — before the grant every background GPS start failed, which
accidentally protected the battery (the drain starting "after the latest fix" is consistent with
exactly this); (2) the phone's significant-motion sensor fires on any movement (pocket jostle,
car), so even a working probe costs ~3 min of GPS many times a day. A second hypothesis needing
on-device confirmation: deploy-driven page reloads (remote-URL WebView) during probing/tracking
lose the JS `watcher` handle without `removeWatcher` — a potentially unbounded orphaned-GPS leak.
The visible symptom for both: a persistent "TrainingAI — Tracking your activity" notification
while not walking. The BLE side (live-accel bursts 20-min-capped + 5-min cooldown, hourly drains)
is bounded by design and not the fix target.

**Diagnosis (detection dead).** Both sources of the "Walk detected" card are gone: Oura-Cloud
detected workouts froze at the 2026-07-07 re-key (`exercise-detected-card.tsx` still polls
`/api/oura/workouts` + fires a throttled dead `/api/oura/sync` — retirement owned by the
home-freshness plan), and the phone-GPS path rarely finalizes in the background — `endSession()`
hangs off the same throttled timers, and a session that never finalizes is never presented; on
relaunch the persisted in-flight session just lingered (only `isDetecting` was reset on
rehydrate). Pre-re-key, the Oura Cloud source is what actually surfaced most walks — which is why
detection "worked" until recently.

**Plan** (`docs/superpowers/plans/2026-07-11-ring-triggered-walk-detection-gps-battery.md`,
branch `feat/ring-triggered-walk-detection`, queued as **backlog item 1**):
- **Chunk 1 (JS)** — a pure `evaluateWatchdog` (`lib/activity/gps-watchdog.ts`) evaluated at
  moments code provably runs (every GPS point — the FGS delivers those screen-off — every gate
  tick, every ring gate window, app resume): absolute 3.5-h watcher cap, hard probe cap
  (`PROBE_TIMEOUT_MS` + 60 s grace), data-driven stall; plus finalize-not-drop for sessions
  interrupted by app death (stale persisted session → `endSession()` on rehydrate, so the walk
  still gets presented) and a Profile diagnostics row (gate state / GPS age / last fix / trigger
  source) so the wedge/orphan hypotheses are confirmable without adb.
- **Chunk 2 (JS)** — extract the paired `0x7e/0x7f` gate-window pipeline out of
  `step-orchestrator.ts` into a shared `lib/oura-ble/gate-feed.ts` (single pairing pipeline, two
  consumers); the ring's walk-specific col14 gate becomes the GPS trigger
  (`motionTrigger` on a walking window), with the any-motion phone sensor demoted to fallback
  when the ring is disconnected. GPS itself keeps owning session end (stall/motorised/watchdog) —
  a traffic-light pause must not kill a walk.
- **Chunk 3 (native, deferred, own go/no-go after Chunk 2 soaks)** — move the loop into
  `OuraRingService`: shares the Kotlin unpack27/col14 gate port with the step plan's Chunk C
  (implement once), FusedLocation from the already-running FGS (sidesteps the Android 12+
  background-FGS-start question and removes the JS watcher + its orphan risk), native session
  semantics with a JVM parity test pinning the TS thresholds, server-side `detected_activities`
  pending sessions (migration pencilled 120) so review state survives WebView death/reinstalls.

**Backlog:** inserted as item 1 (owner's live daily pain on both fronts; Chunks 1–2 in-sandbox
buildable); step-orchestration drops to 2 (its only remaining chunk is native-deferred, gated on
the owner's Chunk B soak), later items renumbered +1 and every intra-file cross-ref reconciled
(~20 "item N" references). Caught and fixed one pre-existing stale cross-ref unrelated to this
insertion: the accurate-sleep-staging item's "the heuristic-tuning arc (item 17) stalled" pointed
at the step-counter item — the calibration/tuning-guide item is the real referent, now correctly
numbered. `projectOverview.md`: new content appended to the existing GPS Known-Issues section
(rather than a duplicate row), the frozen-health-screens row updated for the v1.128.1 cutover
(shipped session 268 but never reflected there), the GPS device-only checklist line pointed at
the new plan, and the What's-Left next-migration line corrected 115 → 120 (119 on disk; 116/118
claimed by Phase-5/R4 plans — same drift class as the two prior corrections).

**Rebase note:** this PR was opened first against an older `main`, then two other implementation
PRs landed while it was open — UB5+UB6 (v1.129.1, session 270) and the offline-shell availability
fix (v1.130.0, session 271), both of which touched `docs/implementation-backlog.md`'s numbering.
Rather than a mechanical `git rebase` (the Queue section's numbering changed on both sides,
guaranteeing conflict markers through most of the file), the backlog/overview edits were
hand-reconciled against the fresh `main` state: the two already-shipped items' rows were left
exactly as their own PRs wrote them, and only this session's insertion was reapplied on top.

**Verification:** docs-only — nothing exercised at runtime; the diagnosis is from code reading
(`auto-detection-service.ts`, `motion-gate.ts`, `gps-tracking.ts`, `exercise-detected-card.tsx`,
`step-orchestrator.ts`, `MainActivity.java`) plus the session-179 investigation record and the
changelog timeline (v1.74.3 motion gate, v1.80.1 permission card). The wedge and orphan
hypotheses are explicitly ranked-not-proven in the plan; Chunk 1's diagnostics row + the owner's
battery-settings check are the designed confirmation path.

## Session 271 — Offline shell availability, all four chunks (`fix/offline-shell-availability`)

Backlog-driven implementer pass, working queue item 2 (offline shell availability,
`docs/superpowers/plans/2026-07-11-offline-shell-availability.md`) — the owner-reported outage
where the app was fully unusable with no reception. Item 1's remainder (step-orchestration Chunk
C) is native/deferred, so this was the next ready item per the queue's own reading-order note.
Discovered mid-session that Playwright is actually available in this sandbox — globally installed
(`npm -g`, v1.56.1) alongside the pre-installed Chromium — which the CLAUDE.md environment notes
don't call out explicitly; this let the plan's Task 6 in-sandbox behavioural gate run for real,
not just be skipped as "not exercised."

**Chunk 1 — service worker rework.** New `lib/sw/manifest.ts` (pure, unit-tested):
`listStaticAssets`/`buildPrecacheList` walk `.next/static` into a precache URL list,
`renderServiceWorker` injects the cache name + manifest into the template. `app/sw.js/route.ts`
now computes and injects the manifest (memoized per build id). `public/sw-template.js` rewritten:
install precaches the full static set + `/offline` (`allSettled`, one bad asset can't fail
install), activate retains the current **and** immediately-previous cache generation via a
persistent `ta-meta` "prev" pointer instead of wiping everything, `res.ok`-guarded `cache.put`
throughout, and the fetch handler's navigation branch falls back to the exact cached document,
then the precached `/offline` page, instead of a raw Chromium error. New `app/offline/page.tsx` +
`offline-actions.tsx` (static, unauthenticated, logic-free by design). `middleware.ts` gained
`/offline` to `PUBLIC_PATHS` so an unauthenticated precache-time fetch can't get redirect-poisoned
into caching `/sign-in` as the fallback.

**Chunk 2 — offline-aware shell.** New `lib/use-online-status.ts` (DOM events + Capacitor
Network) and `components/shell/offline-indicator.tsx` (the "Offline — showing saved data" pill,
mounted in `app/layout.tsx`). `app/error.tsx` and `app/workout/error.tsx` now detect
`navigator.onLine` and render a distinct "You're offline" state that keeps `<BottomNav />` (the
boundary previously dead-ended with no way out) and auto-`reset()`s when connectivity returns.

**Chunk 3 — data-layer polish.** `lib/cache-ttl.ts` gained `OFFLINE_SEED_TTL_FLOOR` (7 days) +
`floorSeedTtl()` (unit-tested), replacing the hardcoded 24h floor in `lib/sqlite/cache.ts`'s
localStorage seed write — a fully-offline device now keeps painting last-known data for a week
instead of one day. The plan's D1 (today-guarded stale-read labelling across midnight) stayed
explicitly deferred pending owner sign-off, per the plan.

**Chunk 4 — observability.** New `components/more/sw-status-row.tsx` (controller state, cache
generation count, precache file count) mounted in More → About. New §2b in
`docs/device-smoke-checklist.md` — the airplane-mode sweep, which remains the plan's real merge
gate.

**Genuine offline verification (not `context.setOffline`).** `context.setOffline` only fires DOM
online/offline events — it does not block service-worker fetches, so it can't prove the fallback
chain works. Instead: launched a Playwright `launchPersistentContext` (required — a plain
`chromium.launch()` gets a fresh ephemeral profile each run, so the SW registration and Cache
Storage don't survive between the "browse online" and "go offline" phases), signed in via cookies
extracted from a curl login (first attempt was silently unauthenticated — curl's Netscape
cookie-jar format prefixes httpOnly cookies with `#HttpOnly_`, and a naive `startsWith('#')`
comment filter was stripping every real cookie line, not just comments), browsed five tabs online
to populate the cache, then **killed the dev server process entirely** and re-launched a browser
against the same profile. Results matched the plan's expected before/after exactly: a
previously-visited route (`/workout`) rendered its real cached content ("Choose a session to
start…"), a never-visited route (`/year-review`) correctly served the precached `/offline` page,
and cold start at `/` rendered Home directly ("Good afternoon, Test User…"). The offline pill
showed/cleared correctly via `setOffline`. One plan-vs-code discrepancy found: the plan's prose
said the `/offline` fallback shows "with the bottom nav," but Task 4's actual given code is a
standalone page with no `<BottomNav>` — the nav-preserving behaviour belongs to Task 9's error
*boundary* (a different trigger: a thrown render error, not an SW navigation fallback). Implemented
exactly as the plan's code specified; noted the prose imprecision rather than silently adding a
nav that wasn't in the spec.

**Verification gaps.** The plan's Task 6 called for `next build && next start`; `next start`
forces `NODE_ENV=production`, which `lib/data/postgres/client.ts` statically resolves to
`ssl: true` at build-bake time (the ternary gets inlined by Next's compiler), and the local dev
Postgres doesn't support SSL — so no authenticated route could load under a true production
server in this sandbox. Verification ran on `next dev` instead (identical SW/cache logic; only the
precache *count* differs from a real build). The real production build's `sw.js` output was
independently confirmed during Chunk 1 (393 precached assets, `node --check` valid JS) before this
constraint was hit. **On-device Samsung WebView airplane-mode behaviour — the plan's own stated
merge gate — is genuinely unverified**: no physical device in this sandbox.

`pnpm lint`/`tsc --noEmit` clean; full test suite green (1102 passed, 7 new tests — 4 manifest +
3 cache-ttl); `pnpm build` succeeds. Version bump 1.129.1 → 1.130.0 (minor — new user-visible
offline capability) + changelog entry. Backlog item 2 removed from the queue (fully shipped, no
code remainder — only the owner-run on-device smoke is outstanding); items 3+ renumbered down by
one throughout the doc, including every cross-reference and the reading-order header.

## Session 270 — Live-HR UX rework + HR-graph smoothing, UB5+UB6 (`feat/live-hr-ux-rework`)

Backlog-driven implementer pass, working queue item 5 (renumbered to item 6 by a concurrent
session's offline-shell-fix insertion that landed while this was in flight — see the rebase note
below). Items 1–4's remainders were all either native/deferred, owner-blocked, or explicitly sized
for their own pass (item 4's Chunk 4 shipped last session); item 5/UB5+UB6 (fully written out in
`docs/superpowers/plans/2026-07-10-ub5-6-live-hr-ux-and-smoothing.md`, not yet started) was the
next self-contained, dev-server-verifiable item. Re-verified the plan's referenced files against
current `main` first — `use-live-hr.ts`, `live-hr-readout.tsx`, `recovery-index.ts`'s private
`rollingMedian`, `hr-day-chart.tsx`'s `toBuckets`, `hr-recovery-chart.tsx`'s raw map, and the
`oura-section.tsx` mount point all matched the plan's line-numbered assumptions exactly — no
reconciliation needed, implemented as written.

**Chunk 1 (workout HR readout, UB5).** `use-live-hr.ts` no longer discards `bpm` the instant a
sample crosses the 8s staleness window — it now holds the last-seen value and exposes a `stale`
flag, so the workout rest-phase readout stops flickering to `—` on every normal ring gap.
`live-hr-readout.tsx` stripped to a minimal, non-interactive chip (deleted the Measure button,
diagnostics toggle, and `DiagnosticsPanel` — no `<button>` remains, so no tap-target/nested-control
concerns) that holds the last bpm and dims it while stale.

**Chunk 2 (Measure-now relocation, UB5).** New `components/health/measure-hr-now.tsx` — a one-shot
"see my HR right now" leaf that starts the live-HR manager on demand (guarded by
`activeSourceId()` so it never tears down a session it didn't start), fires a burst, shows the
reading, and releases the ring after 30s. Mounted unconditionally in `components/health/
oura-section.tsx`, directly above the 24h HR chart.

**Chunk 3 (HR smoothing, UB6).** New `lib/health/hr-smoothing.ts` — `bucketAverage` (timestamp-axis
buckets, generalises `hr-day-chart.tsx`'s existing `toBuckets`) and `rollingMedian` (bare-value
buffers, for the live sparkline). Per One Formula, One Place: `hr-day-chart.tsx`'s `toBuckets` now
delegates to `bucketAverage` (output unchanged — pure dedup), the done-screen `hr-recovery-chart.tsx`
now averages into 30s buckets instead of plotting raw per-sample points, and `recovery-index.ts`'s
private `rollingMedian` copy was deleted in favour of the shared one. Decided (and documented in
this PR, not the decode layer) that outlier rejection stays display-side only — decoders remain
infallible/pure per the Oura-BLE archival rules; raw samples are never mutated.

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1093 passed — 8 new
`hr-smoothing` unit tests covering bucket grouping/sorting/empty/single-point and rolling-median
spike-rejection/flat-series/empty/short-input; one test's own expectation was wrong on first pass
— a 2-element `rollingMedian` window with `window=5` clamps to the 2-element slice and the
upper-median tie-break yields the higher value for both points, not an identity pass-through, so
the test was corrected to `[80, 80]`, not the code). `pnpm build` succeeds. Dev-server smoke:
`/health` and `/workout` both 200 with the test user; confirmed no other consumer of
`LiveHrReadout`/`useLiveHr()` exists beyond the two already-updated call sites (grep). **Not
exercised:** the actual rendered UI — this sandbox has no Playwright/browser-automation dependency
installed in the project, so the new markup (the stripped chip, the relocated Measure-now card) was
verified by code review + type/build correctness only, not a rendered screenshot; and everything
BLE-live (the hold-across-gaps behaviour, a real Measure-now reading, smoothing over real bursty
beats) is device-only per the plan's own scope — this sandbox has no ring and the seeded test user
has no Oura token.

**Rebase note.** A concurrent session (also numbered 269, `claude/rem-parity-sleep-staging-agbq16`)
merged a sleep-staging fix + an offline-shell-fix insertion (new backlog item 2) to `main` while
this branch was in flight, bumping the version to 1.129.0 and renumbering the queue. Rebased onto
the fresh `main`, renumbered this entry to session 270, and re-based the version bump onto 1.129.0
instead of the stale 1.128.1 this branch was cut from.

Version bump 1.129.0 → 1.129.1 (patch — UX polish + smoothing, per the plan's own instruction) +
changelog entry + `docs/module-map.md` gained an HR-smoothing formula row. Backlog item 5 (UB5+UB6,
renumbered to item 6 by the concurrent offline-shell insert) removed from the queue (fully
shipped, no remainder); items 7+ renumbered down by one to close the gap.

## Session 269 — Sleep stager: catch quiet wakefulness (elevated HR + movement together), v1.129.0 (`claude/rem-parity-sleep-staging-agbq16`)

**Continuation of the 259/260 sleep-staging arc, same branch (restarted from fresh main).** With the
debug tool fixed (260), the owner read a real per-epoch dump for 2026-07-11 and flagged a ~15-min
window (~03:30–03:45) where they were awake on their phone but the stager marked it all `light`. They
confirmed the label precisely: **the moving stretch was genuine wake; the still, motionless stretch
after it was drifting off = correctly sleep.** A rare piece of owner ground truth.

**Root cause (`lib/health/sleep-staging.ts` step 1):** wake detection was single-signal — clear movement
(`> moveHi`) OR clear tachycardia (`HR > floor + 18`). The phone-awake window had HR ~+7–10 over floor
(under the +18 bar) AND movement ~2 (elevated but the one epoch that crossed `moveHi` got folded as a
lone stir). Each signal individually under threshold → read as light. The rules never combined
"mildly-elevated HR **and** elevated movement, sustained" — which is exactly quiet wakefulness.

**Fix:** a "quiet wake" pass — a sustained run (`QUIET_WAKE_MIN = 2` epochs) where movement > the night
median AND HR > floor + `QUIET_WAKE_HR_DELTA` (6) → awake. The discriminator vs REM (also elevated HR)
is movement: **REM has atonia (still), quiet wake moves.** Requiring movement > median means these
epochs are non-still, so REM and deep (which require stillness) are structurally never reached — the
rule only ever reclassifies would-be light. Calibrated to the 07-11 window; the still drift-off after
stays sleep as the owner described. Both constants tunable. User-visible (time-asleep/awakenings), so
v1.129.0 + changelog.

**Verification:** 25 stager tests pass (2 new — sustained co-elevation → awake, isolated stir → stays
sleep), full sleep suite green (DB rollup incl.), typecheck + lint clean. **NOT device-verified:** the
real effect on the owner's nights needs a Redecode + the per-epoch dump; the rule is calibrated to one
labelled night, so it may need `QUIET_WAKE_HR_DELTA` raised if it over-calls wake on other nights.

**Next levers discussed (not built):** LF/HF frequency-domain HRV as a genuinely-independent REM signal
(reuses `breathing-rate.ts`'s tachogram; gated on IBI density) is the strongest candidate; explicit
ultradian cycle prior and unsupervised GMM threshold-fitting are lower-priority (the latter can't assign
clusters→stages without labels). All remain principled-but-unverifiable without ground-truth nights or
the parked SleepNet model.

## Session 268 — Oura BLE data-mapping Chunk 4: Cloud-sync cutover (`feat/oura-ble-cloud-sync-cutover`)

Backlog-driven implementer pass, working queue item 4 (Oura BLE — timestamp hardening, tester
upgrades, product data mapping). Items 1–3's genuinely actionable remainders were all either
native/deferred (item 1 Chunk C), scoped for their own dedicated pass (item 2's A3/A4), or
owner-blocked (item 3 Phase 2, waiting on a model-key extraction the owner is doing out-of-band)
— item 4's Chunk 4 (Cloud-sync cutover) was the next self-contained, in-sandbox-verifiable task,
gated only on Chunk 3's mapping being proven against real overnight data, which it has been since
session 219 (v1.120.0).

**What shipped.** The app-open/resume Oura Cloud sync (`components/sync-provider.tsx`) and its
mirrored Health-tab-open auto-sync (`app/health/health-content.tsx`) both now skip firing
`/api/oura/sync` when the direct-BLE pipeline already has data within the last 48h — checked via
a new cheap, local-DB-only `GET /api/oura-ble/freshness` (`repo.getLatestOuraBleMeasuredAt`, a
`MAX(measured_at)` read on `oura_raw_samples`, no Oura Cloud round-trip) and a pure
`isBleDataFresh()` helper (`lib/oura/ble-freshness.ts`, unit-tested). The Cloud sync has been
frozen data-wise since the 2026-07-07 re-key, so this stops the app pointlessly hitting a dead
endpoint on every open. `/api/oura/token` gained `bleLastMeasuredAt`; the More-page ring status
(`components/more/oura-section.tsx`) now shows "Ring synced `<age>`" from the BLE timestamp when
BLE is fresh, instead of a Cloud sync timestamp that looks fresh but reflects no real data —
falls back to the Cloud timestamp only when BLE has nothing recent. Left deliberately untouched:
the explicit "Sync Now" button, pull-to-sync, and `exercise-detected-card.tsx`'s workout-auto-
detect sync — those are either explicit user intent or a different Cloud-only feature (workout
detection), and the pull-to-sync/exercise-card rewiring is already owned by backlog item 7 (home-
page freshness plan) to avoid duplicate/conflicting work when that item lands.

**Merge-conflict note.** Started this pass on a stale local branch left over from the prior
session's work (pre-compaction); PRs #420 (Chunk B) and #421 (the Chunk-5 backlog reconciliation)
had both already merged to `main` in the interim (auto-merge, per the standing "merge when green"
instruction). Re-fetched `origin/main`, rebuilt a correctly-scoped branch from it, and carried the
uncommitted work over via `git stash` — one straightforward import-line conflict in
`sync-provider.tsx` (Chunk B's `getStepOrchestrator` import vs. this session's `isBleDataFresh`
import), resolved by keeping both.

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1085 passed, no new
failures, 6 new `isBleDataFresh` unit tests); `pnpm build` succeeds. Local dev DB: the freshness
route 401s unauthenticated, returns `{lastMeasuredAt: null}` with no BLE rows for the seeded test
user, and returns the real timestamp once a synthetic `oura_raw_samples` row is inserted (cleaned
up after). **Not exercised:** the actual on-device behaviour of the gate (whether the app-open
Cloud-sync skip is perceptible, whether the More-page label reads correctly against a real BLE
history) — this sandbox has no ring and the seeded test user has no Oura token; the logic is
proven at the unit/route level, not end-to-end against a live ring.

Version bump 1.128.0 → 1.128.1 (patch — correctness/staleness fix, not a new capability) +
changelog entry + `docs/module-map.md`'s app-open-sync row updated. Backlog item 4 annotated with
Chunk 4 shipped; the `source` provenance column and the per-epoch clock anchor remain open,
explicitly left for their own pass (provenance touches every `body_metrics` writer; the anchor fix
is native/Kotlin-adjacent).

## Session 267 — Offline support review: why the app is unusable with no reception → shell-availability plan, backlog item 2 (docs-only, `claude/offline-support-review-lffmko`)

Owner-reported outage: "Today I had no reception and the app's pages would not load and it was
not useable" — offline-first is one of the app's founding goals, so this got a full review
(shell + data layer) rather than a spot fix. Planning session per the backlog protocol: review +
plan + queue entry, no implementation.

**The headline: the data layer is innocent; the app shell is what dies offline.** Two parallel
code audits (data reads / shell+navigation) plus an **empirical reproduction against a real
production build** (`pnpm build` + `pnpm start` on the local dev DB, Chromium via Playwright).
Repro subtlety worth recording: Playwright's `context.setOffline(true)` does **not** apply to
service-worker-issued fetches, so the first "offline" run silently kept hitting the live server
— killing the server process is the honest offline simulation against localhost.

**Reproduced failure modes** (production build, after a normal online session — sign in, land on
`/`, let nav prefetch settle):
- The SW cache held **only two documents** — `/` and `/sign-in` — plus per-build
  `?_rsc=<hash>` payloads for the tabs and 59 reactively-cached static chunks. In an SPA,
  "pages visited as full documents" is just the entry URL.
- Offline **cold start at `/`**: works — home renders fully from SW cache + `readCacheSync`
  seeds. The offline-first data plumbing does its job when the shell gets that far.
- Offline **cold start at `/workout`** (or any non-entry route): **`net::ERR_FAILED`** — raw
  Chromium error page. `caches.match` misses, `respondWith(undefined)`.
- Offline **warm tab-tap to /workout**: the prefetched RSC payload serves, then the screen's
  never-fetched lazy chunk 404s — "Loading chunk 6619 failed" → error boundary **without the
  bottom nav** → dead end.
- Documents ship `Cache-Control: private, no-cache, no-store` (measured), so the WebView HTTP
  cache holds nothing — SW Cache Storage is the single point of failure.

**Root causes (review F1–F7):** the SW precaches nothing (`install` is deliberately empty for
auth reasons — but that reasoning only holds for documents, not immutable statics); the
build-stamped cache name + delete-everything activate handler **wipe the whole offline cache on
every deploy** (and this project deploys many times a day — the wiped state is effectively the
device's normal state); no offline fallback exists at any layer (no `/offline` page, no
`onReceivedError` in `MainActivity`, error boundaries lose the nav); `cache.put` never checks
`res.ok`; the activate handler force-reloads every open client; and nothing ever verifies the
Samsung WebView actually has a live SW (registration failure is a swallowed `.catch(() => {})`).
The 2026-06-20 architecture review had flagged the missing offline fallback; it was never built,
and no queued backlog item owned the shell layer (R3/items 8/10 own *data* offline-ness).

**Data-layer verification (review D1–D4):** `cachedFetch` never throws offline; `SyncProvider`
never blocks paint and backs off cleanly; every primary screen seeds synchronously and/or reads
the native local store first. Bounded gaps recorded: the six today-guarded keys blank after
midnight offline (by design — the yesterday-as-today guard), the localStorage seed floor bounds
the offline read window to ~24 h, secondary sheets (day-log overlays, HR-recovery) are bare
fetches (owned by items 8/10 + R3), and there is **no offline indicator anywhere in the UI**.

**Deliverables:** review `docs/reviews/2026-07-11-offline-support-review.md`; plan
`docs/superpowers/plans/2026-07-11-offline-shell-availability.md` (chunk 1: per-build precache
manifest injected into `/sw.js` — all immutable `_next/static` + a new unauthenticated
`/offline` page; previous-generation cache retention across deploys instead of the wipe;
navigation fallback chain; `res.ok` put-guard; drop the force-reload. Chunk 2: `useOnlineStatus`
+ offline pill; nav-preserving, online-event-auto-recovering error boundaries. Chunk 3: seed
floor 24 h → 7 d; the stale-today affordance recorded but deferred pending owner sign-off.
Chunk 4: SW-health diagnostics row + airplane-mode device-smoke checklist additions). Queued as
**backlog item 2** (later items renumbered +1, reading-order + cross-refs updated): an
owner-reported outage on the app's core promise outranks every refinement item. Known-Issues row
added to `projectOverview.md`.

**Not exercised (docs-only session):** nothing shipped; the repro ran in desktop Chromium
against a local production build. On-device Samsung WebView SW behaviour (including whether the
SW is even registered there), native local-store reads, and real airplane-mode radio behaviour
remain unverified — the plan's Task 4.2 airplane-mode smoke run is the implementation's merge
gate.

## Session 266 — Oura BLE step orchestration, Chunk B (`feat/oura-ble-step-orchestration-chunk-b`)

Backlog-driven implementer pass, continuing queue item 1 (owner directive — "move straight to
tier 2 orchestration") — Chunk B, the JS auto-orchestrator. Chunk A shipped last session; Chunk C
(native) remains.

**Resolved a research gap from Chunk A.** Chunk A's manual tester (accel-only, 0x33 frames) had
no ring ds available and worked around it with a wall-clock-to-ds conversion via the clock
anchor. Investigating Chunk B's gate-frame path (0x7e/0x7f) found these ARE Oura "history event"
frames (tag ≥ `HISTORY_EVENT_PREFIX`), which carry a real embedded 4-byte ds in their first
payload bytes — `historyEventFromHex` (already existed, used by the admin ingest route) decodes
it directly. So Chunk B never needed the wall-clock workaround; extended
`POST /api/oura-ble/live-steps`'s Zod schema to a union accepting either `{startDs, endDs, steps}`
(Chunk B, real ds) or `{startedAt, endedAt, steps}` (Chunk A, wall-clock) rather than forcing one
caller through an unnecessary round-trip.

**Pure state-machine core.** `lib/oura-ble/step-orchestrator-core.ts` (idle → counting → cooldown)
is a dependency-free decision function — `onGateWindow`/`onDisconnect`/`forceStart`/`forceStop`
all take a snapshot + inputs and return a new snapshot + a list of effects (`startAccel` /
`stopAndPost`), with no Capacitor/fetch/timer coupling — mirroring the house pattern from
`lib/notifications.ts`'s `computeRestNotificationAction`. 15 unit tests drive it with synthetic
gate-window streams: walking-window trigger, radio-courtesy refusal, 2-consecutive-idle-window
stop, walking-window streak reset, 20-minute burst cap, live-HR-burst mid-count yield,
disconnect-stops-and-posts, cooldown gating + expiry, and the explicit `forceStart`/`forceStop`
triggers (including their refusal conditions — no known ds, already counting, live-HR active).

**Radio-courtesy gap found and closed.** The plan calls for never running the step-counting accel
stream while a live-HR burst is active (both are `SetRealtime` sub-modes on the same BLE link).
No "is a burst active" getter existed on `LiveHrManager` — added `isRunning()`
(`lib/live-hr/manager.ts`), a one-line addition exposing the existing private `running` closure
variable, since nothing needed to query burst-liveness externally before now.

**Effectful shell.** `lib/oura-ble/step-orchestrator.ts` owns the `ouraFrame`/`ouraFrames`/
`ouraStatus` plugin listeners, a capped rolling buffer of gate frames re-paired via
`pairStepFeatures` on each batch (deduped against the last-processed ds so a frame arriving
across two batches isn't double-processed), a `StepPeakCounter` fed from 0x33 frames while
counting, the 4-minute `startAccel` re-arm (the firmware's `SetRealtime` time-box), and the POST.
Mounted native-only (guarded, `Capacitor.isNativePlatform()`) once from `sync-provider.tsx`, on
the same pattern as the file's three other native-only mount effects. Added a status row (`idle` /
`counting (n)` / `cooldown` + last-posted window) to the manual tester per the plan's
observability ask. `startTrackedWalk()`/`stopTrackedWalk()` exported for the queued guided-walk
feature.

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1121 tests — 15 new
orchestrator-core unit tests); `pnpm build` succeeds. Dev-DB smoke of the route's new union
schema: a ds-shaped payload stores directly, a wall-clock payload still 422s without an anchor
(unchanged Chunk A behavior), a payload matching neither shape 400s. **Not exercised:** anything
BLE-live — the actual trigger timing, burst duration, and whether the live-HR yield genuinely
prevents radio contention on a real ring are only provable on-device; this sandbox has no ring.
Device smoke not run this session; Chunk B is explicitly gated on an on-device soak before Chunk C
(native) starts, per the plan's own sequencing.

Version bump 1.127.0 → 1.128.0 (minor, new auto-triggering capability) + changelog entry +
`docs/module-map.md` row updated. Backlog item 1 annotated with Chunk B shipped; Chunk C left in
the queue.

## Session 265 — Planning: health tab overhaul — full review → plan + backlog item 9 (docs-only, no version bump) (`claude/health-tab-review-p4a3qy`)

**Owner-requested full review of the health tab** — widgets, data, caching/cache-busting, load
times, local-first reads, performance, UI, HR, missing Oura data, section grouping. Three parallel
code sweeps (UI structure; caching & data flow; Oura BLE data coverage), every load-bearing finding
hand-re-verified against `main`@`3f7dd47`. This is the PR-1 planning half of the backlog protocol —
**no implementation**.

**Headline findings:**
- **Post-re-key dead surfaces:** `/api/oura/stats` serves only *today's* `oura_daily` row, and BLE
  writes only `non_wear_time_sec` to it — so the OuraSection Activity / Stress & Recovery / Advanced
  sub-cards and the Body-tab `ouraIndicators` card have been silently dead (conditionally hidden)
  since the 2026-07-07 re-key. None of their fields is BLE-derivable today → plan deletes the dead
  branches rather than leaving vanished UI.
- **Computed-but-discarded data:** `breathingFromIbi` runs per sleep epoch but only its
  `variability` feeds the stager — `rateBrpm` is thrown away and the BLE sleep row never writes
  `respiratoryRate`, leaving the sleep card's "br/m" chip dead. Plan: write the night median (one
  owner Redecode backfills). Also decoded-but-never-surfaced: intraday temp (item 2 A3 owns),
  daytime HRV, MET/0x50, ambient light, BLE battery (UB4 owns).
- **Five cache-invalidation gaps** (verified in `lib/cache-groups.ts`): `weekly-muscle-sets` not in
  `invalidateExerciseLogged`; `health-trends-summary` not in `invalidateBodyMetricWrite`/
  `invalidateActivityWrites`; `health-trends:` prefix not in `invalidateNutritionWrite`;
  `sleep-performance-correlation` in no sleep-bearing group; `training-load` not in
  `invalidateActivityWrites`. Plus: `oura-stats` is a bare key holding today-specific data; the two
  trends routes share one rate-limit bucket (`:health-trends`) at different limits (10 vs 20/60s);
  `AiInsightCard` fires an uncached POST per detail-page mount against a 10/hr budget.
- **Paint:** `weekly-stats` never seeded (skeleton every open); a stale `body-metadata` cache keeps
  `metaLoading` true → 13 pulsing Body-card skeletons on repeat visits; `fetchMeta` serially awaits
  the local store before firing its network fetches; zero `React.memo` across ~27 health cards with
  a ~30-state orchestrator re-rendering all three mounted tab panels.
- **HR:** the day chart draws straight interpolated segments across the ring's power-gating gaps and
  vanishes entirely on empty days; the `/health/heart-rate` detail page never renders the day series
  at all.
- **IA:** heart data scattered across 4 Body-tab places; steps/water/weight-trend on 3 surfaces
  each; the card-reorder edit mode is a no-op (`SortableHealthCard` ignores `editMode`); bodyFat
  hand-rolls an inline SVG sparkline; both hotspot files over the ceiling (1149/972 lines).
- **Offline-first siblings R3 doesn't cover:** sleep detail reads server-only while the main screen
  reads the same domain local-first; injuries are written server-only but read local-first — an
  offline injury add is silently lost.

**Deliverables:** plan `docs/superpowers/plans/2026-07-10-health-tab-overhaul.md` (six chunks:
cache correctness → data honesty/BLE surfacing → instant paint → Body-tab regroup → offline-first
siblings → missing-data states; branch `feat/health-tab-overhaul`), queued as **backlog item 9**
(below measured-time model, above R3–R8; existing items renumbered to make room, and the
reading-order note updated to match). The plan opens with an ownership table explicitly deduping
against R6 (trends 4× fetch, lazy-init seeds, skeleton-vs-cache-seed), R7 (canvas `var()` bug,
emoji/token/aria sweeps), R3 (SYNC-R2/R3/R5), R8 (`normalizeDateParam` sweep), UB4 (BLE battery),
UB6 (HR smoothing helper), and item 2 A3/A4 (temp baseline) — no finding is double-owned, none
dropped. Docs-only, no version bump.

**Process note — third rebuild:** this branch's docs edits were rebuilt against `main` **three
times**. The first push (based on a `main` fetched at session start, sat unpushed through several
minutes of parallel research-agent work) never triggered CI at all — a sibling docs PR had already
merged, making the base stale (zero workflow runs, the documented "stale base" mode). The second
rebuild fixed that, but a *third* sibling planning PR (nutrition-tab uplift, #416) merged moments
later, flipping the PR to a real conflict (`mergeable_state: dirty`) and independently claiming
session number 263. The third rebuild (this one) hit a *fourth* concurrent merge — an actual
implementer PR (Oura BLE step-orchestration Chunk A, #419, v1.127.0) — which also claimed session
number 264 first. Final session number: 265. No renumbering conflicts arose from the Chunk-A PR
itself (it only appended status text to item 1, no backlog restructuring). Given how much
concurrent planning/implementation activity this shared-docs contention represents, future
sessions editing these three files should re-fetch `main` immediately before the final push, not
rely on an earlier fetch, and expect to redo the shared-file edits if the gap between drafting and
pushing spans more than a couple of minutes.

---

## Session 264 — Oura BLE step orchestration, Chunk A (`feat/oura-ble-step-orchestration`)

Backlog-driven implementer pass, taking queue item 1 (owner directive 2026-07-10 — "move
straight to tier 2 orchestration", `docs/superpowers/plans/2026-07-10-oura-ble-step-orchestration.md`)
— Chunk A only, the server-side merge substrate. Chunks B (JS auto-orchestrator) and C (native)
remain.

**Migration 119 + merge function.** `step_live_windows` (`user_id, start_ds` UNIQUE — idempotent
client retries) stores accurate live-counted step windows. `mergeStepSources` (new pure function,
`lib/health/step-estimate.ts`) implements the Tier-2-wins merge: live-counted windows override
the col14 gate estimate for the ds span they cover, the estimate fills every gap. Unit-tested
against the existing calibration fixtures (full coverage, partial coverage leaving a gap, no
overlap, a standalone live window with no matching gate windows). Wired into the rollup's steps
section in `aggregateOuraRawSamples` — fetches live windows alongside the paired gate frames,
buckets both by local day (a live window credits the day of its start, not split across
midnight), and only offers a day's merged total when it beats what's already stored (the
existing max-merge guard, unchanged). Extended the existing DB-backed rollup test
(`oura-ble-step-rollup.test.ts`) with cases for override, idempotent re-post (same `start_ds`
updates in place, doesn't duplicate), a standalone live window, and confirmed the max-merge guard
still holds against all of them — required tracing through the file's sequential shared-state
test ordering to get the assertions right (a live-merge test placed after the existing
"higher estimate beats lower stored" test needed to explicitly reset the stored value first, or
the guard would silently block the intended lower merged total).

**`POST /api/oura-ble/live-steps` — a plan deviation caught during implementation.** The plan
specified `{startDs, endDs, steps}` (ring deciseconds), but `AccelFrame` (the 0x33 live-accel
decode, `lib/oura-ble/accel.ts`) carries no ring ds at all — only `sampleRate`/`seq`/`samples` —
so the manual tester genuinely has no ds to send for its start/end. Rather than force a fake ds
onto the client, the route accepts wall-clock ISO timestamps and converts server-side to ds via
the user's latest clock anchor (new `dsFromMeasuredAtMs` in `lib/oura-ble/decode.ts`, the exact
inverse of the existing `measuredAtMs`); fails closed (422) when the user has no anchor yet
(never synced). User-scoped (not admin-gated, unlike the ingest routes — this is a real product
write), rate-limited, Zod-validated (span ≤ 4h, steps 0–20,000).

**Manual tester gains "Save result."** `components/oura-ble/live-step-test.tsx` (admin-only,
`/admin/oura-ble`) now captures wall-clock start/end around the counting run and a "Save result"
button POSTs it — Chunk A's "counted walks correct the day total immediately" is live end-to-end,
before any auto-trigger exists. Added a small localStorage retry buffer for failed saves
(flushed on mount and after every successful save, keyed loosely and deduped server-side by the
DB unique constraint) rather than full outbox-domain machinery, which the plan itself called
overkill for this manual/tester flow.

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1106 tests — 6 new
unit tests for `mergeStepSources`, 3 new DB-backed rollup tests); `pnpm build` succeeds;
`check-reconcile`/`check-push-mutations` custom-rule scripts pass. End-to-end on the local dev
DB: seeded a clock anchor, confirmed the route's ds conversion against hand-computed values,
confirmed a same-window re-post updates the existing row in place (no duplicate), confirmed the
fail-closed 422 with no anchor and 400 on an invalid/oversized span. **Not exercised:** everything
BLE-live (the tester's actual on-device accel stream, whether saved windows visibly correct the
Body/Health step tile) — this sandbox has no ring; device smoke not run this session.

Version bump 1.126.0 → 1.127.0 (minor, new backend capability + admin-tester UI addition) +
changelog entry + `docs/module-map.md` row for the new step-live-window infrastructure. Backlog
item 1 annotated with Chunk A shipped; Chunks B and C left in the queue.

## Session 263 — Planning: full Nutrition-tab review → uplift plan queued as backlog item 16 (docs-only, `claude/nutrition-tab-review-el8b1f`)

Owner-requested full review of the Nutrition tab — widgets, data, caching/cache-busting, load
times, local-first save/retrieve, performance, UI/display and section grouping. Planning session
per the backlog protocol (PR 1 of 2): review + plan, **no implementation**. Ran in parallel with
the home-page (262) and workout-system (261) review sessions — the PR was rebased onto their
merged queue reshuffle and renumbered before landing (originally slotted as item 13; the
"session 260" number this session first claimed was also taken in parallel).

**How it ran:** three parallel review agents (logging-flow components; supplements/settings/
end-of-day widgets; API/caching/sync — the last died on a session limit and was finished by hand)
plus a direct read of the orchestrator (`app/nutrition/nutrition-content.tsx`), the cache layer
(`lib/sqlite/cache.ts`, `lib/cache-groups.ts`, `lib/cache-ttl.ts`) and all 20 nutrition/supplement/
water API routes. Every finding was deduped against the already-queued R5 (NUT-1…11), R6 (PERF-5
owns the date-swipe refetch storm) and R7 (UI-H1 owns the canvas-`var()` class) before planning,
and the highest-risk claims re-verified against the working tree line-by-line.

**Headline new findings** (full list with file:line in the plan): (1) **today's burned calories
inflate past-day macro rings** — `body-metadata`'s today-only `calsBurnedToday` is applied to
whatever date is on screen, and the local-store read disagrees with the server read about which
date it represents; (2) supplement outbox mutations stamped with the banned UTC
`toISOString().slice(0,10)` date at three sites in `manage-supplements-sheet.tsx`; (3) the
supplements section renders **today's** logged state while viewing past dates; (4) instant-paint
violations across every nutrition sub-sheet — supplements have no cache seed (skeleton every
mount), SavedMealsSheet/FoodLibrarySheet/MealTypeManager/capture-step all bare-`fetch` with
spinners (the library double-fetches on open), and meal-type edits block feedback on two serial
round-trips with an unguarded delete; (5) `MealCard` unmemoized under the parent's 8-fetch churn;
(6) six nutrition GETs missing the standard SWR headers + saved-meals POST missing Zod; (7) the
weekly chart passes `var(--muted-foreground)`/`var(--border)` to chart.js canvas (the **third**
instance of R7's UI-H1 black-render class) and duplicates the macro palette as hex literals;
(8) assorted a11y/tap-target/`key={index}` debt. Also recorded three reviewed-and-rejected
non-findings (meal-type emoji is user data, not chrome; barcode-overlay white is
camera-feed-justified; the flagged TDEE→adherence invalidation gap is a non-issue since adherence
measures logging completeness, not intake vs target) so they don't get re-flagged.

**Product/layout half:** merge the standalone adherence card into the weekly chart card, collapse
the two full-width Saved-Meals/End-of-Day buttons into a two-up quick-action row, add a **water
tile** to the Nutrition tab (hydration data is already in `body-metadata`; `WaterLogSheet` reused
from Health), and build a read-only **local meal-types mirror** so meal cards render offline
(today they exist offline only via the localStorage seed; explicitly *not* a synced/outbox
domain — editing stays online).

**Deliverables:** plan `docs/superpowers/plans/2026-07-10-nutrition-tab-uplift.md` (5 chunks,
~24 tasks, every one with file:line + code + verify) queued as **backlog item 16**, branch
`feat/nutrition-tab-uplift`, explicitly sequenced **after R5/R6/R7 (items 12–14)** (shares files
with R5, assumes R6's `fetchData` split, imports R7's `lib/chart-colors.ts` hoist); the native
Oura items renumbered 17–19 and the queue-preamble cross-refs updated. Docs-only — no code
changed, no version bump.

---

## Session 262 — Home page full review → freshness/caching/performance plan, backlog item 7 (docs-only, `claude/home-page-performance-review-etleym`)

**Owner asked for a full review of the home page/dashboard** — widgets, data, caching/cache-busting,
slow loads, local-first reads, performance increases, UI, HR — with the findings written up as an
implementation plan and slotted into the backlog. Ran a four-angle audit (caching/data-flow,
render/bundle, offline-first/sync, UI/theme/dates) over `app/session-select/session-select-content.tsx`
(1,516 lines, ~40 `useState`) and every component it renders; every finding verified at file:line
against `main`@`3f7dd47`.

**Headline verified findings (the plan's Chunks 1–2 — the perceived-freshness wins):**
- **The frozen Oura Cloud sync still fires from three home surfaces.** `handlePullSync` POSTs
  `/api/oura/sync` (~15 external round-trips per pull that structurally cannot return new data since
  the 2026-07-07 re-key) in parallel with the BLE drain `PullToSync` already fires; the **header
  Refresh button fires *only* the dead Cloud call and never drains the ring** — pressing Refresh
  cannot surface new Oura data at all; `exercise-detected-card` has a third rogue 5-min-throttled
  Cloud sync. Its `toast.error('Oura sync failed')` is dead code (the frozen Cloud 200s). Nothing
  invalidates client caches after a real BLE drain/redecode either — new ring data lands server-side
  while home's HR chart waits out a 30-min TTL.
- **Two real cache-staleness bugs:** the legacy `ta_meta_v1`/`ta_recommendation_v1` sessionStorage
  seeds are cleared by `invalidateWorkoutSummaries()` but **not** `invalidateProgramStructure()`, so
  home first-paints pre-edit program data after every Config save (the audit-2026-07-02 class, still
  live on one group). And the post-workout optimistic streak/calendar stamp in
  `workout-screen.tsx:1013-1035` is a **dead no-op** — `invalidateWorkoutSummaries()` synchronously
  clears the sync mirrors before `updateCache` runs, and `updateCache` no-ops on a cleared cache, so
  "completing a workout looks slow" partially survived the 2026-07-02 fix. (Distinct from the stamp's
  device-tz *keying*, which the session-261 review deduped to R4/R8 — the ordering no-op is new.)
- **Offline-first read-side gaps:** sleep, trained-days/streak/week-strip, and `weekToDate` all read
  server-only although `pullDelta` already fills `sleep_sessions`/`workout_sessions`/`body_metrics`
  locally. Plus: a redundant `calendar-data` fetch (strict subset of `streak-data` on home; also
  double-runs the ≤365-iteration streak memo), five un-memoized cards under a ~13-fetch orchestrator,
  and home-scoped token/a11y/touch-target violations.

**Deliverables:** `docs/superpowers/plans/2026-07-10-home-page-freshness-and-performance.md` — five
independently-landable chunks (Cloud-sync retirement + BLE-drain wiring; cache correctness; local-first
seeds; render hygiene + two sheet extractions; UI tokens/a11y) — inserted as **backlog item 7** (branch
`perf/home-freshness-caching`), items below renumbered. **Overlap discipline:** a large share of the
raw findings were already owned by queued plans — the plan's ownership table cross-references R3
(day-timeline/early-deload), R6 (chart.js bundle leak, Meteors interval, skeleton-over-seed, `?tab=all`
batch), R7 (nested-button banners, emoji, `#fbbf24` card), R8 (deviceTz keys, sleep-stage palette) and
the data-mapping item's Cloud-cutover chunk, so nothing is double-implemented. The new plan
**supersedes R6's PERF-3** (removes the Cloud call instead of re-throttling it) and takes over R6
PERF-12's two named sheet extractions — both annotated in the R6 plan doc with land-first-wins notes.
Two coordination points with the parallel session-261 workout-hardening plan are noted on both backlog
entries (its health-content task should reuse `clearLegacyHomeSeeds()`; its `ta_recommendation_v1`
date-stamping composes with this plan's seed-clearing). Mid-session, three parallel-session merges
(#413/#414/#418) landed — rebased the queue insertion onto the new 18-item numbering.

**Verification:** docs-only, no code, no version bump; markdown-only PR #415 (auto-merge enabled per
the low-risk rule). Nothing runtime was exercised — all findings are code-reads with file:line
evidence; the four verify-first deferrals an implementer must re-check are named in the plan's
self-review notes.

## Session 261 — Planning: full workout-system review → hardening plan + backlog item 10 (docs-only, `claude/workout-system-review-1sp7ch`)

**Owner-requested full review of everything workout/activity-related**, followed by the standard
planning-session deliverables (plan + backlog entry, no implementation). Scope as asked: timers,
the AI dynamic system, the phase system, weight increases, page loading/caching/cache-busting/
slow loads, non-local save-or-retrieve-first, performance, UI, and in-workout HR.

**Method:** six parallel read-only review passes over `main`@`3f7dd47` (timers · AI/phase/
progression · caching/loading · offline local-first · render performance · UI+HR), each
explicitly deduping against the already-queued overlapping plans (R3 chunks 2–6, R4, R6, UB5/
UB6, measured-time-model) so the new plan contains only unowned findings. Every finding verified
against actual code with file:line; DUPs recorded one-line in the review doc for the record.
(Process note: the six passes were interrupted mid-flight by a session usage limit and resumed
from their transcripts after reset — no work lost.)

**Deliverables (all docs-only):**
- `docs/reviews/2026-07-10-workout-system-review.md` — ~45 NEW findings + confirmed-DUP ledger +
  "what works well" per dimension + a data-flow architecture summary of the AI prescription
  engine + Home/workout mount-fetch inventory + offline-domain coverage table.
- `docs/superpowers/plans/2026-07-10-workout-system-hardening.md` — six independently-landable
  chunks (AI periodization correctness → offline mirrors → caching → timers → UI/HR → hygiene),
  zero schema migrations, branch `fix/workout-system-hardening`, every task with files/fix/
  verify/commit steps and cross-plan collision notes.
- `docs/implementation-backlog.md` — new **item 10** (directly after R4, which is item 9 since
  the parallel step-orchestration PR #413 restructured the queue; items 10–16 renumbered to
  11–17, stale item-number references fixed), plus an **amendment on the R4 entry**: WK-3's
  analysis is partially wrong — the rest beep/OS notification do NOT "correctly use
  `lastSetRestSec`" in supersets; their start anchor is nulled/stale after every handoff (review
  TMR-1), so implement WK-3 together with item 10's Task 4.1.
- `projectOverview.md` — status entry; also corrected the version line to v1.126.0 (session 259
  shipped it without updating the lean index).

**Headline findings** (full list in the review doc): the AI rep-completion signal chain is
permanently dead (`setLastSessionRanPrescription` never called — autoregulation always takes the
mildest 5% cut, rep pushes fire on RPE alone, the emergency-deload `<0.7` trigger can never
fire); prescriptions generate only at the *previous* session's completion and are consumed up to
7 days later with no re-evaluation or expiry check at the load path (today's soreness/readiness
never reach today's weights; per-exercise soreness deloads live 7 days vs the whole-session
variant's deliberate 1); superset rest alerts never fire (TMR-1); Stats-tab workout edit/delete
and whole-session deletes have no local-store mirror (SYN-1/2 — R3 Task 1.2 missed its own cited
scope) and the shipped edit-mirrors strand rows in `pending`, permanently blocking pulls
(SYN-4); workout-entry PATCH still hard-deletes tail sets (SYN-3); prescription accept/dismiss
never invalidates the freshWithinTtl `workout-card:` key (CCH-1, ≤6 h stale weights on Home);
ai_dynamic deload sessions can mint PRs (AI-8); the weekly-volume SQL window compares against a
bare `::date` — 10 h off the user's week (AI-6); set-log haptics are network-gated (UI-2);
session-RPE is one-shot with no undo (UI-5); the done-screen HR card misreports errors as "no
data" and its copy still steers the user toward the dead Oura Cloud sync (HR-1/2). Positives
worth recording: the timing core (absolute-epoch persistence, Date.now()-delta recomputation)
is solid; the outbox is robust (quarantine/backoff/confirm-by-id all correct); the deterministic
scaffolding around the LLM is genuinely strong; CLAUDE.md's "1 Hz tick re-renders the whole
workout screen" hotspot claim is stale (the cost moved to `ActiveWorkoutScreen`) and `TimerRing`
is dead code — both queued for cleanup in the plan's Chunk 6.

**Verification:** docs-only, no version bump, no code changed. All review claims are static
code-reading (file:line-confirmed); nothing was exercised at runtime — the plan itself carries
the per-chunk `pnpm dev`/APK gates for the implementer.

## Session 260 — Sleep-epochs debug tool showed an evening fragment, not the night (`claude/rem-parity-sleep-staging-agbq16`)

**Follow-up to 259, same branch.** While validating the REM change on-device, the `/admin/oura-ble`
"Sleep epochs (debug)" dump for 2026-07-10 showed `window 17:33–19:24` — a ~1h51m evening rest
fragment, not the 9.2h overnight the Sleep card correctly shows. **Not a staging bug and not the REM
change:** the card was right (REM 1.4→1.6h across the two redecodes, Deep untouched at 1.0h — the new
decode working as intended). The debug *diagnostic* picks the wrong window.

**Root cause (`lib/data/postgres/adapter.ts:aggregateOuraRawSamples`):** nights are keyed by wake-day
(`toAestDay(w.endDs)`), and a day can carry two windows that both end on it — the real overnight plus a
short evening rest fragment. The debug capture overwrote `debugNight` for *every* matching window, so it
kept the **last by start time** (the fragment). The read-time `merge-sessions` drops that fragment for
the card, but the aggregate-time debug capture runs before it.

**Fix:** capture the **longest** matching window (track `debugWindowDs`, only replace on a longer span).
One-line guard on the existing capture; zero effect on written metrics or staging — diagnostic-only, so
no version/changelog bump. Regression test added (`oura-ble-sleep-staging-rollup.test.ts`): seeds a main
overnight + a 3h-later evening fragment sharing the wake-day (a >2h gap splits the cluster, a ≥3h gap
escapes the merge), asserts two rows are written AND the debug surfaces the ~96-epoch night, not the
~18-epoch fragment. 155 sleep tests green, typecheck + lint clean.

## Session 259 — Cycle-aware REM/light decode: per-bout Viterbi replaces the per-epoch cutoff, v1.126.0 (`claude/rem-parity-sleep-staging-agbq16`)

**The heuristic stager got its one remaining principled lever.** The session-250 "both levers exhausted"
conclusion assumed the stager decides each epoch in isolation — it did (`remScore >= REM_Z` per epoch,
then `MIN_BOUT` smoothing deleted the isolated REM singletons, which is why dropping `REM_Z` stopped
moving REM). The missing lever was **cross-epoch structure**: REM comes in sustained cycles, so the
decision belongs at the **bout** level.

**What shipped (`lib/health/sleep-staging.ts`, server/JS only, no APK rebuild):** step 3 now assigns
DEEP by the unchanged `DEEP_Z` cutoff first (priority stage byte-for-byte untouched — the owner's stated
top concern is deep accuracy for muscle growth), then a **2-state Viterbi decode** (`decodeRemLight`)
resolves REM vs light over each contiguous run of candidate epochs. Emissions are the existing scores
(`remScore − REM_Z`, `light = 0`); one new constant `REM_SWITCH = 0.5` penalises each light↔REM
transition. Effect: REM is chosen as a **contiguous bout** — a brief mid-bout dip flanked by REM is
bridged, a sustained light stretch is never absorbed, a lone weak epoch never becomes a REM island. This
is the mechanism the exhausted `REM_Z` cutoff couldn't reach (it re-weighted a per-epoch decision that
smoothing then flattened; this changes the decision *unit*).

**Verification:** all 154 sleep-related tests pass (23 in `sleep-staging.test.ts` incl. 3 new — bridge a
mid-bout dip, don't over-bridge a sustained light region, leave DEEP untouched beside a REM bout; 8
DB-rollup files against the local dev DB). Typecheck + lint clean. On a crafted intermittent-REM night
the stager yields deep 19% / light 52% / REM 29% with REM in four clean bouts and the deep block intact.

**NOT verified in-sandbox (device-gated):** the real REM% lift on the owner's actual BLE nights — that
needs a Redecode on real captured `body_hex` + the `/admin/oura-ble` per-epoch dump, which only runs
on-device/prod. The change is a pure internal refactor of the staging function (contract unchanged;
`aggregateOuraRawSamples` consumes `.stages` exactly as before), so no new route/UI surface. Still
**unverifiable for true accuracy without a ground-truth night** — judged on ribbon plausibility +
per-night REM% vs the ~23–28% baseline, the same soft check the whole arc has had.

**Tuning knob going forward:** `REM_SWITCH` (higher ⇒ fewer/longer bouts; lower ⇒ nearer the old
per-epoch behaviour), tuned with `REM_Z` against a real redecoded night. Full rationale +
pick-it-back-up notes appended to `docs/oura-ble-sleep-staging-findings.md` (session-259 update). The
SleepNet-model route (Phase 2, parked) remains the only path to true Oura-parity REM.

## Session 258 — Ring steps SHIPPED: col14 walk gate → estimated daily steps + live-accel spike, v1.125.0 (`claude/step-calculation-next-ey9c72`)

**The app has a step source again** — the first since the 2026-07-07 re-key froze the Oura Cloud.
Backlog item 16 (own step counter, two-tier gate) Tier 1 shipped; Tier 2 spike shipped in the same
PR, pending the owner's on-device go/no-go.

**The calibration arc (same session, iterative with the owner on-device):** shipped a tester
**Step calibration** panel (`components/oura-ble/step-calibration.tsx`) that brackets a capture by
ring timestamp — the wall-clock display is anchor-drift-scrambled, so `ds` is the only reliable
label. Three tooling bugs found+fixed live against the owner's captures, each its own PR (#398
retry buttons disabled after an empty compute; #400 mark-before-sync let the ring's buffered
backlog flood in behind the mark; #403 fixed waits weren't enough — poll until the newest stored
ds settles). With clean captures the plan's **col0 candidate died** (desk typing overlaps walking
completely — it's motion intensity, not gait), but scanning all 27 unpacked columns against the
labelled captures found **column 14 is a real walk-cadence gate**: ≤13 on every steady-walk window
(100/200/normal), ≥44 on clean desk typing, ≥31 dead-still; fast leaked one window to 18, slow one
to 123. Verdict: catches steady walking, under-counts slow/irregular strides, **never** counts desk
activity as steps — an asymmetry we accept (under-count > phantom steps).

**Tier 1 (shipped, server/JS, no rebuild):** `unpack27` ported byte-exact from open_health into
`lib/oura-ble/step-features.ts` (pairs `0x7e` with the `0x7f` one ds later via carry bits; pinned to
a reference vector AND real captured ring frames — the session-241/242 captures were lost to the
ephemeral scratchpad, so all calibration hex is now committed in the tests).
`lib/health/step-estimate.ts` (One-Formula-One-Place): col14 ≤ 20 → walking window; **30
steps/window** (450 counted steps / 15 detected windows across all labelled walks). Rollup wiring in
`aggregateOuraRawSamples`: pairs from archival `body_hex` (the naive `decoded` is meaningless),
per-day estimate, **max-merge** — `steps` is plain-COALESCE in `upsertBodyMetrics`, so the estimate
is only offered when it beats the stored value, never regressing another source or a prior rollup.
`0x7e/0x7f` added to the ingest route's rollup trigger. No new UI — `/api/body-metadata` and the
existing step tiles just fill again.

**Tier 2 spike (shipped, unproven on-device):** the native service bridges **all** frames to JS
(`bufferFrame` has no tag filter), so the live path needs **no APK rebuild** — the plan's "native
handling required" assumption was wrong. `lib/oura-ble/accel.ts`: 0x33 decoder (i16 LE x/y/z,
infallible) + `StepPeakCounter` (EMA baseline, relative-threshold turning-point detection,
refractory) with honest spike-status caveats (g-scale + rate-byte semantics unpinned). Tester
**Live step test** panel: start/stop, 4-min `SetRealtime` re-arm (firmware time-box), live
count/magnitude readout. The on-device counted-walk comparison is the go/no-go for the accurate
path — if 0x33 never arrives, Tier 1 is the ceiling.

**Gate:** `tsc` 0, lint 0 errors, **1090 tests pass** (+16: step-estimate unit, accel unit, rollup
DB-backed incl. max-merge both directions + idempotency). **Verified live end-to-end** on the local
dev DB through the real HTTP routes (admin granted then reverted, rows cleaned): the owner's actual
walk-200 frames → `POST /api/oura-ble/samples` (trigger fired on a steps-only batch) →
`body_metrics.steps = 210` → `/api/body-metadata` `today.steps: 210` (+5% vs. the real 200).
**Not exercised (sandbox):** the 0x33 live stream (BLE inert on web), real-world day totals, the
tester panels rendering on the S25 WebView; `pnpm build` OOM-killed in-session — CI's Build check
covered it. **Next:** owner runs the Live step test worn+moving (0x33 go/no-go) and sanity-checks a
real day's total; threshold band 21–43 untested — revisit if totals inflate.

## Session 257 — UB4: Oura battery/wear-time accuracy, Chunks 1–2 (`fix/oura-battery-wear-time`)

Backlog-driven implementer pass, taking queue item 5 (UB4 — Oura Body/Health card: ring battery
+ wear-time accuracy, `docs/superpowers/plans/2026-07-10-ub4-oura-battery-wear-time.md`) —
Chunks 1–2 only, both server/JS and fully dev-DB testable. Chunk 3 (native) remains.

**Chunk 1.** The Body/Health "Time Worn" tile and trends sparkline re-expanded an already
partial-day `non_wear_time_sec` against a full 86,400s — the BLE rollup correctly stores
`elapsed − worn` for today, but the display layer's `86400 − nonWear` double-counted every
not-yet-elapsed hour as "worn". Extracted `secondsSinceLocalMidnight()` into `lib/date-utils.ts`
(the exact formula the rollup already used inline) and threaded it through: the rollup now calls
the shared helper instead of its own inline copy, `wornHours()` (`lib/health/wear-confidence.ts`)
gained a `dayLenSec` param defaulting to 86400 (back-compatible — `isLowWearDay`/baseline
callers unaffected since a baseline never includes today), and both the trends route and the
Time Worn tile now pass the partial-day length for today only.

**Chunk 2.** The battery % is `fetchLatestBatteryLevel` — an Oura **Cloud** call, and the Cloud
has received no new data since the 2026-07-07 direct-BLE re-key, so it reads as a confident live
% while actually frozen. Added `isBatteryStale()` (`lib/oura/client.ts`, 24h threshold, fails
closed on a missing/unparseable timestamp) and a shared `batteryStale` flag on both
`/api/oura/stats` and `/api/oura/token` so all three sibling surfaces derive staleness the same
way instead of three divergent age checks. Sibling-surface sweep: the Body/Health card shows a
neutral "Not live" label (no colour, paired with text per the colour-only-state rule) instead of
`{level}%`; More → Integrations shows the same "Not live" treatment; the battery chip
(`oura-battery-chip.tsx`) hides entirely rather than display a stale percentage.

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1076 tests — added a
`wornHours` partial-day-length test and a `secondsSinceLocalMidnight` 23:59/00:01 boundary test
using `vi.useFakeTimers`/`setSystemTime`, matching this repo's existing fake-timer convention);
`pnpm build` succeeds. End-to-end on the local dev DB: seeded a 1h non-wear `oura_daily` row for
today, confirmed `/api/health/trends` returns `wornHours ≈ 19.4` at ~20.3h elapsed (not the old
bug's constant 23h regardless of time of day); confirmed the disconnected-Oura state returns
`batteryStale: true` (fail-closed) with no errors. **Not exercised:** rendering the actual
connected-Oura UI (no valid Oura token available in this sandbox) — verified the underlying
calculation via the API routes directly instead; device smoke not run this session (Chunk 3's
BLE-battery surfacing is separately unstarted, not blocking this verification gap).

Version bump 1.124.9 → 1.124.10 (patch, user-visible accuracy fixes) + changelog entry. Backlog
item 5 (UB4) annotated with Chunks 1–2 shipped; Chunk 3 (native, folds into the next batched Oura
BLE rebuild) left in the queue.
## Session 256 — UB1: deep-link cold-launch redirect fix (`fix/mobile-deeplink-redirect`)

Backlog-driven implementer pass, taking queue item 8 (UB1 — first-open deep-link exchange yanks
you back to home, `docs/superpowers/plans/2026-07-10-ub1-mobile-deeplink-redirect.md`).

**Chunk 1.** `MobileAuthHandler`'s cold-launch handler fired a redundant token exchange whenever
`App.getLaunchUrl()` returned the OAuth deep link that launched the process — even when the
WebView's cookie jar already held a session from a prior sign-in. On resolve it unconditionally
`window.location.href = "/"`, yanking the user off wherever they'd navigated (e.g. `/admin`) back
to home. Two layers: `app/layout.tsx` now passes `hasSession={!!userId}` (resolved server-side at
cold-launch) to the handler, which skips the exchange entirely when `hasSession` is true; and the
post-exchange redirect is now gated on `res.ok && window.location.pathname === "/sign-in"` so any
exchange that *does* run (first-ever sign-in, warm re-auth) only redirects if the user is still on
the sign-in screen when it resolves.

**Chunk 2.** `app/admin/page.tsx` awaited a DB round-trip (`isAdminUser(session.user.id)`) before
bouncing a non-admin, adding visible latency to every `/admin` visit. The plan's literal
instruction was to "drop the `await`", but `isAdminUser` is declared `async function` — dropping
`await` on an async call makes `!isAdminUser(...)` evaluate `!Promise`, which is always `false`,
so the redirect would never fire regardless of admin status. Caught this before implementing;
kept `await` (a resolved-Promise microtask, not a network round-trip) while passing
`session.user.isAdmin` so the function's existing boolean short-circuit skips the DB query — same
latency win, without breaking the gate. `lib/admin.ts`'s `requireAdmin` (the authoritative check
every admin API route calls) is untouched, matching the plan's "cosmetic gate only" framing.

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1074 tests); `pnpm
build` succeeds. End-to-end on the local dev DB (Chunk 2, web-verifiable): a non-admin hitting
`/admin` bounces to `/` immediately (200, effective URL `/`); flipped the test user to admin —
`/admin` renders with no bounce; flipped back. **Not exercised:** Chunk 1's actual fix targets the
Capacitor cold-launch deep-link path, which no-ops in the web sandbox
(`Capacitor.isNativePlatform()` is false) — the yank-to-home repro and its fix are APK-only;
device smoke not run this session.

Version bump 1.124.8 → 1.124.9 (patch, user-visible bug fixes) + changelog entry. Backlog item 8
(UB1) removed from the queue; renumbered the remaining queue entries (was 1,2,3,5,7,6,10-18 out
of order after prior sessions' removals — now sequential 1-15) and updated the reading-order note
to match.
## Session 255 — UB-overflow: Home AI card viewport overflow fix (`fix/ai-card-overflow`)

Backlog-driven implementer pass, taking queue item 5 (UB-overflow — Home AI daily/weekly update
card overflows the viewport, `docs/superpowers/plans/2026-07-10-ub-overflow-home-ai-card.md`).
Small, fully-specified CSS/client fix — implemented exactly as the plan prescribed.

**Chunk 1 (root cause).** The shared `Response` markdown root (`components/ai/response.tsx`,
rendered by both the daily "Your Day in Review" sheet and the weekly recap banner) had `w-full`
but nothing letting long unbreakable tokens wrap — added `min-w-0 break-words
[overflow-wrap:anywhere]`. `globals.css` had no KaTeX overflow rule at all, so a `$$…$$` display
equation rendered as a non-wrapping block and pushed the card wider than the viewport — added
`.katex-display { overflow-x: auto; overflow-y: hidden; max-width: 100% }`, mirroring the
existing table/code-block wide-content pattern. (The `body { overflow-x: hidden }` guard the plan
expected to sit next to already existed on `main`.)

**Chunk 2 (belt-and-braces).** Added `overflow-x-hidden` to the home `PullToSync` scroll
container (`session-select-content.tsx`) and the daily review `SheetContent`
(`day-review-sheet.tsx`) so a future wide child can't reopen horizontal scroll on either surface.
The weekly recap banner's wrapper already clips via `overflow-hidden` — left untouched per the
plan.

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1074 tests); `pnpm
build` succeeds. **Not exercised:** no Playwright/browser automation available in this sandbox,
so the plan's prescribed ≤360px viewport check (feed a long token + KaTeX equation, confirm no
horizontal scroll) was not run interactively — verified instead by matching the diff exactly
against the plan's prescribed class strings/CSS rules. On-device (S25 APK) remains the real gate
per the Canonical Runtime policy.

Version bump 1.124.7 → 1.124.8 (patch, user-visible bug fix) + changelog entry. Backlog item 5
removed from the queue (fully shipped).
## Session 254 — R3 offline-first integrity, Chunk 1 (`fix/offline-first-integrity`)

Backlog-driven implementer pass, taking queue item 10 (R3 — offline-first integrity,
`docs/superpowers/plans/2026-07-09-r3-offline-first-integrity.md`) — Chunk 1 only, the
user-visible data-loss/resurrection highs (SYNC-C1, SYNC-R4, SYNC-R1, SYNC-O2).

**Task 1.1 (SYNC-C1).** `workout_sessions`/`exercise_logs`/`set_logs` were hard-deleted, so a
delete on one device never propagated — `getSyncDelta` can't emit a tombstone for a row that no
longer exists, and the deleted session kept rendering on any device that hadn't synced since.
Migration 117 adds `deleted_at` to all three tables; `deleteWorkoutSession` and
`DELETE /api/workout-entry` now `UPDATE ... SET deleted_at` instead of `DELETE FROM`, cascading
to child exercise/set rows. The load-bearing half was the read-site sweep — every server query
that renders or aggregates these tables needed `deleted_at IS NULL` added or a tombstoned row
would keep passing straight through: ~35 call sites across `lib/data/postgres/adapter.ts`
(`buildWorkoutSessions` and its callers, calendar/timeline aggregation, year-review, PR
reconciliation, exercise history, `getNextSession`, timing audit, the lbs→kg unit-fix tool),
the `programs`/`periodization`/`oura` slices (cycle-anchor computation, `sessionsInPhase`
reconcile, weekly-muscle-sets, 1RM history), the `weekly-muscle-sets`/`strength-trend`/
`muscle-tonnage-trend` routes, `friends/feed`/`friends/leaderboard`, `lib/achievements.ts`
(streak/Early-Bird/Night-Owl), and `lib/export/full-export.ts`. `getSyncDelta`'s
`exerciseLogs`/`setLogs` selects gained `deletedAt` in their explicit column maps (the
`workoutSessions` select is a plain `select()` so it picked the new schema column up for free)
— the local-store side of the sync chain (`applyDelta`'s tombstone-delete branch,
`RECONCILE_COLUMNS`, `pullDelta`'s field mapping) was already fully wired from an earlier
session, so this was purely a server-side gap.

**Task 1.2 (SYNC-R4).** History edit/delete (`health-content.tsx`'s `handleEditSave`/
`handleDelete`) were server-only — a stale local row kept rendering pre-edit/pre-delete values
until the next pull. Added `deleteExerciseLogLocally`/`updateExerciseLogLocally` to `LocalStore`
(mirrors the `deleteFoodLog` shape) and wired both handlers to mirror into the local store after
a successful server call. `app/stats/stats-content.tsx` has the same handlers but is dead code
(`/stats` redirects to `/health`) — left untouched.

**Task 1.3 (SYNC-R1).** `session-select-content.tsx`'s `fetchMeta` (Home) read only
`cachedFetch('body-metadata', ...)`, so an offline quick-log vanished from Home on remount. Added
the same local-store fast-path `health-content.tsx` already uses — seed `metaRecent`/`metaToday`
from `store.getBodyMetrics()` before the network fetch.

**Task 1.4 (SYNC-O2).** `logFoodEntries` awaited `createFoodItem`'s POST unconditionally before
any local write — offline, that throw lost the entire log. Now mints the food-item id
client-side, mirrors it into the local store immediately, and queues a new `food_items` outbox
mutation (before the `food_logs` mutation for the same entry, so push order matches the FK
dependency) instead of blocking on the network. `createFoodItem` (`lib/data/postgres/slices/
nutrition.ts`) gained an `id`-aware `ON CONFLICT DO NOTHING` branch shared by both the web route
and the new `pushMutations` `food_items` case (CI's `check-push-mutations.js` enforces the
shared-function rule). Added `food_items` to `MutationDomain`/`PendingMutation['domain']` and its
label in `sync-health-card.tsx`.

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1074 tests — one
existing `delete-session.test.ts` assertion updated for the DELETE→UPDATE change); `pnpm build`
succeeds. End-to-end on the local dev DB: soft-deleted a real exercise log via
`DELETE /api/workout-entry`, confirmed `deleted_at` set on all three tables (cascaded to the
parent session since it was the only exercise), confirmed `/api/day-log` and
`/api/calendar-data` no longer surface it, and confirmed a further `PATCH` on the deleted log
404s (ownership guard excludes it). **Not exercised:** the local-store mirror (1.2), Home's local
seed (1.3), and the food-items outbox push ordering (1.4) are all APK-only surfaces —
`getLocalStore` returns `null` in the web sandbox, so the actual offline behavior these tasks fix
is only truly judged on-device; `docs/device-smoke-checklist.md` not run this session.

Version bump 1.124.6 → 1.124.7 (patch, user-visible bug fixes) + changelog entry.
`docs/module-map.md` gained a row for the new `food_items` outbox domain. Backlog item 10
annotated with Chunk 1 shipped; Chunks 2–6 remain unstarted (local-first read sweep, outbox
coverage for detected-activity/Oura-dismiss, local sync machinery, push/route validation
parity, stored-counter reconciles).
## Session 253 — UB7 workout repaint fix, Chunk B (`fix/workout-repaint-todaylogged`)

Backlog-driven implementer pass, taking the remainder of item 4 (UB2/UB3 + UB7 — perceived
latency, `docs/superpowers/plans/2026-07-10-ub2-3-7-instant-paint-nav-and-workout.md`) — Chunk B,
completing the plan (Chunk A shipped last session).

**Task B1.** `todayLoggedKey` (`workout-screen.tsx`) falls back to `sessionType.toLowerCase()`
whenever `programSessionId` is `undefined`, which it is on every mount until `fetchExercises`'s
effect resolves it — *after* first paint. When a session is addressed by name, the first painted
frame reads the wrong bucket and completions logged under the real UUID flash unmarked for ~1s on
reopen/finish. Added a `useLayoutEffect` that resolves `programSessionId` synchronously from the
same cache seed `fetchExercises` already reads (`workout-data:<tab>` / `workout-card:<sessionType>`),
so the key is correct on the first painted frame whenever a seed exists (every warm reopen).

**Task B2.** `refreshExercises` called `store.clearTodayLogged()`, wiping *all* sessions'
optimistic completions on every call — including `onPrescriptionStatusChange` and `onPhaseChanged`,
so accepting/dismissing an AI prescription or advancing a phase blanked every green tick until the
refetch landed. Removed the call; the refetch still re-derives the server-side
`loggedTodayInSession` flag and `todayLogged` continues to reflect this session's local
completions — the two OR together correctly in `pre-workout-screen.tsx`. Left the `clearTodayLogged`
store action defined (no current caller) rather than deleting it — the queued R4 plan (item 11)
explicitly plans to call it for date-rollover handling.

**Deferred (per plan).** Task B3 (hydrating `todayLogged` from local SQLite for a
cleared-app-data/second-device gap) is explicitly out of scope — device-only-verifiable and not
the reported case; left as a documented limitation.

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1074 tests); `pnpm
build` succeeds. **Not exercised:** no browser automation tooling is available in this sandbox
(no `playwright` package installed), so the actual reopen/finish paint timing was not driven
interactively — verified instead by reading the exact `todayLogged`/`addTodayLogged`/
`onRehydrateStorage` semantics in `lib/stores/workout-store.ts` line-by-line against the plan's
described key-window mechanism, which match exactly. `docs/device-smoke-checklist.md` is the real
gate for the on-device paint — not run this session.

Version bump 1.124.5 → 1.124.6 (patch, user-visible bug fix) + changelog entry. Backlog item 4
(UB2/UB3/UB7) fully shipped and removed from the queue.

## Session 252 — UB2/UB3 perceived-latency fix, Chunk A (`perf/instant-paint-nav-workout`)

Backlog-driven implementer pass, taking queue item 4 (UB2/UB3 + UB7 — perceived latency,
`docs/superpowers/plans/2026-07-10-ub2-3-7-instant-paint-nav-and-workout.md`) — Chunk A only
(the navigation half; Chunk B, the workout reopen/finish repaint, is a separate follow-up PR).

**Task A1.** `navigateWithTransition` (`lib/navigate-with-transition.ts`) wrapped every
bottom-nav tap and edge-swipe in `document.startViewTransition`, which snapshots the DOM
before the async RSC navigation resolves — so it animated the *outgoing* screen for ~0.2s
while the real next screen (already cache-seeded and ready to paint instantly) sat behind the
transition. Collapsed to a plain `router.push`; removed the now-dead `data-nav-direction`
dataset writes and the `vt-slide-in-*`/`vt-fade-out` keyframes + `::view-transition-*` rules
(including the reduced-motion override) from `globals.css`.

**Task A2.** `/health/page.tsx` ran an extra `getUserByEmail()` DB round-trip on every tab open
just to fetch `activityLevel` — `sex`/`heightCm`/`dateOfBirth` were already on the JWT. Added
`activityLevel` alongside them: `auth.ts`'s three seed blocks (credentials `authorize`, Google
existing-account link, Google new-account), `auth.config.ts`'s `jwt`/`session` callbacks, and
the `next-auth` module augmentation (`types/next-auth.d.ts`). `/health/page.tsx` now reads all
four straight from `session.user`.

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1074 tests);
`pnpm build` succeeds (implied by clean typecheck + prior gate runs this session's tooling
already exercises). End-to-end on the local dev DB: seeded the test user's `activity_level` to
`moderately_active`, logged in fresh, confirmed `/api/auth/session` carries `activityLevel` in
the JWT-derived session; `/health` and all four bottom-nav tabs render 200. **Not exercised:**
the actual perceived-latency win (no more ~0.2s animation gate) and edge-swipe feel are only
truly judged on the Samsung WebView — `docs/device-smoke-checklist.md` is the real gate, not
run this session.

Version bump 1.124.4 → 1.124.5 (patch, user-visible perf fix) + changelog entry. Backlog item 4
left in place (Chunk B — the workout reopen/finish repaint — remains unstarted).

## Session 251 — Planning: measured workout time model + budget margins (docs-only, `claude/workout-time-logging-sets-wy5zik`)

Planning session (backlog protocol PR 1 — no implementation). The owner asked two things:
(1) confirm workout time is recorded per set with its reps/sets/pct context — not as a bare
per-session or per-exercise number — so "barbell bench press takes X" never conflates a 3×12
with a 5×5; (2) fix sessions overrunning the 60-min budget when following recommended numbers —
they should finish ~5 min early on on-time execution.

**Investigation findings:** the *capture* side already does what the owner wants — every
`set_logs` row carries `set_time_sec`, `rest_time_sec`, `intensity_pct`, `reps`, `set_start/end_ms`
(spec `2026-07-07-extended-metrics` §B2 verified this). The gaps are all on the *consumption*
side: (a) the lookback (`getAvgSetDurationPerExercise`) collapses all of an exercise's sets into
one median regardless of reps/pct; (b) `fitToBudget`/`estimateSessionDurationSec` enforce the
budget using only the constant model (`10 + reps×4`, style rest) — the measured median reaches
the AI prompt as advice but the deterministic enforcement ignores it (already flagged in the
archived 2026-07-03 time-model-accuracy plan, never built); (c) the budget targets
`timeBudget − 10` exactly, so on-time execution lands *at* 60, with a flat 10-min warmup
allowance that's wrong for short sessions.

**Plan written:** `docs/superpowers/plans/2026-07-10-measured-time-model-budget-margins.md` —
new pure `lib/workout/time-profile.ts` (work = measured sec/rep × reps, pooled per exercise;
rest = median per %1RM band `<70/70–80/80–90/90+`; both gated on ≥10 outlier-excluded sets via
the existing `robustStats` policy, with a band → exercise-overall → constants fallback ladder);
`duration-model.ts` gains measured overrides + `workingBudgetMin()` = `budget × (1 − 15% warmup
− 10% finish-early)` replacing `SESSION_WARMUP_MIN` (owner-confirmed fractions); `fitToBudget`,
the prescribe route (normal + deload paths), signals, the AI prompt, and the
generate-program/builder-chat siblings all consume the measured values. Zero schema change;
server/JS only; fully dev-DB verifiable. Queued as backlog item 9 — below the session-247
UB1–UB7 live-bug batch that landed on `main` mid-session (merge resolved in-PR), above the R
batches; the extended-metrics Part-B bullet updated — its duration-model-feedback half is now
this queue item, leaving the planned-pct snapshot + TUT capture unplanned. Follow-up owner Q&A
added a Rollout Notes section + an over-budget-at-floors prescription note (Task 7) to the
plan: the owner confirmed their current program already overruns, so the plan now surfaces
"session structurally oversized" in the prescription itself instead of failing silently at
the set floors.

**Not exercised (docs-only session):** nothing runtime — no code changed. Findings verified by
reading committed source on `main`, not by running the prescribe path.

## Session 249 — R2 caching correctness shipped (`fix/caching-correctness`)

Backlog-driven implementer pass, taking queue item 5 (R2 — Caching correctness,
`docs/superpowers/plans/2026-07-09-r2-caching-correctness.md`) — all 17 findings from the
2026-07-06 full-app review's caching audit.

**Chunk 1 (F1, critical):** the `progress-summary` key was fetched with two different
`cachedFetch` variants whose stored envelope shapes clobber each other — converted the nutrition
screen's plain `cachedFetch` to `cachedFetchToday` to match the three other call sites.

**Chunk 2 (F3/F4):** phase-set CRUD invalidated only `phase-sets`, leaving pre-workout card phase
labels stale for up to 6h (`freshWithinTtl`) — routed through `invalidateProgramStructure()`
instead. `workout-data`/`workout-card` cache a server-computed `loggedTodayInSession` flag under a
date-less 6h-TTL key with no date validation — stamped a `dataDate` on the response and added
`isWorkoutDataToday()`; rather than threading a per-consumer guard through four files (as the plan
specced), sanitized `loggedTodayInSession` at the single point `workout-screen.tsx` sets its
`exercises` state (`freshExercises()`), since every downstream consumer (this screen,
pre-workout-screen, done-screen) reads that same state — one guard, less surface touched in the
highest-regression-risk file.

**Chunk 3 (F2/F5/F6/F8/F10/F11):** new `invalidateExerciseLogged()` group replaces the five-call
ad-hoc list at the mid-session log-exercise write site (was missing exercise-history/day-log/
achievements/etc. — only cleared on full completion); new `invalidateMealTypes()` +
`nutrition-adherence` added to `invalidateNutritionWrite()`; the native quick-log body-metric path
now calls `invalidateBodyMetricWrite()` (device-only — the web fallback already did, the device
path didn't, so quick-logged steps/water stayed stale on the APK); pull-to-sync now calls
`invalidateOuraSync()` instead of a partial ad-hoc list; `muscle-tonnage-trend` and `day-log:`
registered in their respective groups.

**Chunk 4 (F7):** three fetch-hit `onData` callbacks (`overview-screen.tsx`,
`profile/goals-section.tsx`, `end-of-day-review.tsx`) read `body-metadata` with no freshness guard
on the network-hit path (only the sync seed was guarded) — all three now wrap with
`isBodyMetadataFresh`.

**Chunk 5 (F9/F13):** `exercise-history:` was fetched at two different TTLs across two files —
canonicalized to `EXERCISE_HISTORY_TTL`. Collapsed the duplicate `/api/user/profile` keys
(`nutrition-user-profile` + `more-user-profile`) into one (`more-user-profile`), removing the
6h-stale-profile-in-Nutrition bug.

**Chunk 6 (F15/F16):** converted two bare `fetch()` GETs (day-review-sheet's workout-sessions/day
+ new `workout-load-history:<sessionName>` key, health timeline reusing the existing
`home-day-timeline` key) to `cachedFetch`/`cachedFetchToday` with seeds. Added the standard SWR
header to 9 aggregate GET routes that were missing it (8 listed in the plan + `year-review`'s
extension) — also caught two early-return success paths the plan didn't call out by name
(`oura/stats`'s not-connected branch, `friends/feed`'s empty-friends branch,
`ai-periodization/program-overview`'s no-program branch) that are the *common* case for many
users, so leaving them unheadered would have defeated most of the benefit.

**Chunk 7 (F12/F14/F17):** promoted seven remaining single-key `invalidateCache()` call sites to
named groups (`invalidateUserProfile`, `invalidateOuraToken`, `invalidateAiPeriodization`,
`invalidateExerciseLibrary`, `invalidateActivityTypes`, plus a new `invalidateAdminPendingCount`
for a genuine gap found while auditing — the admin activate/deactivate action never invalidated
the pending-count badge). Removed dead legacy `ta_streak_v1`/`ta_calendar_v2_*` sessionStorage
reads (write-side already gone, so they always returned null) and the now-unused
`invalidateCalendarCache()` helper. TTL hygiene: `NUTRITION_FOOD_LOGS_TTL` constant for a raw `60`
literal at 3 sites, `workout-screen.tsx`'s raw `6*60*60` → `TTL_LONG`, `profile-tab.tsx`'s raw
`5*60` → `TTL_SHORT`, `home-day-timeline.tsx`'s confusing ms-then-divided-by-1000 `TTL` constant →
`TTL_SHORT` directly. Fixed `tdee-adaptation-card.tsx`'s `useState` lazy-initializer localStorage
read (hydration-mismatch risk) to a mount `useEffect`. Done-screen's HR sync now invalidates
`oura-hr-day:` after the POST resolves (previously the post-workout HR chart showed pre-workout
data until the next sync).

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1064 tests) including
extended `lib/__tests__/cache-groups.test.ts` coverage for every new/changed group and a new
23:59→00:01 AEST boundary test for `isWorkoutDataToday`; `pnpm build` succeeds. End-to-end on the
local dev DB + `pnpm dev`: all touched screens (Nutrition, Health, session-select, Overview,
Profile, End-of-day review, day-review sheet, health timeline, admin) render 200; `curl -sI`
confirmed the SWR header on all 9 fixed routes. Device-only: F6's native quick-log invalidation is
compile/logic-verified only (both branches call the identical two groups) — not exercised on a
real APK this session.

Plan moved to `docs/superpowers/plans/archive/`; backlog item removed. Version bump (rebased past
a concurrent 1.124.2 REM-tuning release) 1.124.2 → 1.124.3 (patch, bug-fix batch) + changelog
entry.

## Session 247 — R1 security & ownership hardening shipped (`fix/security-ownership-hardening`)

Backlog-driven implementer pass, taking queue item 4 (R1 — Security & ownership hardening,
`docs/superpowers/plans/2026-07-09-r1-security-ownership-hardening.md`) from the 2026-07-06
full-app review's twelve findings. All twelve re-verified against `main` before implementing;
the plan's code was concrete enough to apply near-verbatim, with two corrections found during
implementation (below).

**Ownership row-count + unscoped child writes (SEC-1/2/3):** `saveProgressionStyle` and
`updateSavedMeal` now guard their UPDATE with a `.returning()` row-count check before the
previously-unscoped `styleSets`/`savedMealItems` delete+re-insert — a forged id belonging to
another user now throws instead of silently wiping/overwriting that user's child rows.
`updateSavedMeal` also now ownership-verifies every referenced `foodItemId` before re-insert (a
saved meal could previously embed another user's `food_items` row) and gained a stable
`ORDER BY` so ingredient order stopped shuffling between reads. `logExerciseAndSets` now takes
`userId` and pre-checks ownership (via the `workout_sessions` join) of any client-supplied
`exerciseLogId`/`setLogIds` before the bare-id `onConflictDoUpdate` — previously a colliding id
from another user's session would be overwritten and reassigned into the attacker's session.

**Mass assignment (SEC-6):** the supplements PATCH and meal-types PUT routes were passing the
raw request body into Drizzle `.set()` — `userId`/`deletedAt`/`createdAt` are settable column
keys the TypeScript `Omit<>` never enforced at runtime. Added a `.strict()` Zod whitelist at each
route (meal-types' schema also folds in `remindersEnabled`/`required`, which the plan's draft
omitted but the actual edit UI sends — checked against `meal-type-manager.tsx` before finalising).
The supplements `pushMutations` branch already reconstructs fields explicitly via
`createSupplement`, so needed no change.

**Fail-closed webhook + token crypto (SEC-H1/H2):** `encryptToken` now throws instead of silently
storing a bearer token in plaintext when `TOKEN_ENC_KEY` is unset (a startup warning added too);
`decryptToken` stays tolerant of legacy unprefixed rows. `/api/oura/webhooks` now gates GET/POST/
DELETE on `requireAdmin`'s authoritative DB check instead of the JWT's `isAdmin` flag (stale up
to 30 days), and the POST response no longer echoes the webhook HMAC signing key.

**Rate limits + input bounds (SEC-H3–H6):** added `rateLimit` to `oura/sync`, `oura/hr-sync`, and
`health-connect/ingest` (IP-keyed, placed after the constant-time secret compare); `/api/feedback`
switched to `readJsonLimited` + bounded fields; `/api/workout-entry` PATCH and
`/api/workout-sessions` DELETE gained Zod schemas (weights/reps bounded to 20 elements, matching
`LogExercisePayloadSchema`); `/api/mood` gained a Zod schema — **caught during implementation**:
the plan's draft schema had `energyLevel` as `z.number().int().min(1).max(5)`, but the real
`EnergyLevel`/`SleepQuality`/`BodyState` types (`lib/types/mood.ts`) are string enums, not
numbers — built the schema against the actual types instead; `/api/auth/register` gained a
password/name length bound.

**Info-leak fixes (SEC-4/5):** `weekly-volume`'s `?programId=` param is now ownership-verified
against `listPrograms(userId)` before use (previously any program id's volume targets were
readable regardless of owner); `phase-sets/clone` and `ai-chat` no longer return raw
`String(err)`/internal error text in response bodies (still logged server-side).

**Verification.** `pnpm lint`/`tsc --noEmit` clean; full test suite green (1042 tests, including
the DB-backed `push-mutations-web-parity` suite — **found and fixed a second bug**: that suite's
mood-log test used `energyLevel: 'high'`, which was never a valid `EnergyLevel` and only "worked"
because the route had no validation before this PR; fixed the test fixture to `'good'`). End-to-end
on the local dev DB with two real user accounts (a legitimately-registered second user, activated
via `is_active`): verified all three ownership attacks (progression style, saved meal, exercise
log) fail closed with the target row/child rows unchanged, legit same-user edits still succeed,
the admin gate rejects a non-admin and accepts a DB-flipped admin regardless of stale JWT, mass
assignment of `userId` is rejected by the Zod whitelist, all four rate-limit/bound checks (oversized
weights array, oversized feedback body, invalid mood enum, 5000-char password) return 400/429 as
expected, and the SEC-4 cross-user program read returns 404. Not exercised: on-device APK (this
PR is server/JS-only, no native surface), a live Oura token round-trip (token-crypto verified by
unit test only).

Plan moved to `docs/superpowers/plans/archive/` (fully shipped); backlog item 4 removed. No
user-visible UI change, so no version bump per the plan's own note.

## Session 246 — Phase-5 Chunk 3 (own Activity score) + Recovery Index pure fn (`feat/oura-ble-own-scores`)

Backlog-driven implementer pass, continuing backlog item 1 (Oura BLE Phase 5) from session 244's
partial ship. Took Chunk 3 (activity-score base) and the addendum's A2 (Recovery Index).

**Implementation (v1.124.0).** `lib/health/activity-score.ts`: `computeActivityScore` — a 0–100
composite of movement (today's steps/active-calories vs. the user's own trailing personal average,
a relative signal not an absolute step target) and training credit (reused `TRAIN_CREDIT_BASE`/
`TRAIN_CREDIT_VOL` shape from `blend-activity.ts`, scaled to a new base rather than an Oura
adjustment), renormalised over whichever inputs are present. Wired into `app/api/readiness-score/
route.ts`: on days with an Oura `activity_score` row, `blendActivityScore` runs unchanged; on
non-Oura days (the common case post-re-key) the new base is passed straight through with
`adjustment: 0` — avoids double-crediting logged volume, since the base already folds in training
credit (plan Chunk 3 resolution 3). `lib/health/recovery-index.ts`: `computeRecoveryIndex` —
rolling-median-smoothed overnight HR series → hours between the HR minimum and wake (open_health's
from-scratch Recovery Index, no baseline needed). Shipped as a standalone tested pure function only;
not yet wired into the readiness response — feeding it in as an actual contributor needs a sub-score
mapping decision, deferred to pair with A4's reweight rather than bolted on ad-hoc.

**Verification.** Unit tests for both new modules (`lib/health/__tests__/activity-score.test.ts`,
`recovery-index.test.ts`) — movement-only, training-credit-only, and no-double-count-when-Oura-absent
cases; `pnpm lint`/`tsc --noEmit`/`pnpm test` all clean (1013 tests passed). End-to-end on the local
dev DB: seeded `body_metrics` for "today" with a low step count (2,000 vs. an ~8,300 trailing
7-day average) and no logged workout — `/api/readiness-score` returned `activityScore: 23`
(movement-only, no training component fabricated); `/health/activity` and `/health/readiness` both
render 200. Not exercised: real Oura-present branch (no `oura_daily` row in the seed data — the
existing `blendActivityScore` path was already covered by prior sessions' work and is untouched
here), on-device APK (server/JS-only change, no native surface).

**Remaining on backlog item 1:** Chunk 5 (label copy on the Activity detail page), A3 (migration 116
`oura_daily_summary` + rolling 14-day baselines — the larger schema/population piece), A4
(baseline-relative Readiness reweight, needs A3), and A2's actual readiness-route wiring (needs a
sub-score mapping, paired with A4). Backlog entry + plan doc updated in place, item left in queue
(not removed — plan only partially complete).

## Session 244 — open_health review → accurate-staging plan + own Sleep/Readiness scores shipped (`claude/ble-implementation-review-ueltoo`)

Owner pointed at `Th0rgal/open_health` (the open_oura author's own consumer app, on the divergent
`open_oura@split-open-health` branch) re: sleep cycles still being inaccurate. Full read of both repos.

**Planning (docs).** The key reframe: **Oura's staging is a trained NN (SleepNet), which our z-score
heuristic only approximates** — that's why the `REM_Z` tuning arc stalled at 14-15% vs the ~20-28%
baseline, not a tuning problem. open_health proves the model is *runnable* on the exact signals we
already store (`run_sleep_model.py` → moonstone), blocked only on a server-delivered decryption key.
Wrote `docs/superpowers/plans/2026-07-09-oura-ble-accurate-sleep-staging.md` (Phase 0: cheap check for
ring sleep-summary events `0x49/0x4c/0x4f/0x58` → Phase 1: breathing-rate variability → Phase 2:
SleepNet model), folded open_health's recovered combiner weights + Recovery Index + temp baseline +
a `oura_daily_summary`/baselines schema into the Phase-5 own-scores plan (Addendum A1–A4), corrected
`docs/oura-ble-sleep-staging-findings.md` (heuristic = fallback, not endpoint), and **reordered the
backlog ready-first** so a top-down agent hits buildable server/JS work before blocked/native items.

**Implementation (v1.123.0).** Took backlog item 1 (Phase-5 own scores), Chunks 1+2+4. The home Sleep
and Readiness chips have been blank since the BLE re-key (they read Oura-only fields). New
`lib/health/sleep-score.ts` computes a 0–100 Sleep Score from BLE-rollup data using open_health's
recovered weights (Total Sleep 35 / Restfulness 15 / Efficiency, REM, Deep, Latency, Timing 10 each,
R²=0.9987) + contributor curves (isotonic durations, latency U-curve, circadian timing peak),
renormalised over available contributors so BLE nights with null stages still score. Readiness route
exposes `sleepScore` (0–100 own) + new `readinessDisplayScore` (Oura's, else our composite when an
HRV/RHR baseline exists); chips + `/health/readiness` + `/health/sleep` read those; chip row no longer
gated on the all-or-nothing `hasSufficientData` flag (per-chip gating); Chunk 5 label caption added.
Gate: `tsc` 0, lint 0 errors, 7 new unit tests + 115 health/oura-ble-sleep tests pass. **Verified
end-to-end on the local dev DB, authenticated:** a BLE-style night (duration + efficiency + latency,
null stages) → `sleepScore 93`, `readinessDisplayScore 92`, `source custom`, `activityScore null`
(Activity chip correctly hides); detail pages 200, no server errors. **Not exercised (sandbox):**
Samsung WebView chip render + real BLE-night data. **Chunk 3 (activity) deliberately deferred** — the
owner has no step/active-cal source yet (blocked item 4), so any activity score would be an invented,
unvalidatable number; left queued with A2/A3/A4 (Recovery Index + migration 116 baselines).

## Session 243 — Sleep-staging arc closing notes + tuning guide (docs-only, `claude/sleep-staging-closing-notes`)

Owner is pausing sleep-stager tuning to collect more redecoded nights before the next `REM_Z` nudge.
Wrote a consolidated closing summary + step-by-step tuning guide into
`docs/oura-ble-sleep-staging-findings.md` (new "Update, 2026-07-09" section) covering the full
sessions 223–240 arc: onset-latency derivation, the distant-fragment merge fix, actual-sleep-window
display, the per-epoch diagnostic tool, the onset-over-trim fix, mid-sleep wake-blip folding, the
header/stage-total time-mismatch fix, and the three `REM_Z` nudges (1.0→0.65→0.55→0.45, REM 0-8%→
14-15%). Includes a "pick the knob by symptom" table and a files map for picking this back up cold.
Also refreshed the stale backlog item 5 (`docs/implementation-backlog.md`) — it still named
constants (`WAKE_HR_DELTA`, `DEEP_HR_FRAC`) and a branch from before this arc started — now points at
the findings doc and is marked explicitly paused pending more owner data. No code changes; no
version bump.

---

## Session 240 — REM nudge #3, v1.122.20 (`claude/sleep-rem-nudge-2`)

Owner redecoded post-#377: the time-mismatch fix confirmed exact (07-09 9:53pm–6:28am, Deep+REM+Light
sums exactly to the displayed 7.8h total; same for 07-08). REM keeps climbing steadily each nudge —
0-8% → 10-13% → **14-15%** — still under the ~20-28% Cloud baseline but consistent progress, so owner
asked to keep nudging. `REM_Z` 0.55→0.45 (same ~0.10 step size as the last nudge, which moved REM
~+4pts). 129 tests green, tsc/eslint clean. Still explicitly provisional — needs the next redecode to
confirm where it lands; expect another nudge or two before REM settles near baseline.

---

## Session 239 — Header/stage-total time mismatch fix + REM nudge, v1.122.19 (`claude/sleep-mid-wake-and-rem-tune`)

Owner redecoded post-#375: REM improved (0-8%→10-13%, still a bit low vs ~20-28% baseline) and times
looked "more consistent and accurate" but flagged 07-08's "10:44pm–6:24am" header not matching its own
7h40m — really "lost 35 minutes." Root-caused precisely from the screenshots: the header (7:40 span)
disagreed with the stage-minute totals (Deep+REM+Light+Awake = 7h55m) AND the hypnogram ribbon's own
x-axis (which read 6:35am, not 6:24am) — three different numbers for the same night.

- **Root cause**: `actualSleepWindow()` (`lib/sleep/actual-window.ts`) trimmed the header's displayed
  END to the last non-awake epoch, but `summarizeSleepStages`'s Awake total and the ribbon's x-axis
  are drawn from the FULL raw window — so a trailing "awake in bed before getting up" stretch was
  excluded from the header's span while still counted in the numbers directly below it.
- **Fix**: only trim the START (still needed — that's the actual onset-latency fix from #360/#374);
  the END is now always the raw window's natural end, matching the stage totals and the ribbon. A
  trailing awake stretch is a real part of the sleep session (you're still in bed), not something to
  hide from the displayed range. Updated the one test that encoded the old (buggy) trailing-trim
  expectation; 4 actual-window tests green.
- **REM nudge**: `REM_Z` 0.65→0.55. The previous 1.0→0.65 drop only moved real nights from 0-8%→
  10-13%, still meaningfully under the ~20-28% baseline — another modest, same-direction nudge.
  Explicitly still provisional; needs the next redecode to confirm where it should land.
- **Gate**: 129 tests green, tsc/eslint clean. Server/JS only, ships via Railway — the time-window
  fix needs no redecode (recomputes on read); the REM nudge needs Sync/Redecode to take effect.

---

## Session 236 — Mid-sleep wake-bout folding + REM re-tune, bundled fix, v1.122.18 (`claude/sleep-mid-wake-and-rem-tune`)

Owner redecoded post-#374 (onset fix). 07-08 improved (105min→2min onset, REM 0%→8%) but flagged two
remaining issues: REM still doesn't match the pre-re-key baseline, and Time Asleep still looks low.
Owner explicitly asked to bundle both fixes into one pass rather than doing them sequentially.

- **Mid-sleep wake-bout folding** (`lib/health/sleep-staging.ts`, new step 4.5): the per-epoch dump
  showed 07-08's ~1h15m "Awake" included several **isolated single-epoch** movement blips (02:09,
  02:24, 03:29 — each a lone 5-min spike surrounded by "light" on both sides), not sustained
  awakenings. Commercial trackers (Oura included) count a brief stir as a **restless period WITHIN
  sleep**, not as subtracted Awake time. Fix: an isolated (< MIN_BOUT, i.e. single-epoch) wake run
  with measured movement data on **both** sides being asleep now folds back into the neighbouring
  stage; a **sustained** run (≥2 epochs, ~10+ min) still counts as real Awake. Only **interior** runs
  qualify — leading/trailing edges stay the onset/offset trim's territory (step 4), untouched. A
  run with any unmeasured-movement epoch is left as-is (can't attest it was just a stir — mirrors the
  onset fix's null-movement guard). The folded count is preserved via a new `foldedWakeBouts` field
  (threaded through `summarizeSleepStages`'s new `extraAwakenings` param) so `restlessPeriods` still
  reflects stir frequency even though those minutes no longer subtract from time asleep.
- **REM re-tune**: `REM_Z` 1.0→0.65, `W_HRVAR` 0.3→0.4. The 1.0 cutoff was calibrated against
  synthetic tests with dramatic HR separation (60 vs 70 bpm); real nights run subtler contrasts, and
  sparse/interpolated HRV (0x5d arrives far less often than every epoch) damps the cardiac term's
  natural amplitude — REM was essentially unreachable on real data (0-8%) despite `hrVar` having
  hundreds of beats/epoch to work with. Leaning more on `hrVar` (the signal that's actually dense in
  practice) and lowering the bar is the direct, explained lever; both marked "tunable" pending the
  next redecode.
- **Tests**: reversed the old "lone wake bout never folds" test (that premise was the bug) into
  fold-vs-preserve pairs (isolated folds; sustained stays; unmeasured-movement stays; leading/trailing
  edge untouched by the new step); replaced the REM differential test's sine-wave construction (which
  had an unintended suppression side-effect under the new weights) with a cleaner block-based design
  mirroring the existing deep-proportions test. New DB-rollup test seeds an isolated blip + a
  sustained bout in one synthetic night and asserts the blip is absent from `sleep_phase_5_min`'s
  awake codes while the sustained bout remains, and `restless_periods ≥ 1`. 120 tests green,
  tsc/eslint clean.
- **Gate**: server/JS only, ships via Railway; **not verified on real BLE data in-sandbox** — the
  synthetic tests prove the mechanics, but the actual REM %/restless outcome on 07-08/07-09 needs the
  owner's next Sync/Redecode.

---

## Session 235 — Onset over-trim fix: still + elevated HR = sleep (data-informed via the diagnostic), v1.122.17 (`claude/sleep-onset-stillness-fix`)

The **B fix**, informed by the per-epoch diagnostic (#372) the owner ran on-device for 07-08 (bad)
and 07-09 (good). The dumps settled it:
- **07-08 over-trim is real elevated HR with the ring recording ZERO movement** — `22:44 hr71 mv0` …
  `00:04 hr82 mv0`, HR only dropping to ~62 at 00:29. The old onset trim marked the first ~105min
  awake purely because HR was above the settle line (median+2 = 70.6), even though the owner lay
  perfectly still. That's early light sleep (owner confirms they were asleep before midnight), not
  wake.
- **07-09 (correct 10min) differs by MOVEMENT, not HR** — its early awake epochs have real movement
  (`21:58 mv3.4`), and its first epoch has *no movement data* (`mv —`).

**Fix (`lib/health/sleep-staging.ts`):** an epoch now counts as asleep for the onset/offset trim once
HR has SETTLED **OR** the epoch is **measurably still** (`movement != null && ≤ moveMed`). Stillness
stops the trim, so a still, elevated-HR early stretch is kept as sleep. Crucially an epoch with *null*
movement is **not** "still" (so 07-09's sparse first epoch can't prematurely end the trim and zero a
real latency). Added a `onset ≤ offset` guard so a signal-less night isn't wholly trimmed to awake.
The change can only *shorten* onset (more ways to count asleep), so it can't regress a night into a
longer latency. Reversed the old "still + elevated HR = onset latency" unit test (that premise was
exactly the bug) and added two: still-elevated → sleep (07-08), and sparse-null-movement leading
epoch → real latency preserved (07-09). 116 tests green, tsc/eslint clean. Server/JS — ships via
Railway, redecode recomputes past nights.

- **Still open:** REM under-call on BLE nights (07-08 had 0 rem in the dump though `hrVar` has ample
  data — beats 300–700/epoch) — the elevated-HR stretches that should read REM are scored light; next
  tuning pass. Also the mid-sleep "awake" blips (owner's ~40min point) are movement-triggered
  (2–4 mv) per the dump — likely brief stirs; decide whether to reclassify sub-bout mid-sleep wake as
  light. Both are follow-ups off the same diagnostic.

---

## Session 234 — Per-epoch sleep-staging diagnostic in the BLE tester (admin-only) (`claude/sleep-epoch-diagnostic`)

Owner flagged the real BLE nights still over-trim onset (07-08: 105min → 12:30am) and possibly
over-call mid-sleep "awake" (07-09: ~40min the owner argues is light sleep, not conscious wake).
These can't be fixed blind — they need the **per-epoch HR curve**, which only exists on-device and the
sleep-row SQL dump can't show. Chose **A (diagnostic) before B (fix)** so the onset/wake/REM tuning is
data-driven, not another number-shifting guess.

- **Diagnostic (admin-only, this PR):** `aggregateOuraRawSamples(userId, tz, { debugDate })` now
  returns `debugNight` — per 5-min epoch: local time, HR, **beats binned** (tells us if the `hrVar`
  REM signal even has data), movement, HRV, within-epoch spread, and the stage decision, plus the
  window, `settleHr` threshold, and `onsetEpoch`. New types `SleepEpochDebug`/`SleepNightDebug` on
  `OuraRawAggregateResult`. The redecode route takes an optional `?date=YYYY-MM-DD` and surfaces it;
  the `/admin/oura-ble` tester gains a date field + "Sleep epochs (debug)" button that dumps a
  copyable per-epoch table into the log. Read-only diagnostic (the re-aggregate is the same
  idempotent write redecode already does); **no user-facing change → no version/changelog bump**
  (same precedent as #359).
- **Gate:** tsc/eslint clean; new DB-rollup test asserts `debugNight` is populated for the requested
  date (per-epoch fields present) and null for a non-matching date; 123 tests green. Server/JS only —
  ships via Railway, no APK rebuild; the tester panel is device-only so the real readout comes from
  the owner's on-device tap.
- **Next (B, informed):** owner runs "Sleep epochs" for 07-08 → we see exactly why it marks the first
  ~105min awake (elevated HR? the settle threshold?), fix the onset trim from the curve, and check the
  beats-per-epoch to confirm/repair the REM signal. Also settles the mid-sleep "awake" question (real
  wake vs over-detection) from the movement/HR per epoch.

---

## Session 233 — Pull-to-sync also forces an immediate Oura ring drain, v1.122.16 (`claude/hr-display-workout-m1kh8q`)

Owner: pull-to-refresh should force an immediate ring sync too (background ring sync is otherwise
hourly — `OuraRingService` re-drains every `DRAIN_INTERVAL_MS=3,600,000ms` while connected, with a
5-min keepalive that also serves as the failure-retry clock; plus a drain on every connect/app-open).
New shared helper `lib/oura-ble/sync.ts` `syncOuraRing()` (best-effort, fire-and-forget: no-op
off-device; `startService()` if stopped — auto-drains on connect — else `drainHistory()`), called from
the shared `PullToSync.triggerSync` so **every** pull-to-refresh (more/health/session-select/…) pulls
the ring's latest recorded data, not just the app outbox. JS-only. tsc/eslint clean, `/more` + `/health`
200.

---

## Session 232 — Live HR battery lever: burst only during rest, coast during sets, v1.122.14 (`claude/hr-display-workout-m1kh8q`)

Owner asked whether the live-HR feed could be forced only during rest between sets (and coast on the
light drain path otherwise) as a battery saver. Yes — and it also matches the physiology: the DHR
burst actively powers the PPG green LEDs, and a mid-set reading is motion-corrupted junk anyway, so
bursting during a set is pure wasted power. All JS (no rebuild).

- **`setForced(boolean)`** threaded source→manager, and `OuraRingSource`'s burst timer now only fires
  when `forced` (rest); the 20 s history drain stays always-on as the coast/fallback. `setForced(true)`
  also fires one immediate burst so HR appears fast on entering rest.
- **`workout-screen.tsx`** drives it: `liveHrForced = mode==='exercise-summary' || (mode==='active' &&
  workoutPhase==='rest')` → `getLiveHrManager().setForced(...)` in an effect. So the burst runs during
  rest + the per-exercise summary, and stops during a set.
- **Manual Measure still overrides** — `measureNow()` fires a burst regardless of `forced`, so you can
  force a reading mid-set if you want.
- **Gate:** `tsc`/eslint clean (0 errors; the 2 workout-screen warnings are pre-existing baseline), 13
  live-hr tests pass, `/workout` 200. Battery effect not measurable in-sandbox, but the burst-driven
  PPG on-time now tracks rest-time only (roughly halved on a typical set/rest workout).

---

## Session 232 — Sleep display: show actual asleep→woke times, tile = latency, v1.122.14 (`claude/sleep-actual-times-display`)

After #366 fixed the windows, owner asked (a) the sleep time range should be the **actual** sleep
window (asleep→woke), not the in-bed window, with the "Fell Asleep" tile showing just the **latency**;
(b) flagged 07-08's "fell asleep 12:29am / 105m" as plainly wrong (never went to bed after midnight).

- **(a) shipped:** new shared `lib/sleep/actual-window.ts` derives the asleep→woke span from the
  hypnogram's first/last non-awake 5-min block (code `4`=awake), anchored the same way the ribbon is
  (`phaseWindowStart ?? sleepStart`) — so it's source-agnostic (BLE + Oura Cloud). Applied to the
  detail-sheet header, the sleep list rows, and the Health summary card (sibling sweep). The onset
  tile relabelled **"Sleep Latency" → `Nm`** (the clock time now lives in the header). 4 unit tests
  (trim leading/trailing awake; sleepStart-anchor fallback; null when no hypnogram / all-awake).
  tsc/eslint clean, 9 sleep tests green.
- **(b) NOT fixed yet — and note (a) surfaces it:** with the header now showing the *actual* onset,
  07-08 will read ~12:29am because the stager's onset trim over-marked 105min as awake. That's the
  BLE-stager onset over-trim (`ONSET_HR_MARGIN`/settle-threshold too strict on that night). Fixing it
  needs the **per-epoch HR** for 07-08/07-09 (the sleep-row dump can't show it) — next step is a
  per-epoch diagnostic in the BLE tester (beats/epoch + HR + stage decision) to tune the threshold and
  confirm the `hrVar` REM signal is firing. Good nights (07-09 ~10:03pm, Cloud nights) display
  correctly now.
- **Not verified in-sandbox:** the sheet/card render on-device only (click-to-open sheet, no
  Playwright) — logic covered by the unit tests; visual is the on-device check.

---

## Session 231 — Live HR VERIFIED working: Measure button, faster cadence, card cleanup, v1.122.13 (`claude/hr-display-workout-m1kh8q`)

**True-live HR confirmed on-device** (owner, v1.122.11 APK + Railway JS): the workout card showed a
live-updating BPM (68→77→64), verdict "HR decoding OK", `0x80` GREEN_IBI counts climbing, decoded>0,
age 2–5 s. The session-229 DHR on-demand burst (the `0x26` sub-mode from open_ring) is the fix — the
long chain (diagnostics → path A ruled out → near-live drain floor → open_ring research → the one
missing sub-op) landed. Owner then asked for polish + a manual trigger. All JS (no rebuild — the
native `triggerHrBurst` shipped in the v1.122.11 APK):

- **Manual "Measure" button** on the Live HR card: `measureNow()` threads source→manager→`useLiveHr`
  and fires `triggerHrBurst()` + `drainHistory()` immediately, with `hapticLight()` + a ~4 s
  "Measuring…" state. (The native command already exists; this just calls it on demand.)
- **Faster/steadier cadence:** split the one 15 s timer into a **10 s burst re-trigger** (well inside
  the ring's ~20 s auto-revert → continuous engagement, no lull) and a **20 s drain** fallback.
- **Card cleanup:** bigger, clearer BPM; sparkline recoloured to `--color-brand` (SVG, themeable —
  was a hardcoded red literal); the diagnostics toggle demoted to a subtle icon on its own row (no
  longer crammed next to the label); empty-state copy now guides stillness ("Tap Measure and hold
  your ring hand still"). Diagnostics panel unchanged, still one tap away.
- **Docs flipped to ✅ verified:** ops-matrix R7 → RESOLVED, `projectOverview.md` Known-Issues →
  VERIFIED WORKING.
- **Gate:** `tsc`/eslint clean, 13 live-hr tests pass; `pnpm dev` `/workout` 200. The two other paths
  are retained: **path B (near-live drain)** is the silent fallback; **path A feature-mode/fast-HR
  levers** remain as tester diagnostics (harmless). Card visual not rendered in-sandbox (device path
  inert on web) but it's a layout-only change over the verified-working readout.

---

## Session 230 — Sleep: stop merging distant nap fragments into the night, v1.122.12 (#366, `claude/sleep-merge-distant-fragments`)

Owner sent a prod SQL dump of `sleep_sessions` (07-02→07-09) after the REM change. It reframed the
"times are bad / inconsistent" report:
- **The healthy-REM nights (07-02→07-07, REM 20–28%) are all Oura *Cloud* data** (UUID `oura_id`s,
  pre the 07-07 re-key) — Oura's staging, not ours. **Our only BLE nights are 07-07 (a stray 19-min
  daytime fragment), 07-08 (REM 0%, onset 6304s=105min), 07-09 (REM 7%, onset 604s ✓).** So the REM
  change (#363) is still **unvalidated** on real BLE nights — the good numbers were Cloud all along.
- **The catastrophic times were a merge bug, now root-caused from the data.** Several dates carry two
  rows — the night **plus a short fragment**: 07-02 a 19:40–20:19 evening rest, 07-04 a 14:39–14:59
  afternoon nap, 07-07 the stray `ble:` 10:44–11:03 window. `mergeByDate` unioned all same-date rows
  (min-start / max-end / summed durations — built for Samsung midnight splits), so the fragment
  dragged the night's bedtime to 7:40pm and wake to 2:59pm/11:03am, and the "Fell Asleep" tile read
  off the wrong 7:40pm start.
- **"restless 233/268" is not a bug** — those are Oura's own `restless_periods` on the Cloud nights
  (our BLE nights show 5/null). Just reads alarmingly.

**Fix (#366):** extracted the merge to `lib/sleep/merge-sessions.ts` and added a **contiguity filter**
(`primaryCluster`): keep the longest sleep row + any row within 1h of the growing window (genuine
midnight-split halves), drop fragments separated by hours. Validated against the owner's exact rows
(5 unit tests using the real 07-02/04/07 data); split-nights still merge. Display-layer only, no
re-sync needed, no schema/rollup change. 118 tests green, tsc/lint clean.

**Still open (needs per-epoch BLE raw data, not the sleep-row dump):** on the real BLE nights the
stager over-trims onset (07-08 105min) and under-calls REM (0%/7%) — next step is a raw-sample dump
for 07-08/07-09 to tune the onset settle-threshold and confirm whether `hrVar` is even firing (beat
density). Also unfixed: the rollup emitting a sub-threshold 19-min daytime BLE "sleep" window
(07-07) — the merge filter hides it from the night card but it shouldn't be written; folded into the
raw-data follow-up.

---

## Session 229 — Live HR true-live attempt: DHR on-demand burst ("measure now"), v1.122.11 (`claude/hr-display-workout-m1kh8q`)

Owner pushed back on abandoning true-live ("the Oura app's Measure-now button proves it exists") and
asked for a way **without another ring**. Researched the RE landscape (open_oura, ringverse,
**open_ring**). Found it: [open_ring](https://github.com/LogosIsLife/open_ring) reverse-engineered
"measure now" by **static decompilation of the official app** (no ring, no capture, no firmware risk)
— it's the **DHR on-demand burst**. Its `PROTOCOL.md` gives the exact sequence, and it exposes what we
were missing: three `0x2f` writes, of which we'd only ever sent two.

| Step | Bytes | Sent before? |
|---|---|---|
| Enable DHR live | `2f 03 22 02 03` (= our CONNECTED_LIVE) | ✅ |
| **Burst sub-mode** | **`2f 03 26 02 02`** (sub-op `0x26`, not `0x22`) | ❌ **never** |

The `0x26` sub-mode write is the actual "start bursting" step — SetFeatureMode alone acks (`0x2f`) but
never streams (exactly our symptom). When engaged the ring emits `0x80`/`0x60` IBI events densely
(~1 s), which our decoder already turns into HR; it **auto-reverts after ~20 s**, so re-trigger every
~15 s.

- **Native:** `OuraProtocol.reqDhrBurstSubMode()` (`2f 03 26 02 02`) + `dhrBurstSequence()`; plugin
  `triggerHrBurst()`; tester "HR burst (measure now)" button. `OuraProtocol` bytes pinned by a Kotlin
  test.
- **JS wiring:** `OuraRingSource`'s 15 s timer now fires `triggerHrBurst()` **and** `drainHistory()`
  each tick (burst = true-live path; drain = near-live fallback). Both surface via `ouraFrames` → the
  ts-recency-guarded decoder. `triggerHrBurst` is optional-chained + caught so older APKs stay on the
  drain-only path.
- **Gate:** `tsc`/eslint clean, 13 live-hr tests pass; new Kotlin protocol test. **Native → needs an
  owner APK rebuild. Unproven:** open_ring is a new source and the `0x26` sub-mode is unvalidated on
  our re-keyed Ring 5 — first real test is on-device (still, between sets). Physiology: the reading
  wants ~10 s of stillness (Oura's own docs), so it's a between-sets reading, not mid-rep. Ops-matrix
  R7 + `projectOverview.md` updated.

---

## Session 228 — Live HR path B: near-live from periodic history drains, v1.122.10 (`claude/hr-display-workout-m1kh8q`)

**Path A failed on-device (v1.122.4 rebuild, owner-tested worn+moving).** The aggressive start
sequence (DAYTIME_HR + EXERCISE_HR → CONNECTED_LIVE + BLE fast-HR) acks (`0x2f`, `0x17`) but streams
**zero** HR — during the workout only 5 frames arrived, all command acks. The ring's realtime
transport itself works (the owner's Accel-button test streamed `cmd_0x33×676`), so the ring will
stream accel but **not** HR over BLE for us. HR exists only in the ring's recorded history. Per the
agreed plan, fell back to **path B (near-live from recorded history)**.

- **Periodic history drain during a workout** (`OuraRingSource`, JS-only): while live HR is active
  the source calls `plugin.drainHistory()` every 15 s (once immediately on start). Drained frames
  already flow through the existing `ouraFrames` listener; the source decodes the most-recently-
  recorded beat and surfaces it — lags ~1 drain interval, not truly live, but enough to watch HR
  recover between sets. `drainHistory` is an existing plugin method + the frame path already exists,
  so **no APK rebuild** — ships via Railway.
- **Recency guard** (`latestBpmWithTsFromFrames` + `lastRingTs`): pick the decodable HR frame with
  the greatest ring **timestamp** (not batch order), and only surface a beat when that timestamp
  advances. A re-drained old tail can't keep the readout looking fresh, so the hook's 8 s staleness
  guard can still blank a stalled feed. Kept `startLiveHr` (CONNECTED_LIVE may make the ring record
  HR more densely → fresher drains; harmless if not).
- **Gate:** `tsc`/eslint clean, 13 live-hr tests pass (+2 for the ts-aware decode). **Not verified on
  device:** whether the ring records HR often enough during a daytime workout for the drain to feel
  near-live is unknown until tested on the S25 — but iteration is now JS-only (no rebuild) so tuning
  the interval / recency is fast. Ops-matrix R7 + `projectOverview.md` updated: path A ruled out,
  path B shipped.

---

## Session 227 — Onset tile + within-epoch HR variability REM signal, v1.122.8 → v1.122.9 (#362, #363)

Owner Sync/Redecoded on-device after #360 (v1.122.7 deployed): 07-09 came out 7h35m asleep, Deep
15% / REM **7%** / Light 67% / Awake 12%, window 9:53 pm–6:25 am with a leading Awake block (onset
trim working). Two follow-ups:

- **"Fell Asleep" tile (v1.122.8, #362, merged).** The data-backed onset latency was only a small
  badge on the sleep summary card; the detail sheet (where the owner was looking) didn't show it.
  Added a tile to `components/health-metric-sheet.tsx` beside Avg HR / Restless Periods showing the
  derived clock time (`sleepStart + onsetLatencySec`) and minutes-to-fall-asleep. `onsetLatencySec`
  added to `SleepDetailReading` (already flowed from `/api/sleep-sessions`). tsc/lint green; **not
  visually rendered in-sandbox** (tile is inside a click-to-open sheet, no Playwright) — device is
  the real check.
- **Within-epoch HR variability REM signal (v1.122.9, #363).** REM read low (7% vs ~20–25% typical)
  because the stager averaged each 5-min epoch's beats to a single mean, discarding the within-epoch
  spread. That spread is a real REM axis (REM = irregular/surging HR; deep = very steady), distinct
  from rMSSD (beat-to-beat jitter, high in deep — the mean can't see it). Added `hrVar` to
  `SleepEpoch` (per-epoch beat-HR SD, computed in the rollup, null below 5 beats), z-scored per night
  into the depth/REM scores at a small weight `W_HRVAR=0.3` so it only **tips borderline epochs**.
  Opt-in and self-neutralising: a night with uniform/absent hrVar z-scores to zero and changes
  nothing, so every prior (owner-validated) staging test is untouched and acts as the regression
  guard. Two new tests: within-epoch spread concentrated on REM-leaning peaks yields strictly more
  REM; uniform hrVar == absent hrVar. 113 tests green, tsc/lint clean.
  **The REM proportion on real nights is unverified in-sandbox** (no per-beat ring data locally) —
  needs the owner's Sync/Redecode; `W_HRVAR` + `REM_Z` are the tuning knobs for the iterate loop.
  Breathing-rate variability (from raw IBI resampling) remains the larger, still-deferred REM lever
  (open_oura's port is only partial). #363 held for merge confirmation (changes staging numbers,
  outcome owner-validated) rather than auto-merged.

---

## Session 226 — Data-backed, sub-epoch sleep onset latency, v1.122.7 (`claude/sleep-cycles-hypnogram-ibqhxl`, #360)

Follow-up to the own-sleep-engine work (223–224) after the duration-inflation fixes (v1.122.5/6)
and the one-tap Sync & Redecode button (#359) shipped earlier in the same working session. Owner
flagged that onset latency read as ~0 — the heuristic stager began classifying from the first
in-window epoch, so time spent lying in bed awake before falling asleep counted as sleep (inflating
total sleep + efficiency). Owner asked for a **data-backed** onset (explicitly *not* a fixed
10-min offset), then noted the old Oura Cloud figure was finer than 5-min buckets.

- **Derive onset from HR settling** (`lib/health/sleep-staging.ts`): after classification, trim the
  two night boundaries to `awake` until HR settles to `median(sleep HR) + ONSET_HR_MARGIN` (2 bpm).
  Anchored to the **median sleep HR, not the deep-sleep floor** — light sleep sits above the floor,
  so a floor-relative cutoff over-trimmed real light sleep (caught as a rollup-test regression).
  Only the two boundaries, so mid-night REM (also elevated HR) is untouched.
- **Sub-epoch refinement**: the raw IBI HR samples are timestamped in **deciseconds**, far finer
  than the 5-min epoch grid the scalar was snapping to (`onsetLatencyMin * 60`). New
  `stageSleepDetailed()` returns `{ stages, onsetEpoch, settleHr }`; new pure
  `refineOnsetLatencySec(result, samples)` walks the raw `{ tSec, hr }` samples **within the onset
  epoch** for the first reading at/below `settleHr` and returns that exact offset. Staying inside
  the onset epoch keeps the scalar consistent with the ribbon; falls back to the epoch-start value
  when no sample is available. Rollup (`aggregateOuraRawSamples`) now collects per-sample
  `{ tSec, hr }` off the IBI rows and sets `onsetLatencySec` from the refined value.
- **Tests** (skip in CI, run local Postgres): `refineOnsetLatencySec` pinpoints within-epoch
  (732s, not a 5-min multiple), ignores a stray low sample in an earlier awake epoch, falls back to
  the grid value with no in-epoch sample, and reports the whole window when the night never settles;
  `stageSleepDetailed` onset epoch matches the stages; the trim test asserts `onsetLatencyMin===20`.
  111 tests pass; `tsc`/eslint clean.
- **Gate:** merged on green CI as a refinement on the already-shipped sleep-staging feature
  (bug-fix/refinement — no merge-confirmation gate). JS/server only → ships via Railway, no APK
  rebuild. **Not verified on device:** BLE staging only runs against real redecoded ring data on the
  APK; the sandbox has no native path. On-device check pending: Sync/Redecode and confirm a night
  shows a realistic, non-round onset (e.g. the owner's ~10:05 bedtime → ~12-min latency).

---

## Session 225 — Live HR path A: aggressive native start sequence + isolation levers, v1.122.4 (`claude/hr-display-workout-m1kh8q`)

Follow-up to the session-224 diagnostic. Owner ran it on-device during a workout (worn + moving):
**Frames=1, tag `0x2f` only, HR frames=0, source `oura_ble·connecting`.** That is decisive — the
single frame is the ring's *ack* of `SetFeatureMode(DAYTIME_HR, CONNECTED_LIVE)` (a `0x2f`
response); the ring accepts the live-HR command and then streams **zero** HR events. So it's a
**native/firmware capture gap, not a JS decode bug** — the known-unresolved "live-hr 0 beats"
issue, now confirmed on our re-keyed Ring 5. open_oura's live-HR path (that one command) doesn't
make this ring stream. Owner chose **path A (crack true live streaming), fall back to B
(near-live via periodic history drains) if A fails.**

- **Aggressive live-HR start sequence** (`OuraProtocol.liveHrStartSequence`, native): now sends
  DAYTIME_HR→CONNECTED_LIVE **+** EXERCISE_HR (`0x03`)→CONNECTED_LIVE **+** BLE fast-HR (`16 01 01`),
  and `liveHrStopSequence` reverses all three. Both extra levers are pinned to the skill/open_oura
  byte layouts (`reqBleFastHrMode` already existed; `FeatureId.EXERCISE_HR` added); only their
  *effect on this ring* is unproven. Because the workout card's `OuraRingSource` calls `startLiveHr`,
  the workout benefits immediately if the combo works — no second rebuild.
- **Isolation levers in the admin tester** (`/admin/oura-ble` Advanced): new plugin methods
  `fastHr({on})` and generic `setFeatureMode({feature,mode})`, surfaced as buttons (Fast-HR on/off,
  Exercise-HR live, Daytime-HR live) so the owner can fire each lever alone and watch the tag counts
  for HR events (`0x86`/`0x80`/`0x60`) — pins down which lever works (if any) without more rebuilds.
- **Docs:** ops-matrix row R7 (live HR never streams — signature, the levers, and the B fallback);
  Known-Issues row in `projectOverview.md`. Kotlin protocol tests added for both sequences.
- **Gate:** `tsc`/eslint clean; JS side only (tester buttons, plugin interface, changelog/version).
  **Not exercised — the entire point is on-device:** the Kotlin cannot compile in-sandbox (no Android
  SDK) and needs an **owner APK rebuild** (`npx cap sync android && ./gradlew assembleDebug`); whether
  any lever actually makes the ring stream is unknown until tested worn+moving on the S25. If none
  do, next session implements path B (periodic drain → most-recent recorded HR, likely JS-only).
- **Follow-up (post-#355):** #355 merged with the (non-required) Android CI job red — the Gradle
  build compiled the new Kotlin fine but the pre-existing `liveHrAndAccelSequencesMatchRust` test
  still pinned the old single-command live-HR sequence and failed. Fixed by splitting it into
  `accelSequencesMatchRust` (the live-HR bytes are covered by the two dedicated tests). Test-only,
  restores the Android check to green on `main`.

---

## Session 224 — Live HR "no reading" diagnostics on the workout card, v1.122.1 (`claude/hr-display-workout-m1kh8q`)

Owner reported that despite the session-221 Live HR readout (#345) the workout card still shows
"—" bpm ("Waiting for your ring") and no HR. Traced the full path end-to-end and confirmed the
JS layer is wired correctly (`LiveHrReadout` → `useLiveHr` → manager → `OuraRingSource` →
`latestBpmFromFrames`; `startLiveHr` sends the correct `SetFeatureMode(DAYTIME_HR, CONNECTED_LIVE)`;
`OuraRingService.onFrame` forwards every frame to JS via `ouraFrames`). The "—" is the honest
no-decodable-sample state. Two out-of-JS-layer causes: **(1)** the aohr `0x86` HR decoder is
`_status:"unvalidated"` in both our code and open_oura (audit 2026-07-08 — "nothing to port"), so
`decoded.bpm` is a best-guess byte layout; **(2)** the ring power-gates its PPG when worn-idle
(the skill's unresolved "live-hr captured 0 beats in Phase 0"), and lifting REST is the worst case.
Both are on-device/native and **cannot be verified or fixed from the sandbox** (`getOuraBle()` is
null on web), and I won't guess a new decoder layout without a captured real frame.

- **Added an on-device diagnostics panel to the Live HR card** so the owner can split the two
  failure modes without the admin BLE tester, mid-workout. New `LiveHrDiagnostics` contract
  (`lib/live-hr/types.ts`); `OuraRingSource` now records, for every forwarded frame (before any
  decode filtering), `framesSeen` / per-tag histogram / `hrFramesSeen` (tags `0x86/0x80/0x60/0x5d`) /
  `decodeHits` / last BPM+age / last 10 HR-frame hexes; exposed via `manager.getDiagnostics()` and a
  stable `getDiagnostics()` from `useLiveHr` (read only while the panel is open). `LiveHrReadout` gets
  a small activity-icon toggle → a panel with a plain-language verdict (`framesSeen===0` ⇒ nothing
  reaching JS/capture problem; `hrFramesSeen>0 && decodeHits===0` ⇒ decoder-layout bug; else OK), the
  counters/tag histogram, and copy-able raw HR-frame hexes for offline decode.
- **Gate:** `tsc --noEmit` clean, eslint clean, 11 live-hr unit tests pass (+2 manager diagnostics
  tests), `pnpm dev` boots and `/workout` serves 200 with no compile errors. **Not exercised:** the
  actual live-HR capture + aohr decode and the on-device rendering of the panel — inert in the web
  sandbox; on-device is the authoritative check. Once the owner reports the panel's counts/hexes,
  the next step is either a decoder fix (against real bytes) or native capture work.

---

## Session 223 (cont.) — Own sleep engine: heuristic stager fills the sleep black box, v1.122.0

Owner wanted sleep fully sorted — correct times/windows AND stages — to fill a black box. After
confirming on-device the ring emits **no** hypnogram over BLE (zero `0x4b/0x4e/0x5a` across two
full nights; `bedtime_period` is a 0.5h fragment) and that **Oura's SleepNet weights are encrypted
`.pt.enc` with a server-only key (unrunnable offline** — open_oura's finding), we built our own
stager (the path open_oura itself recommends).

- **New `lib/health/sleep-staging.ts`** — `stageSleep(epochs)` heuristic over 5-min epochs:
  actigraphy (`sleep_acm_period` movement) for sleep/wake + cardiac autonomic signatures
  (HR near night floor + high HRV → deep; lower HRV + atonia → REM; else light), per-night
  **self-normalizing** quantile thresholds (scale-invariant to the unknown acm_mad magnitude),
  with min-bout smoothing that preserves real awakenings. `summarizeSleepStages` → stage minutes,
  efficiency, onset latency, awakenings. `stagesToPhase5Min` added to `hypnogram.ts`.
- **Rollup** (`aggregateOuraRawSamples`): when no ring phase events (the norm), bin the window's
  movement/HR/HRV/temp into 5-min epochs, run the stager, and populate `sleep_phase_5_min` +
  deep/REM/light/awake hours + `durationHours` (time asleep) + efficiency + `onset_latency_sec` +
  `restlessPeriods`. Ring phase events still take precedence if they ever arrive.
- **Honest limitation (documented):** heuristic, not Oura-accurate, and **cannot be ground-truthed**
  against Oura — BLE raw and Cloud stages never overlap in time. Validated on transformation
  correctness (unit + DB tests) and stage-proportion/cycle face-validity; calibration to the
  owner's personal baselines is queued (backlog item 4, needs the prod baseline query).
- Gate: `tsc` 0; 31 sleep tests green (9 files) incl. a DB test proving raw signals → a populated
  hypnogram + stage hours + efficiency through the real rollup. DB-backed tests skip in CI (no
  `DATABASE_URL`) — local verification; on-device ribbon rendering + real-signal plausibility not
  yet exercised. Plan: `docs/superpowers/plans/2026-07-09-own-sleep-engine.md`.

---

## Session 223 — Sleep hypnogram recovery: banded-ribbon redesign + BLE stage wiring, v1.121.0 (`claude/sleep-cycles-hypnogram-ibqhxl`)

The owner asked how the new BLE-only system gets the sleep cycles / hypnogram / stage metrics
back (lost when the Cloud sync stopped at the 2026-07-07 re-key) and for a nicer ribbon/band
hypnogram. Doc → plan → implement → merge in one PR (owner authorised through merge).

- **Corrected a wrong assumption baked into our docs.** `oura-ble-remaining-work.md` item 8 and
  the v1.119.4/.5 journal rows said the Ring 5 emits "no hypnogram over BLE / stages null by
  design." Checked against `open_oura` directly (the sanctioned source, per the CLAUDE.md Oura
  rule): the ring **does** emit its own hypnogram over BLE — `sleep_phase_*` tags `0x4b/0x4e/0x5a`
  carry DEEP/LIGHT/REM/AWAKE, "cross-checked against live captures from a Ring 3 Horizon and a
  Ring 5," and there is **no sleep feature to enable** (staging isn't feature-gated). Same premature
  pessimism as the earlier REAL_STEPS "can't enable → actually can" correction. Findings written to
  `docs/oura-ble-sleep-staging-findings.md`; plan in
  `docs/superpowers/plans/2026-07-08-oura-ble-sleep-staging-hypnogram.md`.
- **Rollup wiring (server/JS, dormant until events arrive).** `aggregateOuraRawSamples` already
  computed stage *hours* from `0x4b/0x4e/0x5a` (gated `phases.length>0`) but never built the
  `sleep_phase_5_min` string the hypnogram renders. Added `phasesToPhase5Min` to `lib/health/hypnogram.ts`
  (30 s codes → 5-min majority string, One-Formula) and wired it in, consolidating from a **single
  tag (longest in-window sequence)** to avoid triple-counting if the three tags are redundant — used
  for both the string and the hours so they agree. All flagged **provisional pending an on-device
  captured vector** (30 s-epoch / single-tag / forward-order assumptions unvalidated; we've captured
  zero phase events so far). DB-backed regression `oura-ble-sleep-phases.test.ts` asserts synthetic
  `0x4b`/`0x5a` rows → `sleep_phase_5_min='1234'` + stage hours, and that the longer tag wins.
- **Hypnogram redesign (UI).** `components/health/hypnogram.tsx` rebuilt from a baseline-anchored
  skyline into an Oura/Whoop **banded ribbon**: each stage in its own lane (Awake→Deep), rounded
  bars, thin connectors bridging transitions, faint `currentColor` lane tracks so it reads in dark
  **and** light. `STAGE_COLOR` export unchanged (metric sheet depends on it). Verified via a faithful
  headless-Chromium render of the exact SVG geometry in both themes.
- **Still open (backlog item 4, ⛔ on-device):** capture real phase events (raw-tag diagnostic →
  clean overnight drain → cursor-skip check), then validate the provisional mapping against a real
  vector + the owner's pre-re-key Oura history, and Redecode-backfill. Only if a genuine full-night
  drain yields nothing is staging truly absent → motion/HR model fallback.
- **Not exercised:** real on-device BLE phase-event capture, Samsung WebView rendering, safe-area
  (the ribbon lives inside existing cards). Gate: `tsc` 0, lint 0 (only pre-existing adapter unused-import
  warnings), hypnogram unit + rollup DB tests green.

## Session 222 — Live HR Plans 2 & 3 authored (docs-only, `docs/live-hr-plans-2-3`)

Planning session: wrote the two remaining implementation plans from the live-HR/interval-walking spec
and queued them.

- **Plan 2 — guided interval walk** (`docs/superpowers/plans/2026-07-08-live-hr-plan-2-guided-interval-walk.md`).
  Key finding, mirroring Plan 1: it needs **no native code / no APK rebuild**. The spec assumed a native
  `GuidedSessionService`; instead the plan uses `@capacitor/local-notifications` (already installed, already
  used for the rest-timer) for background-surviving interval cues + a **wall-clock-resynced JS timer** for
  the live UI, so backgrounding/reload never desyncs it. Effort zones use a new shared
  `lib/health/hr-zones.ts` (Karvonen — extracted from the inline copy in `app/api/body-battery/route.ts`,
  which the plan refactors to import it, per One-Formula; standardised on the app's existing 220−age rather
  than the spec's Tanaka to avoid drifting body-battery). Saves a `walk` `activity_log` via the offline-first
  `done-activity-screen` pattern; per-interval breakdown shown in-session from live samples (not persisted to
  history — a deliberate v1 cut). TDD for the pure interval/zone logic. Ready to implement.
- **Plan 3 — chest-strap source** (`docs/superpowers/plans/2026-07-08-live-hr-plan-3-chest-strap-source.md`).
  `ChestStrapSource` (standard BLE Heart Rate Service `0x180D`/`0x2A37` via a new
  `@capacitor-community/bluetooth-le` dep) implementing the Plan-1 `LiveHrSource`, registered ahead of the
  ring for precedence, with pairing UI + strap-wins read merge and a `chest_strap`-tagged HR ingest. ⛔ blocked
  on a physical strap + an APK rebuild (native plugin). Absorbs the old chest-strap backlog note.

Both queued in `docs/implementation-backlog.md` (Plan 2 ready; Plan 3 blocked-hardware). Docs-only — no
version bump. Builds on Plan 1 (shipped v1.120.6).

## Session 221 — Live HR on lifting screens (Plan 1 of live-HR/interval-walking spec), v1.120.6 (`feat/live-hr-lifting`)

Built **Plan 1** of the live-HR/interval-walking design
(`docs/superpowers/specs/2026-07-08-live-hr-and-interval-walking-design.md`;
`docs/superpowers/plans/2026-07-08-live-hr-plan-1-layer-and-lifting.md`): a source-agnostic
live-HR layer plus a live-HR readout on the workout **rest** and **exercise-summary** screens.

**Key correction to the spec's assumption — no APK rebuild needed.** The spec assumed a native
`ouraLiveHr` event. Investigation showed the native service already forwards every ring frame to
JS via `ouraFrames`, and `historyEventFromHex` already decodes HR — so Plan 1 decodes live HR **in
JS** and ships via Railway with no Kotlin change. The native event is deferred as an optional later
optimisation.

New `lib/live-hr/*`: `types.ts` (`LiveHrSource`/`LiveHrSample`, precedence-ready), `decode-live-hr.ts`
(pure `latestBpmFromFrames`), `oura-ring-source.ts` (wires the existing `startLiveHr`/`stopLiveHr` +
`ouraFrames`/`ouraFrame` listeners → decoder), `manager.ts` (`createLiveHrManager` with
registration-order precedence — chest strap will unshift ahead of the ring in Plan 3 — plus a
`getLiveHrManager()` singleton), `use-live-hr.ts` (staleness on a 1 Hz leaf tick).
`components/workout/live-hr-readout.tsx` is a memoised leaf owning its own subscription + rolling
buffer (new beats re-render only the readout, not the ~1,000-line workout screen). `workout-screen.tsx`
starts the manager while `mode` is `active`/`exercise-summary` and stops on pre/done/unmount —
`warmup` was dropped because it is never `setMode`'d in that file (set in the store only).

**Verified:** `tsc` clean, eslint 0 errors (6 pre-existing warnings), `vitest run lib/live-hr` 9/9
(pure decoder + manager precedence/staleness). **NOT verifiable in sandbox:** the live-BPM path —
`getOuraBle()` returns null in the browser, so `OuraRingSource` is inert and the readout shows "—"
(the tested degraded state). Live HR appearing/updating on the rest screen and stopping on finish is
**on-device-only** (per the BLE device-first policy) — needs an owner APK smoke pass. Plans 2 (guided
interval walk, native) and 3 (chest-strap source) remain in the backlog.

## Session 220 — Workout HR chart: set/rest shading from BLE HR, v1.120.5 (`claude/workout-hr-chart-lt0lw8`)

Took **item 1** of `docs/oura-ble-remaining-work.md` (the workout HR chart). Discovery: it wasn't a
fresh build — a done-screen **"HR Recovery"** card already existed (`components/workout/hr-recovery-chart.tsx`
+ `/api/oura/hr-data` → `getHrForWindow` + `analyseHrRecovery`), and since `getHrForWindow` returns every
`oura_heartrate` row in the window it already renders the BLE HR (`source='ble'`). The genuinely-missing
piece the doc asked for was **set-vs-rest shading**. Built as an enhancement, not a rebuild (server/JS only,
no APK rebuild):

- `getSetTimestampsForSession` (`lib/data/postgres/slices/oura.ts`) now also returns `setStartMs`/`setEndMs`
  per set (already stored on `set_logs`, written by the real logging path). `SetMarker`/`SetHrStats`
  (`lib/workout/hr-analysis.ts`) carry them through `analyseHrRecovery`'s spread; `/api/oura/hr-data` passes
  them in the `setStats` payload.
- `HrRecoveryChart` shades each working-set interval as a faint green band via a `beforeDatasetsDraw` chart.js
  plugin (drawn beneath the trace), with a "Working set" legend chip. Graceful fallback: no per-set timing
  (old/seeded sessions) → no bands, just the trace + per-exercise dashed lines. Gridlines/ticks switched from
  white-alpha to theme-neutral gray (light-mode hazard, fixed on-touch).
- Done-screen "Load" no longer **awaits** the now-dead Oura Cloud `hr-sync` before reading — it's fire-and-forget,
  so the card renders the already-captured BLE HR immediately.

**Verified:** typecheck + lint clean; `rest-adherence`/`hr-session-state` tests green; a throwaway vitest
against the local DB (seeded 111 `ble` HR readings 90–145 bpm + 3 set intervals into the latest session's
window) confirmed the readings and `setStartMs`/`setEndMs` flow to the exact route payload shape. **NOT
exercised in-sandbox:** the canvas band rendering and the done-screen "Load" UX (the done screen is a
post-live-workout mode, not a reachable route), and real ring BLE data — on-device against a real logged
session remains the authoritative check per the BLE device-first policy. Per-session-in-history HR view left
as optional future work (no per-session workout detail surface exists today). Removed the backlog entry,
marked item 1 ✅ in the remaining-work doc, bumped to **v1.120.5** + changelog.

## Session 219 (cont.) — Oura BLE sleep-write oura_id collision (root cause of the SpO₂ starvation), v1.120.3 → v1.120.4 (`claude/oura-ble-followups-pbxko7`)

The step-isolation build (v1.120.3) both **fixed SpO₂** (07-08 filled at 96.4 %, dead-on the owner's
95–97 % baseline — no calibration offset needed, the ~93 % worry never materialized) **and surfaced the
throwing step** in the tester log: `⚠ sleep: Failed query: insert into "sleep_sessions" … on conflict
("user_id","sleep_start") … params: … ble:1906409 …`. Root cause: BLE sleep rows carry a **stable
`oura_id` (`ble:<startDs>`)** but a `sleep_start` **derived from the movable clock anchor**. The anchor
advances forward-only on every drain (`batchMaxDs ↔ ingest-time`), so between rollups the same ring window
computes a *new* `sleep_start`. `upsertOuraSleep`'s conflict target is `(user_id, sleep_start)`, which then
no longer matches the existing row, so it tries to INSERT a fresh row with the same `oura_id` → **UNIQUE(oura_id)
violation** → the sleep step threw (and, pre-v1.120.3, took SpO₂/body_metrics down with it). **Fix:** the
rollup now **owns its BLE sleep rows** — deletes `sleep_sessions` by the `oura_id`s it's about to write, then
inserts (same delete-then-reinsert pattern the HR series already uses), so an anchor shift replaces the row
in place instead of colliding. Regression `oura-ble-sleep-anchor-drift.test.ts` seeds a night, rolls up,
shifts the anchor, rolls up again, and asserts no `stepErrors` + exactly one `ble:%` row with an updated
`sleep_start`. `tsc` 0, lint 0, **974 tests**, build 0.
**Deeper issue noted (not fixed here):** the anchor drifts every drain, so all derived timestamps (measured_at,
sleep_start, HR-series bins) wobble slightly between rollups — the delete-then-reinsert makes sleep + HR
idempotent against it, but a *stable per-epoch anchor* (SyncTime-ack based, backlog item #2) is the real
hardening. **SpO₂ + sleep now both save reliably; the "full functionality back" set is complete except the
still-blocked ring steps and the queued workout-HR chart.**

---

## Session 219 (cont.) — Oura BLE rollup step-isolation (SpO₂ still blank after day-keying fix), v1.120.2 → v1.120.3 (`claude/oura-ble-followups-pbxko7`)

Even after the day-keying fix deployed (v1.120.2 confirmed live), 07-08 SpO₂ stayed NULL. Diagnosed
live, ruling out each hypothesis with prod SQL: (a) **anchor is fine** — replicating the rollup's exact
day-math (`anchor_utc + (ring_ds−anchor_ds)×100ms`) with the single live anchor keys **5,783 samples to
07-08**, correct; (b) **r-values are healthy** — 07-08 has 5,781 samples, avg r 0.64, min 0.28, max 1.14,
**zero** r≤0, so `spo2PctFromR` filters none. So the day-keying and data are both correct — yet a repro of
the exact state (6,840 samples split across midnight + a pre-existing null-SpO₂ 07-08 row) **fills 07-08**.
Conclusion: the rollup is **throwing before the `body_metrics` write** on prod data the sandbox can't
reproduce, and since `upsertOuraSleep` runs first, its throw starved SpO₂ while HRV/RHR showed stale
values. **Fix (robust, root-cause-agnostic):** each rollup write step (sleep / body_metrics / hr_series /
wear) now runs in its own try/catch via a `step()` helper — a failure in one never blocks the others, and
per-step errors are collected into `OuraRawAggregateResult.stepErrors` and surfaced by the redecode route +
tester log (which previously swallowed `aggregateError` entirely — it only parsed `j.error`). So SpO₂ now
writes even if the sleep step throws, AND the next Redecode's tester log names the failing step + message so
the underlying sleep-write bug can be root-caused separately. `tsc` 0, lint 0, **973 tests**, build 0.
**Owner: tap Redecode once after this deploys** — 07-08 SpO₂ should fill, and if any `⚠ <step>: <error>`
line appears in the tester log, screenshot it so the root cause gets its own fix. The tester now also prints
`wrote: <days>` and any redecode/aggregate errors.

---

## Session 219 (cont.) — Oura BLE SpO₂ day-keying fix (post-merge hotfix), v1.120.1 → v1.120.2 (`claude/oura-ble-followups-pbxko7`)

After the Redecode 500 fix deployed and the owner re-ran Redecode, the timestamp repair was
**confirmed working** (the Legs workout's events now correctly join its 07:38–08:43 window — 120
`green_ibi_quality` HR readings during the session, so a workout HR chart is viable) — but **today's
SpO₂ card stayed blank** despite 6,840 stored `spo2_r_pi` events. Diagnosed live against prod via SQL
(systematic-debugging, no guessing): (1) `body_metrics` had 07-07 spo2 96.479 but **07-08 NULL** while
HRV/RHR wrote for 07-08; (2) all 6,840 `0x8b` rows decode fine (r≈0.48 daytime → ~99.7% clamp, r≈0.78
overnight → ~93%); (3) the decider — **the 6,840 samples are one overnight sleep (07-07 22:49 → 07-08
06:46) split by the calendar midnight: 1,057 on 07-07, 5,783 on 07-08.** The rollup keyed SpO₂ via the
sleep-signal window's wake day (`winList.find` on ring ds), but the ring measures SpO₂ on its own
schedule and the post-midnight majority fell outside the sleep-ACM window's ds range → orphaned, and
`body_metrics`' COALESCE non-clobber left 07-08 NULL. **Fix:** key SpO₂ by each sample's own local
calendar day (`toAestDay(toDate(ds))`) — every sample lands somewhere, no fragile window lookup; a
night straddling midnight splits across both days (acceptable for a daily trend, and can't silently
drop data). Since 07-08 is currently NULL, the next Redecode's COALESCE writes it. New regression test
(`oura-ble-spo2-daykeying.test.ts`) seeds a midnight-crossing night and asserts BOTH days populate —
would have failed on the old window-keying. `tsc` 0, lint 0, **973 tests**, build 0.
**Known calibration caveat (flagged to owner, not fixed):** the "SpO₂ Simple" gen4 quadratic reads a
touch under Oura's firmware-smoothed figure (overnight ~93% vs the owner's Cloud-era 95–97%); if the
gap is systematic once 07-08 fills, add a per-ring offset constant (backlog validation item). **Owner:
tap Redecode once more after this deploys** to fill 07-08. **Workout HR chart** is now the next build
(confirmed the ring captures ~120 HR readings/session).

---

## Session 219 (cont.) — Oura BLE Redecode 500 fix (post-merge hotfix), v1.120.0 → v1.120.1 (`claude/oura-ble-followups-pbxko7`)

Right after #336 merged and deployed, the owner tapped **Redecode** on the deployed build and
got **`redecode failed: 500`** (the drain itself was fine — batches ingested cleanly). Root cause:
the new `measured_at` re-stamp (added in #336 to repair the catch-up-drain timestamp collapse) was
a **single unbounded `UPDATE ... WHERE user_id = $1`** over the user's entire `oura_raw_samples`,
and the pool sets `statement_timeout: 15_000` — on a large post-Full-re-sync history that one
statement can exceed 15 s → Postgres kills it → the route (no try/catch) → 500. (Sandbox couldn't
reproduce the throw — faithful 66k-row redecode+aggregate ran in ~6.5 s — which is itself the tell:
prod is larger and/or under write contention from the concurrent drain, exactly the regime a single
whole-table statement is fragile in.) Fixes: (1) the re-stamp is now done **per page** (≤500
rows/statement, folded into the existing redecode paging loop) so no single statement can approach
the timeout regardless of table size; (2) the **redecode route runs each phase (redecode /
re-aggregate) in its own try/catch and returns the real error message as JSON** instead of a raw
500 — a redecode failure no longer blocks the re-aggregate, and the tester will show *why* if
anything still fails (CLAUDE.md: no silent 500s, decoders/rollups infallible); (3) chunked
`upsertOuraHeartrate` inserts at 5 000 rows to stay under pg's 65 535 bind-param ceiling (latent —
a big BLE HR rollup could otherwise exceed it). Existing re-stamp regression
(`oura-ble-sleep-fallback.test.ts`) still passes with the per-page logic; **972 tests**, `tsc` 0,
lint 0, build 0. **Not exercised (sandbox):** the actual prod-scale 500 (unreproducible here) — the
owner's next Redecode tap on the deployed hotfix is the confirmation; if it still fails it now
returns the real message. Side finding logged: the tester's "3 undecoded" tags (`ring_start` 0x41,
`user_information` 0x5c, `unknown_0x85`) are non-metric boot/profile/unknown events — 0x41/0x5c are
named-but-not-decoded in open_oura too, 0x85 is unknown upstream; raw hex is archived + re-decodable,
so no urgency (noted for a future low-priority decoder pass).

---

## Session 219 — Oura direct-BLE: SpO₂ R/PI→% calibration (BLE-16) + HR-day chart + wear time from BLE, v1.119.5 → v1.120.0 (`claude/oura-ble-followups-pbxko7`)

Picked up the queued BLE follow-ups; mid-session the owner widened the ask with Health/Home
screenshots: get full functionality back — accurate HR reading/storing/displaying, ring wear
time, steps, charted. Everything shipped is JS/server (Railway deploy, no APK rebuild).

**SpO₂ (BLE-16):** the Ring 5 emits only raw `0x8b` r/PI (never the firmware-calibrated `0x6f`
%). New pure `lib/oura-ble/spo2.ts` ports Oura's own "SpO₂ Simple" conversion from open_oura's
`spo2-calibration.md`: `SpO2% = a·r² + b·r + c` clamped [85,100], gen4/oreo coefficients
(`a=−13.4, b=−5.1, c=105.2`; Ring-5's hardware→coefficient mapping is unpinned upstream, but the
two known sets differ by <1% — open_oura defaults to gen4 and we match, with a unit test pinning
the <1% agreement). The rollup derives per-sample %, keys samples to their sleep window's **wake
date** (plain calendar-day bucketing would split a night at midnight — same keying HRV/RHR use),
and writes the nightly mean to `body_metrics.spo2_pct`; firmware `0x6f` % takes precedence on any
day holding both. Tester tile falls back to a derived estimate labelled `SpO₂ (est.)`
(`calibrated: false`).

**HR-day charts (the "No Oura HR data today" card):** `aggregateOuraRawSamples` now materializes
a 5-min binned HR series — IBI (`0x80/0x60`, sleep + daytime) plus always-on HR (`0x86 aohr`,
rides on the enabled daytime-HR feature), band-filtered 35–200 — into `oura_heartrate` with
source `'ble'`, feeding the existing `hr-day`/`hr-window`/`getHrForWindow` path (Home + Health
charts unchanged). Bin timestamps derive from the movable clock anchor, so the rollup owns its
rows: delete `source='ble'` within a 14-day window and re-insert (derived + un-referenced;
`onConflictDoNothing` alone would strand near-miss duplicates).

**Wear time:** derived from on-finger signal density — 15-min bins containing any
on-finger-only event (IBI/HRV/SpO₂/sleep-phase/sleep-ACM/sleep-temp/aohr), with `0x46/0x69`
temperatures counting only at skin range (≥31 °C — ambient-range temps mean desk/charger) →
`oura_daily.non_wear_time_sec`, today written with the Cloud's partial-day semantics
(elapsed − worn). The existing wear-time trend chart, `wornHours`, and the wear-confidence
gating (`isLowWearToday`, low-wear baseline exclusion) all resume unchanged.

**Also:** ingest rollup trigger gains `0x8b/0x86/0x46/0x69/0x72/0x75` — a batch carrying only
sleep-ACM signals previously wouldn't trigger the sleep-window fallback (latent gap); HRV card
label fixed `ms SDNN` → `ms rMSSD` (every writer — BLE rollup, Cloud sleep `average_hrv`, Health
Connect post-fix — stores rMSSD). **Steps stay phone-only:** the ring's step field
(`0x7e`/`0x7f` 14-byte bit-packed record) is unidentified even upstream ("names TBD — walk with
the step feature on"); queued a counted-walk capture-experiment item in the backlog instead of
guessing. Also queued: validate derived HRV/RHR/SpO₂/wear values against the owner's pre-re-key
Oura app history.

**Workout-granular HR (owner follow-up in-session):** HR bins are workout-aware — samples whose
wall-clock time falls inside a `workout_sessions` window (±10 min) bin at **15 s** instead of
5 min, so a workout's trace resolves set/rest structure once in-gym data accumulates (DB test:
a 1-h workout window over the seeded night yields >30 points in that hour vs ~12 at 5-min).
The workout-screen HR chart itself (trace + set/rest markers) is deferred until prod data shows
how much the ring actually captures mid-lift (finger PPG is motion-noisy — Phase 0 saw 0 live
beats during motion; rest periods are the realistic capture window) — owner is running a SQL
density check against prod. Age-tiered coarsening of old non-workout data (15/30/60-min) was
deliberately skipped: the 180-day retention prune already caps `oura_heartrate`, and 5-min bins
are ~288 rows/day. Owner also supplied validation baselines from the app's own history sheets
(SpO₂ 95.4–97.0 %, HRV 25–45 ms, RHR 57–65 bpm, wear ~23 h/day) — recorded on the backlog
validation item.

**Verified live** against local Postgres through the real HTTP routes: 790 synthetic frames
(built byte-exact for the real decoders — first attempt used a 4-byte `0x72` body, which the
12-byte-minimum decoder rightly nulled, proving the `isNotNull(decoded)` filter) → ingest 200 →
rollup `{sleepSessions: 1, hrSeriesPoints: 97, wearDays: 1}` → `hr-day` returned 97 readings +
the sleep window; `body_metrics` got HRV 43 / RHR 50 / SpO₂ 92.8; summary `latestSpo2
{pct: 93, calibrated: false}`. Synthetic data cleaned up after. Gate: `tsc` 0, lint 0 errors,
**972 tests pass** (+8: spo2 unit vectors, precedence, HR-series/wear DB regressions), build
exit 0. **Not exercised (sandbox):** real-ring event mixes — whether `0x86 aohr` actually fires
through the day, real-world wear-density vs Oura's ~23 h, and the SpO₂ estimate's closeness to
Oura's numbers (Known-Issues row added; owner taps **Redecode** after deploy to backfill, then
compares against Oura history).

---

## Session 217 (cont.) — Oura direct-BLE native background ingest + operations manual, v1.118.0 → v1.119.0 (`claude/native-ble-system-review-2e1sml`)

Immediately after the review PR merged, the owner confirmed BLE-1 live (another agent's DB audit: 2,099 rows ~95% debug noise, 12 `green_ibi_quality`, zero `ibi_and_amplitude`/`spo2_r_pi`/`hrv_event` — while the tester's frame counter had shown `green_ibi_quality×1520, ibi_and_amplitude×360, spo2_r_pi×103, temp×520, hrv×2` delivered) and made data correctness the priority, with an explicit ask for a full failure-point/contingency treatment and owned protocol documentation. Implemented the durable-sync plan's Chunk 1 (backlog top item + user-asked-in-session). **Mid-flight, two parallel-session PRs landed on `main`** — #325 (v1.117.5: the two-cursor interim fix — in-memory `drainCursor` keeps the drain looping, persisted resume cursor advances only via `confirmStored(ds)` after the tester's JS POST gets a 2xx) and #327 (v1.118.0: 25+ new decoders, migration 115 clock anchor + `measured_at`, redecode route, and `aggregateOuraRawSamples` rolling raw samples into `sleep_sessions`/`body_metrics`) — so the branch was restarted from fresh `main` and this PR was recomposed **on top of** their model instead of fighting it, exactly as #325's own backlog note anticipated ("when native ingest lands, delete the tester's POST loop and drive `confirmStored` from the service").

**Native (`OuraRingService.kt`):** the service now owns ingest end-to-end. Each drained batch is buffered natively and POSTed to `/api/oura-ble/samples` on an in-order single-thread executor (`HttpURLConnection`, 15/30 s timeouts, 3 retries at 2/5/10 s; session cookie from the shared `CookieManager` — the Capacitor WebView and native code share the system cookie store), and the service drives `confirmStored(batchMaxDs)` itself on 2xx — the persisted resume cursor never moves for an unstored batch. A batch that exhausts its retries sets `drainIngestFailed`, which **skips every later batch's confirm in that drain** (the cursor must never jump a hole past a failed span), zeroes `lastDrainCompletedAt`, and the keepalive re-drains within ≤5 min. The drain loop itself keeps pulling at BLE speed (their pipelined `drainCursor` design, kept) while uploads trail behind it in order. Drains auto-start on every connect (3 s after the feature-enable acks) and hourly via the existing keepalive tick; refused entirely when no ingest URL is configured (an unstorable drain is the exact bug). Spontaneous (non-drain) history frames buffer natively and flush on threshold/keepalive with a capped re-queue. Chunk-3 items folded in: `requestConnectionPriority(HIGH)` during drains / BALANCED after, status bridge events throttled to 1/s (was one full JSON per frame — BLE-7), and all GATT listener callbacks marshalled onto the main handler. `OuraGattClient` gains `setConnectionPriority`; the plugin gains `setIngestUrl` (persisted; the app shell sends `window.location.origin` on every open, individually try/caught so older APKs keep auto-starting); `confirmStored` stays exposed for the legacy JS path.

**JS:** the tester's forwarding loop now runs **only on legacy APKs** — it detects native ingest via the new optional status fields (`ingestPosted` etc.) and disables itself, showing the service's uploaded/new/cursor counters and a destructive-toned upload-error line instead; version skew in both directions is safe (dedup + monotonic confirm). **CI:** new `android` job — pnpm install → `mkdir -p www && npx cap sync android` → JDK 21 → `:app:testDebugUnitTest` → `:app:assembleDebug` → uploads `app-debug-apk` (14-day artifact). First automated gate the Kotlin has ever had, and the owner can install from CI instead of building locally.

**Owned documentation (the explicit ask):** new **`docs/oura-ble-operations.md`** — §1 a 21-row failure-point matrix across ring/link/ingest layers (radio sleep, dead battery, features-off, **ring-buffer wrap — the one real loss window**, epoch reset, the 133/147 class, Samsung autoConnect ban, bond loss, lost key, Samsung service kills, reboot, cookie expiry, 4xx/5xx/429, mid-POST kill, unknown tags, version skew), each with automatic handling + manual contingency + honest loss exposure; §2 the sync-cadence policy + tuning trade-offs (fresher vs battery vs bulk-upload speed, and the four things never to trade away); §3 the protocol-maintenance playbook (firmware frozen while we never run the official app; re-onboarding = full protocol re-validation with exact steps; new-ring runbook via the Phase-0 docs; the load-bearing bytes are transcribed into our code/tests/skill so we don't depend on open_oura surviving — archive a fork anyway; drift monitoring; new failure signature ⇒ new matrix row in the same PR); §4 the data-integrity runbook (Full re-sync → delivered-vs-stored counts must agree per biometric type — the exact check that catches this bug class). Linked from CLAUDE.md as read-before-touching.

**Gate:** `tsc` clean, lint 0 errors, tests green, build exit 0 (re-run after the rebase). Backlog #1 annotated (remaining: chunk 2 — boot receiver, CDM, battery exemption, bonded-reconnect experiment — and chunk 3's frame batching); plan doc progress note; module-map + both Known-Issues rows updated (BLE-1 "fixed in two layers"; frozen-screens row reflects #327's shipped mapping); v1.119.0 + changelog. **⚠️ Not exercised (sandbox):** every Kotlin behaviour — compile/test-gated by the new Android CI job only; the native cookie-auth POST path is only provable on-device. **Owner: rebuild (or take the CI artifact), tap Full re-sync, run the §4 runbook promptly** — anything the ring's finite buffer already overwrote is unrecoverable.

---

## Session 217 — Oura direct-BLE whole-system review: 16 findings, two plans queued, CLAUDE.md rules (docs-only, `claude/native-ble-system-review-2e1sml`)

Planning/review session (PR 1 of the backlog protocol) at the owner's request: a "very solid
look" at the just-shipped native BLE system (v1.116.0 → v1.117.4) across seven angles — data
parity with the retired Oura Cloud path, the set-and-forget model, tester UI adequacy,
tables/labels/timestamps, performance/production risk, efficiency, and native-BLE techniques
worth adopting. Read the entire stack line-by-line (all 5 Kotlin files, `decode.ts`/`plugin.ts`,
the tester, both API routes, migration 114, the adapter methods) plus the Cloud-path wiring
for comparison. Write-up: **`docs/reviews/2026-07-07-oura-ble-system-review.md`** (BLE-1..16,
each with file:line).

**Headline findings.** (1) **BLE-1, critical — the pipeline loses data**: the history cursor
persists forward on every ring `0x11` batch completion (`OuraRingService.kt`) regardless of
ingest success, while the *only* ingest path is the `/admin/oura-ble` tester's 2.5 s POST
loop — which must be mounted, foregrounded, and online, and which drops a batch on POST
failure instead of re-queueing (`oura-ble-debug.tsx` splices before POSTing). The results
doc's durability claim ("a failed POST just re-drains") is therefore false today: the next
drain starts from the already-advanced cursor and never re-requests the lost span. (2)
**BLE-3/-4, high — every health screen has been silently frozen since the re-key**: nothing
maps `oura_raw_samples` → `body_metrics`/`sleep_sessions`, and the Cloud sync keeps
auto-firing (≤1×/6h + five screens), succeeding with zero new rows forever, and refreshing
the "Last synced" indicator — fresh-looking, permanently stale. (3) **BLE-10 — Kotlin tests
run in no CI**: `ci.yml` has no gradle job; the results doc's "they run in the Android CI
check" is wrong — a protocol byte regression would merge green. Also: read-time-only clock
anchor (single-epoch, no stored `measured_at`), no reboot recovery (no `BOOT_COMPLETED`
receiver) and no CompanionDeviceManager, per-frame bridge emits + `emitStatus()` per frame
(thousands of crossings per drain), all undecoded tags collapsing into one `unknown` summary
row, no connection-priority tuning, and the tester lacking a decoded-field inspector.
**Reviewed clean:** the protocol layer itself — decoders byte-pinned to the Rust source with
20 vector tests, infallible-decode + raw-hex archival (load-bearing: the ring's buffer is
finite, so `body_hex` is the only archival copy), correct dedup, ownership/Zod/rate-limit
discipline on the routes, and every hard-won on-device connect lesson properly encoded.

**Data-parity verdict:** direct-BLE is a strict *raw-data* superset but the tier-2 outputs
are gone by design — readiness/sleep/activity 0–100 scores were computed by Oura's phone
engine, never on the ring. Derivable now from decoded events: HRV (0x5d rmssd), RHR
(sleep-window IBI), temperature (needs baseline state), sleep sessions (hypnogram nibbles
decode; aggregation unbuilt). Blocked: SpO₂ % (Ring-5 r→% coefficients unknown — unless the
ring emits direct-% `0x6f` events, to be confirmed from overnight data), activity/steps/MET
(tags `0x50/0x51/0x52/0x6b` undecoded).

**Deliverables (all docs, this PR):** two implementation plans queued at the top of
`docs/implementation-backlog.md` — **#1 `2026-07-07-oura-ble-durable-background-sync.md`**
(native: ack-gated cursor advance, native-service HTTP ingest via the shared CookieManager
session cookie, drain-on-connect + keepalive-driven re-drain, `BOOT_COMPLETED` receiver,
CompanionDeviceManager presence, `requestConnectionPriority` tuning, bridge batching, and an
Android CI job with an `assembleDebug` artifact) and **#2
`2026-07-07-oura-ble-data-mapping-and-tester.md`** (persisted per-epoch clock anchor +
stored `measured_at` via migration 115, redecode path, unknown-tag surfacing + decoded-field
inspector + HRV/SpO₂/sleep tiles in the tester, then the graduation: rollups into
`body_metrics`/`sleep_sessions` with `source` provenance and the Cloud-sync cutover gated on
verified overnight data). New **CLAUDE.md "Oura Direct-BLE" section** (the durable rules:
cursor advances only past durably-ingested events; `body_hex` is archival and never pruned;
byte facts come from the open_oura Rust source/skill only; never re-onboard the official app
— firmware freeze is what keeps the protocol stable; ring-clock deciseconds are
epoch-relative, never absolute; Kotlin = owner APK rebuild, JS = Railway).
**Device-smoke-checklist §7** added (BLE pass incl. the Samsung "Never sleeping apps"
exemption). Backlog reconciled (Phase-2/Track-B/overnight-validation bullets updated to
post-ship reality; provenance work folded into plan #2). `projectOverview.md`: two new
Known-Issues rows (BLE-1 data-loss window with interim drain discipline; frozen health
screens), the Phase-2 row marked RESOLVED on device (auth SUCCESS/drain proven by v1.117.x,
diagnostic history retained), and the stale "next migration number" line fixed (said 112;
114 was on disk; 115 now claimed by plan #2). Started this new journal batch file
(`history-newest.md` crossed the ~250 KB threshold at 258 KB). No code changed — docs only,
no version bump, merge-gate-exempt.

**Not exercised (docs-only session):** nothing runtime — no code was changed. The review's
claims were verified by reading the committed source at `main` (ff3cb20), not by on-device
runs; the two data-path findings (BLE-1 cursor/ingest decoupling, tester-only forwarding)
are structural facts of the code, visible in the diff-free source.

