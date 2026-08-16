# Nutrition Tab Uplift — Selected-Date Correctness, Instant Paint, Cache/API Hygiene, Theming, Layout Regrouping

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> subagent-driven-development) to implement this plan chunk-by-chunk. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** finish the Nutrition tab — fix the remaining selected-date data bugs, remove every
skeleton flash / bare fetch on its sub-sheets, close the API/cache hygiene gaps, clear the
nutrition-scoped theme/a11y debt, and regroup the page sections (merged trends card, quick-action
row, water tile, offline meal-type mirror).

**Source:** full nutrition-tab review, 2026-07-10 (this session; three-agent sweep over
components/API/caching + orchestrator read). **Branch:** `feat/nutrition-tab-uplift`.

**Architecture:** all client/server JS — ships via Railway into the WebView, **no APK rebuild**.
Chunk 5.4 (meal-type local mirror) and the outbox-date fix (1.3) are device-only behaviours:
flag NOT-verified-on-web at merge and run the device smoke checklist.

**⚠️ Ordering / dependencies — implement AFTER queue items R5, R6 and R7:**
- **R5 — Nutrition fixes** (`2026-07-09-r5-nutrition-fixes.md`) edits the same files
  (quick-edit sheet, saved-meals sheet, meal-type manager, review-step). Everything NUT-1…11
  covers is **not re-planned here**; several tasks below explicitly build on R5's fixes.
- **R6 — Performance & paint** (`2026-07-09-r6-performance-and-paint.md`) owns **PERF-5**
  (the date-swipe 8-endpoint refetch storm + `setLogs([])` blank flash). Task 2.6 below
  assumes the split `fetchData` shape PERF-5 produces.
- **R7 — UI polish** (`2026-07-09-r7-ui-polish-a11y.md`) hoists `resolveColor` to
  `lib/chart-colors.ts` (UI-H1). Task 4.1 imports it. If this plan somehow lands first,
  do R7's Chunk-1 hoist here verbatim and annotate R7.

Re-verify every finding against `main` at implementation time (line numbers below are from
2026-07-10, v1.125.0) — R5/R6/R7 will have moved several of them.

**Cross-refs (found again in this review, already planned elsewhere — do NOT double-plan):**
saved-meal logs-today-on-a-past-date (= NUT-3), quick-edit invalidation gated on the push
(= NUT-2), `barcode: null` 400 (= NUT-4), ⏰ emoji + qty clamps + meal-card/manager tap targets +
dnd-updater side-effect (= NUT-11), "Save to my food library" dead toggle (= NUT-10),
ingredient-totals dedup (= NUT-9), date-swipe refetch storm + blank flash (= R6 PERF-5),
canvas `var()` in `workout-load-comparison-chart`/`trend-chart` (= R7 UI-H1).

---

## Chunk 1 — Selected-date correctness (bugs)

Governing CLAUDE.md rules: **timezone** (`todayInTz()`, never `toISOString().slice(0,10)`),
**date arithmetic** (client "today" sources must not mix), **report faithfully** (the ring must
not show numbers that belong to a different day).

### 1.1 (high) — today's burned calories inflate past-day macro rings

`app/nutrition/nutrition-content.tsx` mixes two "calories burned" sources and applies the result
to whatever date is on screen:

- `:195-198` reads the **selected date's** activity logs from the local store;
- `:219-222` (`body-metadata` cachedFetch) then overwrites `calsBurnedToday` with the server's
  **today-only** figure (`app/api/body-metadata/route.ts:115-117` computes it from
  `todayActivityLogs`), regardless of `selectedDate`;
- `:315-320` adds it to the calorie goal and `:398-405` passes it to `MacroRing`.

Viewing yesterday after a 500-kcal run today shows yesterday's ring against an inflated goal.

- [ ] **Fix:** gate the adjustment on the selected date being today. Keep the state as-is
  (it genuinely holds *today's* burn) and derive at render:

```tsx
const burnedForSelectedDate = selectedDate === todayStr ? calsBurnedToday : null;
const effectiveCalorieGoal = targets?.calories != null && burnedForSelectedDate != null && burnedForSelectedDate > 0
  ? targets.calories + Math.round(burnedForSelectedDate)
  : targets?.calories ?? null;
```

  Pass `burnedForSelectedDate` (not `calsBurnedToday`) to `<MacroRing calsBurnedToday={…}>`.
  Also guard the local-store read at `:195-198` with `if (today === todayStr)` so the two
  sources stop disagreeing (the store read currently uses the selected date, the server read
  always uses today).
- [ ] **Verify (`pnpm dev`):** log an activity today; chevron to yesterday → yesterday's ring
  target equals the base target and shows no "+burned" adjustment; back to Today → adjusted.

### 1.2 (medium) — `handleFoodLogged` appends a log without checking its date

`app/nutrition/nutrition-content.tsx:236-242` — `setLogs(prev => [...prev, newLog])` blindly
appends to the displayed day. R5 NUT-3 fixes the known *cause* (saved-meal quick-log writing to
today while a past date is shown); this guard fixes the *mechanism* so no future caller can
repaint a log under the wrong day.

- [ ] **Fix:**

```tsx
const handleFoodLogged = useCallback((newLog?: FoodLogWithItem) => {
  if (newLog) {
    if (newLog.date && newLog.date !== selectedDateRef.current) return; // lands via cache invalidation
    setLogs(prev => [...prev, newLog]);
  } else {
    fetchData(selectedDateRef.current);
  }
}, [fetchData]);
```

  `FoodLogWithItem.date` exists on the server rows (the `applyDelta` mapping at `:172-177`
  writes it); confirm the type carries it (`lib/types/nutrition.ts`) and add it there if it is
  optional-only on some paths — the callers (`logFoodEntries`/`logMealItems`) know the date they
  wrote and must return it on the log.
- [ ] **Verify:** with R5 NUT-3 landed, quick-log a saved meal while viewing yesterday → it
  appears under the date it was written to, never the wrong screen.

### 1.3 (medium) — supplement outbox mutations stamped with the UTC date

`components/nutrition/manage-supplements-sheet.tsx:67,144,184` — the banned pattern, three sites:

```ts
date: now.slice(0, 10),   // now = new Date().toISOString() → UTC date, wrong before 10am AEST
```

- [ ] **Fix:** `date: todayInTz()` at all three sites (import from `@/lib/date-utils`).
  Sibling check: `supplements-section.tsx:33` already uses `todayInTz()` — after this fix, grep
  `components/nutrition/` for `slice(0, 10)` and confirm zero hits.
- [ ] **Verify:** unit-level is enough (pure string) — add the three sites to the reviewer
  checklist; device outbox behaviour unchanged otherwise.

### 1.4 (medium, product) — supplements section is date-blind

The section always shows **today's** logged/unlogged state (`nutrition-content.tsx:246-275`
loads `getSupplementLogs(todayInTz())` once) even while a past date is displayed — it silently
mislabels history. Backfilling past-day supplement logs is out of scope (needs date-threaded
writes); the honest minimal fix is to not show today's state on a past day.

- [ ] **Fix:** render the section only for today:

```tsx
{selectedDate === todayStr && (
  <SupplementsSection supplements={supplements} loading={supplementsLoading} onChanged={setSupplements} userId={userId} />
)}
```

- [ ] **Verify:** chevron to yesterday → no supplements section; Today → unchanged behaviour.

---

## Chunk 2 — Instant paint & fetch discipline on the sub-sheets

Governing CLAUDE.md rules: **instant paint** (a skeleton flash on a repeat visit is a bug; seed
from cache synchronously), **client GETs of `/api/*` use `cachedFetch` with a `readCacheSync`
seed, never bare `fetch`; reuse existing keys**, **saves feel instant**, **new cache keys are
registered in the invalidation group of every affecting write in the same commit**.

### 2.1 (medium) — supplements have no cache seed → skeleton flash every mount

The `useLayoutEffect` seed (`nutrition-content.tsx:88-102`) covers six keys but not
`supplements`; `supplementsLoading` starts `true` and only resolves after the async local-store
read (or network), so the section skeletons on every visit.

- [ ] **Fix:** add to the layout effect:

```tsx
const supps = readCacheSync<SupplementWithStatus[]>('supplements');
if (supps) { setSupplements(Array.isArray(supps) ? supps : []); setSupplementsLoading(false); }
```

  The local-store/network effect at `:246-275` still runs and reconciles. Note the `supplements`
  payload embeds `loggedToday` — the existing key is already invalidated on supplement writes via
  `invalidateSupplements` (verified in `lib/cache-groups.ts`), and it is a today-scoped payload:
  keep the seed but only trust `loggedToday` when the cached entry is same-day — reuse the
  `cachedFetchToday` envelope for this key **at every call site in the same commit** (one fetch
  variant per key; grep for `'supplements'` — the other reader is the More/profile surface) or,
  if the churn is too wide, seed only the definition fields and leave `loggedToday` to the async
  read. Decide at implementation; the today-envelope is the correct end state.
- [ ] **Verify:** repeat-visit Nutrition (warm cache) → supplements paint instantly, no skeleton;
  cross midnight (or fake the cache date) → no stale ticks.

### 2.2 (medium) — SavedMealsSheet: spinner + bare fetches on every open

`components/nutrition/saved-meals-sheet.tsx:53-62` bare-fetches `/api/nutrition/saved-meals` +
`/api/nutrition/meal-types` behind `setLoading(true)` → `Loader2` every open.

- [ ] **Fix:** replace `fetchMeals` with two `cachedFetch` calls + sync seeds:
  - meal types: **reuse** the existing `nutrition-meal-types` key (`TTL_LONG`), as
    `assign-step.tsx:31` already does;
  - saved meals: new key `saved-meals` (`TTL_MEDIUM`), seeded via `readCacheSync` before first
    paint; show the spinner only when both seed and cache miss.
- [ ] **Register the new key in the same commit:** add to `lib/cache-groups.ts`:

```ts
/** Saved-meal definitions changed (create/update/delete in the saved-meals sheet). */
export async function invalidateSavedMeals(): Promise<void> {
  await invalidateCache('saved-meals')
}
```

  and call it after every successful meal create/update/delete in the sheet (grep the sheet for
  its POST/PUT/DELETE handlers). Logging a meal does not change the definitions — no call there.
- [ ] **Verify:** open Saved Meals twice — second open paints the list with no spinner; create a
  meal → reopen shows it (no TTL wait).

### 2.3 (low) — FoodLibrarySheet double-fetches on open, never seeds

`components/nutrition/food-library-sheet.tsx:21-42` — the mount effect fetches `?q=''` AND the
debounced effect fires again with `query === ''` 250 ms later; no cache.

- [ ] **Fix:** delete the mount effect; let the single debounced effect own all fetching. For
  the empty query, use `cachedFetch` with key `nutrition-food-items-all` (`TTL_MEDIUM`) + sync
  seed so the library paints instantly; typed queries stay bare `fetch` (dynamic search).
  Register `nutrition-food-items-all` in `invalidateNutritionWrite()`
  (`lib/cache-groups.ts:238-250`) in the same commit — every food log can create a food item.
- [ ] **Verify:** open the library → exactly one `?q=` request (Network panel), instant list on
  reopen; log a new scanned food → reopen shows it.

### 2.4 (low) — capture-step "Recently logged here" bare GET

`components/nutrition/capture-step.tsx:30-36` — bare `fetch('/api/nutrition/recent-for-meal…')`;
the recents block pops in late.

- [ ] **Fix:** `cachedFetch` with key `` `nutrition-recent-for-meal:${preselectedMealTypeId}` ``
  (`TTL_MEDIUM`) + `readCacheSync` seed. Add the prefix `nutrition-recent-for-meal:` to
  `invalidateNutritionWrite()` in the same commit (a new log changes the recents).
- [ ] **Verify:** open the logger twice for the same meal → recents paint instantly the second
  time; log something → recents update on next open.

### 2.5 (medium) — MealTypeManager: spinner despite warm cache; feedback blocks on two round-trips; unguarded delete

`components/nutrition/meal-type-manager.tsx` — `:64` bare-fetches the list behind a `Loader2`
even though `nutrition-meal-types` is warm from the page; `saveEdit`/`addNew`/`deleteMealType`
(`:61-131`) each `await fetch` **then** `await load()` (a second round-trip) before any feedback;
`deleteMealType` has no in-flight guard (double-tap → two DELETEs).

- [ ] **Fix (read):** seed from `readCacheSync('nutrition-meal-types')` and load via `cachedFetch`
  on the same key — spinner only on a true cold miss.
- [ ] **Fix (writes):** apply the mutation to local state synchronously (optimistic), toast +
  close the row immediately, fire the fetch, and on response reconcile via
  `invalidateMealTypes()` + one background `cachedFetch` refresh (no awaited `load()` in the
  interaction path); on a failed response, revert the optimistic row and toast the error. Add a
  `deleting` guard mirroring the existing `saving` guard.
- [ ] **Fix (reorder):** apply the reorder in **`onDragOver`**, not `onDragEnd` (the CLAUDE.md
  `@dnd-kit/react` WebView rule). R5 NUT-11 already moves the PATCH out of the state updater —
  build on that shape; this task only changes *when* the array reorder is applied.
- [ ] **Verify:** open Meal Types settings twice → list paints instantly; rename on a throttled
  connection → row flips instantly, server reconciles; double-tap delete → one DELETE in the
  Network panel; drag-reorder on device survives sheet close (device smoke).

### 2.6 (low) — food-log delete triggers a full-page refetch

`nutrition-content.tsx:296-297` and `:312` call `fetchData()` after a delete even though the
optimistic filter (`:288`) already updated the list and `invalidateNutritionWrite()` cleared the
derived caches.

- [ ] **Fix (after R6 PERF-5 lands):** replace both `fetchData()` calls with the two reads the
  delete actually affects:

```ts
loadFoodLogs(selectedDateRef.current);
cachedFetch('nutrition-weekly-summary', '/api/nutrition/weekly-summary', TTL_MEDIUM,
  d => setWeeklyData(Array.isArray(d) ? d : []));
```

- [ ] **Verify:** delete a log → Network panel shows only `food-logs` + `weekly-summary`
  requests; ring, meal card and weekly chart all update.

### 2.7 (medium) — `MealCard` re-renders on every parent state change

`components/nutrition/meal-card.tsx:18` is not memoized, and the call site
(`nutrition-content.tsx:416-425`) passes three inline arrows plus a fresh `logs.filter(...)`
array per render — every supplements/targets/loading state change re-renders every meal card
including its `AnimatePresence` subtree.

- [ ] **Fix:** `export const MealCard = React.memo(function MealCard(…) {…})`; at the call site
  hoist stable callbacks and group logs once:

```tsx
const openLogger = useCallback((mealTypeId: string) => { setLoggerMealTypeId(mealTypeId); setLoggerOpen(true); }, []);
const requestDelete = useCallback((logId: string) => setConfirmDeleteLogId(logId), []);
const openQuickEdit = useCallback((log: FoodLogWithItem) => setEditingLog(log), []);
const logsByMealType = useMemo(() => {
  const m = new Map<string, FoodLogWithItem[]>();
  for (const l of logs) { const arr = m.get(l.mealTypeId) ?? []; arr.push(l); m.set(l.mealTypeId, arr); }
  return m;
}, [logs]);
…
<MealCard key={mt.id} mealType={mt} logs={logsByMealType.get(mt.id) ?? EMPTY_LOGS}
  onAdd={openLogger} onDeleteLog={requestDelete} onQuickEdit={openQuickEdit} />
```

  (`const EMPTY_LOGS: FoodLogWithItem[] = []` at module scope so empty cards get a stable ref.)
- [ ] **Verify:** React DevTools profiler — toggling a supplement no longer re-renders meal
  cards; logging food re-renders only the affected card.

---

## Chunk 3 — Cache/API hygiene (server)

Governing CLAUDE.md rules: **aggregate GET routes ship SWR headers**, **ingest/write routes get a
Zod schema at creation**, **no orphaned findings**.

### 3.1 (medium) — SWR headers missing on six nutrition GETs

`weekly-summary`, `adherence` and `supplements` already send
`Cache-Control: private, max-age=60, stale-while-revalidate=120`; these siblings don't:
`app/api/nutrition/food-logs/route.ts` (GET), `app/api/nutrition/meal-types/route.ts` (GET),
`app/api/nutrition/targets/route.ts` (GET), `app/api/nutrition/saved-meals/route.ts` (GET),
`app/api/nutrition/recent-for-meal/route.ts`, `app/api/nutrition/food-items/route.ts` (GET).

- [ ] **Fix:** add the identical header object to each GET's `NextResponse.json` (match the
  sibling routes verbatim). Re-verify each at implementation time — R5/R2 follow-ups may have
  touched some.
- [ ] **Verify:** `curl -sI` each route on `pnpm dev` (with a session cookie) → header present.

### 3.2 (medium) — saved-meals POST has no Zod schema

`app/api/nutrition/saved-meals/route.ts:14-24` validates only `name` truthiness and an
`items.length > 100` cap — the `items` element shape (foodItemId, quantity) passes to
`repo.createSavedMeal` unvalidated (untyped numeric passthrough). Sibling write routes
(`meal-types`, `targets`, `food-items`) all have schemas; R1 added ownership to the **update**
path only.

- [ ] **Fix:** add a schema matching what `createSavedMeal` consumes (read the repo function
  first to get the exact field names):

```ts
const SavedMealSchema = z.object({
  name: z.string().min(1).max(120),
  items: z.array(z.object({
    foodItemId: z.string().uuid(),
    quantityMultiplier: z.number().min(0.01).max(100),
  })).max(100).default([]),
})
```

  `safeParse` → 400 on failure. Sweep `app/api/nutrition/saved-meals/[id]/route.ts` (PUT) for the
  same gap in the same commit (sibling-surface rule) — R1's ownership fix there may not have
  added body validation.
- [ ] **Verify:** POST junk (`items: [{foodItemId: 1}]`) → 400; the saved-meals sheet's create
  flow still works end-to-end on `pnpm dev`.

### 3.3 (low, verify-then-fix) — end-of-day save invalidation sweep

`components/nutrition/end-of-day/end-of-day-review.tsx:182` invalidates only
`invalidateHealthTrends()` (the `health-trends:` prefix) after writing the day check-in
(wellness scales / sore muscles / journal). The bare `health-trends-summary` key and any
readiness/mood-derived cache are untouched.

- [ ] **Investigate:** grep which cached keys render `day_checkins`-derived data
  (`health-trends-summary`, `readiness-score`, mood/check-in cards on Home). List them.
- [ ] **Fix:** if any are affected, add a `invalidateDayCheckinWrite()` group in
  `lib/cache-groups.ts` containing them and call it from the EOD save **and** every sibling
  check-in write surface (the mood sheet — sibling-surface sweep). If nothing else consumes the
  check-in, record that conclusion in the PR description and change nothing.
- [ ] **Verify:** save an EOD review → any Home/Health card that renders the check-in refreshes
  without a TTL wait.

---

## Chunk 4 — Theme / a11y (nutrition-scoped)

Governing CLAUDE.md rules: **never pass `var(--x)` to chart.js/canvas** (`resolveColor` is a
shared import), **semantic palettes defined once in `lib/`**, **theme tokens, never hex
literals**, **touch targets ≥ 48dp**, **real controls with aria state**, **stable client ids,
never `key={index}`**.

### 4.1 (high) — weekly chart passes `var(--…)` to chart.js ticks/grid

`components/nutrition/weekly-nutrition-chart.tsx:83-86`:

```ts
x: { grid: { display: false }, ticks: { color: 'var(--muted-foreground)', font: { size: 11 } } },
y: { grid: { color: 'var(--border)' }, ticks: { color: 'var(--muted-foreground)', … } },
```

Canvas `fillStyle` can't resolve custom properties → black ticks/gridlines (invisible on the dark
theme). This is the **third** instance of R7's UI-H1 class (that plan fixes
`workout-load-comparison-chart` + `trend-chart` and hoists `resolveColor` to
`lib/chart-colors.ts`).

- [ ] **Fix:** `import { resolveColor } from '@/lib/chart-colors'` and resolve both:
  `ticks: { color: resolveColor('var(--muted-foreground)') }`,
  `grid: { color: resolveColor('var(--border)') }`. Memoize the options object so resolution runs
  per theme change, not per render (the component already re-renders on `metric` changes).
- [ ] **Verify:** `pnpm dev` dark + light — ticks/gridlines visible in both; on-device check on
  the S25 (Samsung WebView is where the black-render manifests).

### 4.2 (medium) — chart series colours are hex literals duplicating the macro palette

`weekly-nutrition-chart.tsx:32-37` hardcodes `#00ff87 / #3b82f6 / #f59e0b / #ec4899` while the
canonical macro palette already exists (`lib/nutrition/macro-colors.ts`, used by `macro-ring.tsx`
and `meal-card.tsx`) — a drifting second copy of a semantic palette.

- [ ] **Fix:** source protein/carbs/fat from `MACRO_COLORS` (resolve to concrete values for
  canvas via `resolveColor` where they are CSS vars) and calories from the brand/accent token;
  keep `METRIC_CONFIG` but make it derive from the shared palette. Replace the selected-pill
  `text-black` (`:101`) with a token pair readable in both themes.
- [ ] **Verify:** chart series colours match the macro ring's; pills legible in light + dark.

### 4.3 (medium) — status-colour hex literals in EOD + supplements chrome

- `components/nutrition/end-of-day/day-summary-card.tsx:13-17` — `#ef4444/#f59e0b/#22c55e`
  battery colours (+ `text-red-400` at `:68`);
- `components/nutrition/end-of-day/today-insight-card.tsx:15-18` — `rgba(34,197,94,…)` + `#22c55e`;
- `components/nutrition/end-of-day/scale-selector.tsx:3,16` — default `color = '#6b7280'`,
  `color: '#000'`;
- `components/nutrition/supplements-section.tsx:122-125` — `bg-green-500 border-green-500` +
  `text-white` on the logged tick.

- [ ] **Fix:** swap to theme tokens (`--accent-*` / semantic Tailwind theme colours). Where a
  colour encodes a band/state, confirm a text label or icon accompanies it (all four sites
  already pair a label — keep it that way).
- [ ] **Verify:** EOD sheet + supplements section in light theme — no black-on-dark or
  white-on-light artifacts.

### 4.4 (low) — tap targets under the 48dp floor (new sites)

R5 NUT-11 covers the meal-card/manager/saved-meals icon buttons. New this review:
`weekly-nutrition-chart.tsx:100` metric pills `min-h-[40px]`;
`end-of-day/end-of-day-review.tsx:206` close button `p-2.5` around a `w-5` icon (~40 px).

- [ ] **Fix:** `min-h-[48px]` on the pills (adjust `py`), bump the close button padding to reach
  ≥48 px.
- [ ] **Verify:** on-device tap check (device smoke); visually confirm no layout break at 640 px.

### 4.5 (low) — supplement toggle has no accessible state

`supplements-section.tsx:112-126` — the log toggle is a `<button>` whose logged/unlogged state is
conveyed only visually.

- [ ] **Fix:** add `aria-pressed={s.loggedToday}` to the button.

### 4.6 (medium) — review-step ingredient rows keyed by index

`components/nutrition/review-step.tsx:217-218` — `ingredients.map((ing, idx) => <div key={idx}>`
around editable weight inputs; a refine/new scan that replaces the array carries stale input/focus
state into the wrong row (the documented `key={index}` editable-list class).

- [ ] **Fix:** give ingredients a stable client id where the array is first constructed (the scan
  response mapping in `food-logger-sheet.tsx` / wherever `EditableNutrition.ingredients` is
  seeded): `clientId: crypto.randomUUID()` added to the client-side ingredient type; use
  `key={ing.clientId}` and pass `clientId` (not index) to `handleIngredientWeightChange` or keep
  the index for the update but key by `clientId`. Coordinate with R5 NUT-9 (which touches the
  same file's totals math) — land after it.
- [ ] **Verify:** scan a meal, refine to a different ingredient count → no weight value jumps
  rows; focus stays sane.

### 4.7 — reviewed, accepted as-is (record, no code change)

- **Meal-type emoji** (`meal-card.tsx:35`, `assign-step.tsx:79`): the emoji is a **user-chosen
  schema field** (`meal_types.emoji`), i.e. user data, not chrome — the Lucide-not-emoji rule
  targets chrome glyphs. Accepted; the one chrome emoji (⏰) is already planned in R5 NUT-11.
- **Barcode scanner `text-white`/`border-white`** (`barcode-scanner.tsx:155-186`): overlay chrome
  on a live transparent camera feed — theme tokens don't apply there. Accepted.
- **TDEE-apply invalidation** was flagged in review but is a **non-issue**: adherence measures
  logging completeness (not intake vs target) and `invalidateGoalRecommendations` already covers
  `nutrition-targets`. No action.

---

## Chunk 5 — Display & grouping + product additions

Governing CLAUDE.md rules: **instant paint**, **check module-map before new infra** (WaterLogSheet
and the local store already exist — reuse), **local SQLite migrations: register new tables in
`RECONCILE_TABLES` in the same commit**, **offline-first read/write pairing**.

Current section order: MacroRing → TDEE card → meal cards → full-width "Saved Meals" button →
full-width "End of Day review" button → weekly chart → adherence card → supplements. Three
separate full-width blocks (two buttons + adherence) cost a screen of scroll on the 6.9" target.

### 5.1 (medium) — merge the adherence card into the weekly chart card

- [ ] **Fix:** pass `adherence` into `WeeklyNutritionChart` and render the two percentage rows
  (7-day / 28-day, `nutrition-content.tsx:457-476`) as a compact footer inside the chart card
  (divider + two `flex justify-between` rows, same typography); delete the standalone card.
  Keep the `requiredMealTypeCount > 0` gate.
- [ ] **Verify:** one "7-day nutrition" card shows chart + adherence; card hidden-footer when no
  required meal types.

### 5.2 (low) — compact quick-action row

- [ ] **Fix:** replace the two stacked full-width buttons (`nutrition-content.tsx:437-453`) with
  a `grid grid-cols-2 gap-3` row of two compact cards (icon + label, ≥48 px tall), same handlers.
- [ ] **Verify:** both open their sheets; row renders correctly at 360–640 px widths.

### 5.3 (medium) — water tile on the Nutrition tab

Hydration is a nutrition-domain metric with no presence on this tab — water logging lives only on
Health and Home (`components/profile/water-log-sheet.tsx`, `/api/water-log`), while the page
already fetches the data (`body-metadata` → `today.waterMl`).

- [ ] **Fix:** keep `todayWaterMl` state alongside `calsBurnedToday` (set from the same
  `body-metadata` seed at `:100-101` and fetch at `:219-222`, guarded by `isBodyMetadataFresh`);
  render a small water card (Lucide `Droplets`, current ml, a `+` button) between the MacroRing
  and the TDEE card, **today only** (same `selectedDate === todayStr` gate as 1.4); the `+`
  opens `WaterLogSheet` (static import — it's a lightweight sheet; match how
  `health-content.tsx:37` imports it) with `onLogged={(ml) => setTodayWaterMl(v => (v ?? 0) + ml)}`.
  `WaterLogSheet` already invalidates `body-metadata` — no new invalidation wiring.
- [ ] **Verify:** log 500 ml from Nutrition → tile updates instantly; Home/Health water tiles
  agree after their next paint; tile absent on past dates.

### 5.4 (medium, device) — meal types render offline: read-only local mirror

Meal types have **no local table** — offline, the page's meal cards exist only via the
`nutrition-meal-types` localStorage seed (R5 flags this; R3 does not build it). Food logs render
local-first but their grouping data doesn't. Build the *minimal* offline mirror — a read-only
reference table hydrated from successful GETs, **not** a synced/outbox domain (meal-type editing
stays online-only in `MealTypeManager`).

- [ ] **Migration:** new local SQLite table `meal_types` (columns mirroring the API payload:
  `id TEXT PRIMARY KEY, name TEXT, emoji TEXT, time_start_hour INTEGER, time_end_hour INTEGER,
  sort_order INTEGER, reminders_enabled INTEGER, required INTEGER, updated_at TEXT` — read the
  actual `MealType` type first and mirror it exactly). Bump the local schema version; new-table
  `CREATE TABLE IF NOT EXISTS` is idempotent (no `ADD COLUMN` hazard); register in
  `RECONCILE_TABLES`/`RECONCILE_COLUMNS` **in the same commit** (`lib/local-store/`).
- [ ] **Hydrate:** in `nutrition-content.tsx`'s meal-type fetch `onData`, when a store exists,
  `store.replaceMealTypes(list)` (delete-all + insert — it's a read-only mirror keyed by the
  server, so replace semantics are safe and handle deletions).
- [ ] **Read local-first:** when a store exists, read `store.getMealTypes()` before/alongside the
  `cachedFetch` (same shape as the supplements reference pattern at `:246-275`): local rows render
  immediately, server response re-hydrates.
- [ ] **Verify (device-only — flag NOT-verified-on-web):** APK in airplane mode after one online
  visit → meal cards render with names/emoji and local food logs grouped under them. Web
  `pnpm dev` only proves the plumbing compiles and hydrate runs (`getLocalStore` is null on web).

---

## Test plan (all chunks)

1. **Web (`pnpm dev`, local dev DB, ≤640 px viewport):** 1.1 ring gating, 1.2 date-guard, 2.1–2.7
   paint/network-panel checks, 3.1 header curls, 3.2 Zod 400s, 4.1–4.3 both themes, 5.1–5.3
   layout + water flow.
2. **Unit:** add cases where pure logic changed — the 1.2 guard (append vs skip by date) and the
   3.2 schema (valid/invalid bodies) at minimum; run the existing nutrition suites.
3. **APK smoke (`docs/device-smoke-checklist.md`):** 1.3 outbox date (write a supplement before
   10am AEST equivalent), 2.5 drag-reorder persistence, 4.1 canvas colours on Samsung WebView,
   4.4 tap targets, 5.4 offline meal cards. If no device is available in-session, add a
   `projectOverview.md` Known-Issues row marking these NOT verified on device.
4. Full gate before presenting: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`.
