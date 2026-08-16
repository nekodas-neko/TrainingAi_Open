# Nutrition Fixes — Quick-Edit Corruption, Date/Validation Bugs, Reminder Lifecycle, Formula Dedup, Hygiene

**Source review:** `docs/reviews/2026-07-06-full-app-overview-review.md` §6 (batch **R5**). **Branch:**
`fix/nutrition-fixes`. All findings are **server/JS + client** work — they ship via Railway into the
WebView with **no APK rebuild**, and every fix is testable against the local dev DB with `pnpm dev`.
Two paths are **offline/native-only** and must be flagged NOT-verified-on-web at merge: the
`QuickEditLogSheet` local-store branch (NUT-2) and the supplement/meal reminder cancellation
(NUT-5, `LocalNotifications` no-ops off-device) — verify these on the S25 APK per
`docs/device-smoke-checklist.md`.

**Goal:** stop the quick-edit sheet corrupting food logs, fix saved-meal/quantity date and validation
bugs, make supplement reminders cancel on disable/delete and the daily digest refresh after new
food, de-duplicate the triplicated ingredient-totals math, and clear the nutrition a11y/token/clamp
debt.

Re-verified against `main` on 2026-07-09 — every finding below still reproduces; line numbers updated
to current code. Nothing was dropped as already-fixed.

**Cross-refs (not planned here):**
- **NUT-6 = CACHE-F5** — `invalidateNutritionWrite()` (`lib/cache-groups.ts:182-193`) omits
  `nutrition-adherence`, so the adherence card (`nutrition-content.tsx:457-476`) is stale after a
  food write. **R2 owns the cache-group fix.** One call-site note lands here: `MealTypeManager`
  invalidates with a bare `invalidateCache('nutrition-meal-types')` at four sites
  (`meal-type-manager.tsx:90,107,125,150`) instead of a named group helper — when R2 adds a
  nutrition/meal-type group, swap these to it (CLAUDE.md: "writes go through cache groups, never
  hand-rolled key lists").
- **NUT-8 = SEC-2/SEC-6 (R1)** `updateSavedMeal` ownership + supplements/meal-types mass-assignment,
  and **SYNC-O2 (R3)** offline food-item creation — do not double-plan.

---

## Chunk 1 — Data-corruption, date, and validation bugs (NUT-1, NUT-2, NUT-3, NUT-4)

Governing CLAUDE.md rules: **offline-first local-first reads**, **mutation-callback contract**
(`onLogged(log)`/`onSaved(log)`, never a parameterless "please refetch"), **timezone / date
arithmetic** (thread the selected date, don't assume `todayInTz()`), **Zod `.optional()` rejects
null — omit empty fields**.

### 1. NUT-1 (high) — quick-edit sheet shows and saves a stale quantity

`QuickEditLogSheet` seeds its quantity once in a lazy initializer and is mounted permanently with no
`key` and no re-sync effect, so it never re-reads a newly-opened log:

`components/nutrition/quick-edit-log-sheet.tsx:23`
```ts
const [qty, setQty] = useState(() => log?.quantityMultiplier ?? 1)
```
`app/nutrition/nutrition-content.tsx:502`
```tsx
<QuickEditLogSheet log={editingLog} onClose={() => setEditingLog(null)} onSaved={fetchData} userId={userId} />
```
Opening a ×2 log shows ×1; **saving an untouched sheet overwrites the log to the stale ×1** (silent
data corruption); a second edit inherits the first edit's value.

**Fix** — remount the sheet per log so the initializer re-runs with the correct seed. At the
call site (`nutrition-content.tsx:502`):
```tsx
<QuickEditLogSheet key={editingLog?.id} log={editingLog} onClose={() => setEditingLog(null)} onSaved={handleQuickEditSaved} userId={userId} />
```
(`onSaved` is rewired in NUT-2 below.) A `key` is preferred over a sync effect — it also resets
`saving` and any transient sheet state, matching the Zustand-store transient-state rule.

**Verify:** open a ×2 log → stepper shows ×2; open a ×1 log immediately after → shows ×1; save an
untouched ×2 log → the row stays ×2 (was corrupted to ×1).

### 2. NUT-2 (medium) — quick-edit list update gated on the network push; parameterless callback

The invalidate + callback only run **inside** `pushMutations().then()`, so offline (or on any push
failure) the displayed list keeps the old quantity even though the local store already holds the new
one; and `onSaved()` is a parameterless refetch (mutation-callback-contract violation):

`components/nutrition/quick-edit-log-sheet.tsx:62-68`
```ts
toast.success('Updated')
onClose()
pushMutations(userId!).then(() => {
  invalidateNutritionWrite().catch(() => {})
  onSaved()
}).catch(() => {})
savedLocally = true
```

**Fix** — fire the cache-invalidation and the callback **synchronously after the local write**,
keep `pushMutations` fire-and-forget, and hand the callback the updated log (contract). Change the
prop type to `onSaved: (updatedLog: FoodLogWithItem) => void` and build the updated row from the
data the sheet already has (`log.foodItem` + the new `qty`, reusing the existing preview math at
`quick-edit-log-sheet.tsx:29-32`):
```ts
const updatedLog: FoodLogWithItem = {
  ...log,
  quantityMultiplier: qty,
  calories: previewCals, proteinG: previewProtein, carbsG: previewCarbs, fatG: previewFat,
}
toast.success('Updated')
onClose()
invalidateNutritionWrite().catch(() => {})
onSaved(updatedLog)
pushMutations(userId!).catch(() => {})   // reconcile in the background
savedLocally = true
```
Apply the same `onSaved(updatedLog)` in the web-fallback branch (`:82-85`). In
`nutrition-content.tsx`, replace the parameterless `fetchData` with an in-place updater:
```tsx
const handleQuickEditSaved = useCallback((updated: FoodLogWithItem) => {
  setLogs(prev => prev.map(l => l.id === updated.id ? updated : l))
}, [])
```

**Verify (device):** in airplane mode, edit a log ×2 → the meal card and macro ring update instantly
to the new quantity and survive a navigate-away/return; re-enabling network reconciles with no visual
change.

### 3. NUT-3 (medium) — saved-meal quick-log writes today but UI appends to the selected date

`quickLog` hardcodes `todayInTz()`, while the parent appends the returned logs to the currently
**displayed** (possibly past) day's list and ring — so logging a saved meal while viewing "Yesterday"
writes to today yet shows on yesterday:

`components/nutrition/saved-meals-sheet.tsx:176-185`
```ts
async function quickLog(meal: SavedMeal) {
  const hour = new Date().getHours()
  const mealTypeId = mealTypes.find(m => hour >= m.timeStartHour && hour < m.timeEndHour)?.id ?? mealTypes[0]?.id
  ...
  const today = todayInTz()
  const logs = await logMealItems(meal, today, mealTypeId, userId)
```
`handleFoodLogged` (`nutrition-content.tsx:236-242`) blindly `setLogs(prev => [...prev, newLog])`.

**Fix** — thread the selected date into the sheet, exactly as `FoodLoggerSheet` already does
(`nutrition-content.tsx:492` passes `logDate={selectedDate}`; consumed at
`food-logger-sheet.tsx:163`). Add `logDate?: string` to `SavedMealsSheet`'s `Props`
(`saved-meals-sheet.tsx:21-26`), use it in `quickLog`:
```ts
const logDate = logDate ?? todayInTz()   // prop shadows helper
const logs = await logMealItems(meal, logDate, mealTypeId, userId)
```
Pass `logDate={selectedDate}` at the nutrition-content call site (`nutrition-content.tsx:495-500`),
**and** at the nested call site inside FoodLoggerSheet (`food-logger-sheet.tsx:237-242`, pass the
sheet's own `logDate`). Note the meal-type-of-day match still uses the current clock hour — that is
acceptable (a saved meal logged to a past day has no "current" window; first meal type is the
existing fallback).

**Verify:** navigate to "Yesterday", quick-log a saved meal → the item appears under yesterday and
the yesterday macro ring updates; switch to Today → it is not double-counted there.

### 4. NUT-4 (medium) — "+ Add as new food" sends `barcode: null` to a `.optional()` field → 400

`saved-meals-sheet.tsx:126` posts `barcode: null`; the route schema is
`barcode: z.string().max(20).optional()` (`app/api/nutrition/food-items/route.ts:19`), and Zod
`.optional()` accepts `string | undefined` but **rejects `null`**, so every "Add as new food" from
the meal builder 400s:

`components/nutrition/saved-meals-sheet.tsx:121-127`
```ts
body: JSON.stringify({
  name, calories,
  proteinG: parseFloat(addFoodForm.proteinG) || 0,
  carbsG: parseFloat(addFoodForm.carbsG) || 0,
  fatG: parseFloat(addFoodForm.fatG) || 0,
  servingSizeG: 100, source: 'manual', barcode: null,
}),
```

**Fix** — omit the field entirely (copy the pattern in `lib/nutrition/log-food.ts:82-95`, which
sends no `barcode`/`region`):
```ts
body: JSON.stringify({
  name, calories,
  proteinG: parseFloat(addFoodForm.proteinG) || 0,
  carbsG: parseFloat(addFoodForm.carbsG) || 0,
  fatG: parseFloat(addFoodForm.fatG) || 0,
  servingSizeG: 100, source: 'manual',
}),
```

**Verify:** Saved Meals → New Meal → search a term with no results → "+ Add … as new food" with
just name + calories → the food is created (201) and added as an ingredient (was a silent 400 +
"Failed to add food" toast).

---

## Chunk 2 — Reminder lifecycle + digest staleness (NUT-5, NUT-7)

Governing CLAUDE.md rules: **sibling-surface sweep** (a reminder scheduled on one path must be
cancellable on the sibling path), **no silent fallbacks / stale-after-write**, **AI routes**
(digest is deterministic-context + one `generateText`, already try-caught).

### 1. NUT-5 (medium) — disabled/deleted supplements' reminders are never cancelled

`computeSupplementReminderActions` **filters out** inactive/reminder-disabled supplements, so no
`cancel` action is ever emitted for them — the opposite of the meal reminder helper, which maps
**all** meal types and emits `cancel` for the disabled ones:

`lib/supplement-reminders.ts:31-32`
```ts
return supplements
  .filter(s => s.active && s.reminderEnabled && s.reminderTime)
```
contrast `lib/meal-reminders.ts:34-37`
```ts
return mealTypes.map((mt): MealReminderAction => {
  if (!mt.remindersEnabled || loggedIds.has(mt.id)) {
    return { mealTypeId: mt.id, type: 'cancel' }
  }
```
Compounding it, the manage sheet's save/toggle/delete handlers never call
`cancelSupplementReminder` (`manage-supplements-sheet.tsx` `handleSave`/`handleDelete`/`toggleActive`
at `:42-122`, `:124-167`, `:169-209`), so a scheduled OS notification survives disabling or deleting
the supplement.

**Fix (two parts):**
1. In `computeSupplementReminderActions`, emit `cancel` for supplements that are inactive or have
   reminders off/without a time, instead of dropping them (so a reconcile pass cleans them):
   ```ts
   return supplements.map((s): SupplementReminderAction => {
     const supplementId = s.id
     if (!s.active || !s.reminderEnabled || !s.reminderTime || s.loggedToday) {
       return { supplementId, type: 'cancel' }
     }
     const [hours, minutes] = s.reminderTime.split(':').map(Number)
     ...
   ```
   (`reconcileSupplementReminders` at `:87-91` already turns a `cancel` action into
   `LocalNotifications.cancel` + `delete notifiedMap[id]`.)
2. Call `cancelSupplementReminder(id)` (already exported, `:111-122`) directly in the manage-sheet
   handlers when a supplement is deleted (`handleDelete`, both local + web branches) or turned
   inactive/reminder-off (`toggleActive`, and `handleSave` when `reminderEnabled` is false),
   mirroring how `logFoodEntries` calls `cancelMealReminder` (`log-food.ts:199,226`).

**Same-class low — meal type deletion:** `MealTypeManager.deleteMealType`
(`meal-type-manager.tsx:98-111`) never calls `cancelMealReminder(id)`, so a deleted meal type's
scheduled reminder lingers. Add `cancelMealReminder(id)` after a successful delete in the same PR.

**Verify (device):** enable a supplement reminder for 2 min out, then disable/delete it → the OS
notification does not fire; delete a meal type with reminders on → its reminder does not fire.

### 2. NUT-7 (medium) — daily digest goes stale after logging more food

The digest is cached per-day in `ai_health_insights` and only regenerated when the client sends
`force`; the client never does, so a digest generated at lunch reports lunch totals all evening:

`app/api/daily-digest/route.ts:28-31`
```ts
if (!force) {
  const cached = await repo.getAiHealthInsight(userId, CACHE_SECTION, todayIso)
  if (cached) return NextResponse.json({ digest: cached, date: todayIso, cached: true })
}
```
`components/day-review-sheet.tsx:35` (the home "Your Day in Review" sheet — the only caller)
```ts
fetch("/api/daily-digest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
```

**Recommended fix — server-side staleness marker, no client cache-group needed.** The digest is a
DB-cached AI artifact, not a `cachedFetch` key, so a cache-group entry would not reach it. Instead,
persist the input-state signature alongside the cached digest and regenerate when it changes:
- Extend the cached row (or a sibling column) to store a cheap **content hash** of the digest's
  deterministic inputs — the `context` string is already assembled at `route.ts:126`
  (`const context = lines.join('\n')`). Store `hash(context)` when upserting
  (`repo.upsertAiHealthInsight`, `route.ts:141`).
- On a non-forced request, recompute the `lines`/`context` **first** (it's all local DB reads, no AI
  spend), compare the hash to the stored one, and only return the cache when they match; otherwise
  fall through to regeneration. This keeps the rate-limit guard (`route.ts:33`, 3/60s) as the spend
  ceiling and needs **no client change** — the digest refreshes automatically once new food/PR/
  check-in data lands, and is a no-op AI-cost when nothing changed.

This is preferable to (a) an unconditional `force` from the client (defeats the cache, burns the
rate limit on every open) or (b) a manual "regenerate" button (extra UI, still stale until tapped).
If the hashing plumbing is judged too large for this batch, the fallback is a **manual regenerate
button** in `DayReviewSheet` that re-POSTs with `{ force: true }` — smaller, but leaves the default
view stale. Recommend the hash approach; note the schema touch (one column on the insight row) means
a small idempotent migration — claim the next number against the directory + open plans.

**Verify:** open Day-in-Review; log another meal; reopen → digest reflects the new totals (was the
lunch-time digest all evening). Confirm no extra AI call when nothing changed (rate-limit counter /
`cached: true` path).

---

## Chunk 3 — Ingredient-totals formula dedup (NUT-9)

Governing CLAUDE.md rule: **One Formula, One Place** — "Two implementations of the same metric is a
bug by definition."

Ingredient totals are computed three ways with drifting rounding:
- **Canonical** `sumIngredients` (`lib/nutrition/scan-totals.ts:7-34`) — sums per-100g × weight,
  then an **Atwater cross-check** replaces calories when the model's per-100g figure disagrees with
  the macros by >40%.
- **Naive local copy** in `ReviewStep` (`components/nutrition/review-step.tsx:55-69`) — rounds
  **each ingredient** (`Math.round`/`r1`) then sums, no Atwater guard.
- **Per-ingredient rounding** in `ingredientsToEntries` (`lib/nutrition/log-food.ts:37-49`) — the
  path that actually creates one food_item per ingredient.

**Important semantic caveat (verify before collapsing):** `ReviewStep`'s preview is meant to match
what actually gets **logged**, and multi-ingredient meals are logged per-ingredient via
`ingredientsToEntries` (`food-logger-sheet.tsx:150-152`), which rounds each ingredient. The
canonical `sumIngredients` uses sum-then-Atwater, which can yield a **different** calorie total than
the sum of the rounded per-ingredient entries. A blind swap of ReviewStep → `sumIngredients` would
make the preview disagree with the logged rows.

**Fix — one shared per-ingredient reducer, used by both the preview and the logging path.** Add a
single exported helper (co-locate with `ingredientsToEntries` in `lib/nutrition/log-food.ts`, or in
`scan-totals.ts`) that returns the entry-consistent totals:
```ts
// Totals that equal the sum of the individually-logged per-ingredient entries.
export function sumIngredientEntries(ings: NutritionIngredient[], quantity = 1): {
  servingSizeG: number; calories: number; proteinG: number; carbsG: number; fatG: number
} {
  return ingredientsToEntries(ings, quantity).reduce(
    (acc, e) => ({
      servingSizeG: acc.servingSizeG + e.servingSizeG,
      calories: acc.calories + e.calories,
      proteinG: r1(acc.proteinG + e.proteinG),
      carbsG:   r1(acc.carbsG   + e.carbsG),
      fatG:     r1(acc.fatG     + e.fatG),
    }),
    { servingSizeG: 0, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )
}
```
Then delete `ReviewStep`'s local `sumIngredients` (`review-step.tsx:53-69`) and import
`sumIngredientEntries`, calling it in `handleIngredientWeightChange` (`review-step.tsx:126`). Leave
`scan-totals.ts`'s `sumIngredients` (with its Atwater cross-check) as the **single-item scan**
authority where it is genuinely used — do not force the multi-ingredient preview through it. Grep
for other `sumIngredients` / inline `caloriesPer100g * scale` sums and route them to the correct one
of the two (preview/log → `sumIngredientEntries`; single scan sanitise → `sanitiseNutrition`).

**Verify:** log a 3-ingredient AI scan; the ReviewStep total, the AssignStep total
(`assign-step.tsx:49-52`), and the sum of the three logged meal-card rows all agree to the gram/kcal.

---

## Chunk 4 — Hygiene, a11y, tokens, clamps (NUT-10, NUT-11)

Governing CLAUDE.md rules: **Lucide icons, never emojis**; **theme tokens, never hex literals**;
**real controls with aria**; **client clamps so a local write can't become an outbox poison pill**;
**date arithmetic** (thread `logDate`).

### 1. NUT-10 (low) — the "Save to my food library" toggle is decorative

`review-step.tsx:291-315` renders a `saveToLibrary` toggle, but `handleConfirm`
(`food-logger-sheet.tsx:137-174`) never reads `form.saveToLibrary` — and every logged food already
becomes a `food_items` row via `createFoodItem` (`log-food.ts:78-100`, unless it came from the
library), so the toggle controls nothing. It is also a hand-rolled `div`-switch with a `bg-white`
literal and no `aria`:
```tsx
<div
  className={`w-10 h-6 rounded-full transition-colors ${value.saveToLibrary ? 'bg-primary' : 'bg-muted'}`}
  onClick={() => set('saveToLibrary', !value.saveToLibrary)}
>
  <div className={`w-5 h-5 rounded-full bg-white shadow m-0.5 transition-transform ${value.saveToLibrary ? 'translate-x-4' : ''}`} />
</div>
```
**Fix — remove it** (recommended): delete the toggle and its conditional "Save as" field
(`review-step.tsx:291-315`) and drop `saveToLibrary` from `EditableNutrition` and the three `BLANK`/
`scanToEditable`/`itemToEditable` seeds (`food-logger-sheet.tsx:29,45,62,124`). Since logging always
persists the item, the toggle is misleading. If product wants an explicit opt-out of persistence
instead, that is a behaviour change (skip `createFoodItem` when off) and belongs in its own scoped
item — not this hygiene pass. Either way, do not leave a `bg-white` literal + non-interactive `div`;
if kept, it must become a shadcn `<Switch>` (as used in `manage-supplements-sheet.tsx:244`).

### 2. NUT-11 (low) — grouped hygiene

Bundle these small fixes; each is independent:

- **Quantity clamps (poison-pill guard).** The server rejects `quantityMultiplier` outside
  `0.01–100` (`app/api/nutrition/food-logs/route.ts:34`,
  `app/api/nutrition/food-logs/[id]/route.ts:11`). Client qty inputs have a `min` but **no max**, so
  a local write of qty > 100 succeeds and the push 400s → quarantined poison pill. Clamp to
  `≤ 100` at: `quick-edit-log-sheet.tsx:120` (`onChange` parse), `assign-step.tsx:108`
  (`setQuantity`), and the saved-meal builder `setQty` (`saved-meals-sheet.tsx:102-110`). e.g.
  `Math.min(100, Math.max(0.5, parseFloat(e.target.value) || 0.5))`.
- **`⏰` emoji → Lucide** in `manage-supplements-sheet.tsx:291` — replace with `<Clock className="w-3 h-3 inline …" />` (Lucide-not-emoji).
- **Hex literals → tokens** in `components/profile/water-log-sheet.tsx:127`
  (`style={{ background: '#38bdf8', color: '#fff' }}` on the Log button) — use a theme accent token /
  `<Button>` variant. (Note: this sheet lives under `components/profile/`, not `components/nutrition/`;
  same fix, adjust the path.)
- **Refine call omits `region`** — `review-step.tsx:137-141` re-POSTs to `/api/nutrition/scan` with
  only `{ text }`, dropping the regional-food context the initial scan may have carried. Thread the
  original `region` through if the scan route accepts it (verify the route's schema first).
- **`AssignStep` "Today after logging" ignores a past `logDate`** — it fetches
  `nutrition-food-logs-${todayInTz()}` and labels the preview "Today" (`assign-step.tsx:38-42,133-140`)
  even when the food is being logged to a past day (NUT-3's `logDate`). Thread `logDate` into
  `AssignStep`, fetch that date's logs, and relabel to the selected day (or hide the projection when
  `logDate` is not today).
- **dnd side-effect inside a functional updater** — `MealTypeManager.handleDragEnd` fires the reorder
  `PATCH` inside `setMealTypes(prev => { … fetch(...) … return next })`
  (`meal-type-manager.tsx:138-152`). React may call the updater twice (StrictMode) → double PATCH, and
  the CLAUDE.md dnd rule is "persist drag-reorder synchronously in the handler, not via a side write
  in an updater." Compute `next` and `orderedIds` outside the updater, call `setMealTypes(next)`, then
  fire the PATCH once.
- **Meal types have no local table** — offline render depends on the `nutrition-meal-types` cache seed
  alone (`nutrition-content.tsx:90-91`). This is an offline-first gap (cross-ref R3's local-store
  work); note it, do not build a new synced domain in this hygiene pass.
- **`createFoodLog` foreign-id conflict → 500 not 403/409** — a bad `foodItemId`/`mealTypeId` FK
  yields a driver 500 instead of an ownership/validation status. Repo-level; cross-ref SEC (R1) —
  note only.
- **Meal-card pencil/trash ~26px targets** — the edit/delete buttons in `saved-meals-sheet.tsx`
  (`:252,255`) and `meal-type-manager.tsx` (`:41,44`) use `p-2.5` around a `w-3.5` icon (~34px incl.
  padding, borderline). Verify against the 48dp floor on-device; bump padding where under.

**Verify:** enter qty 250 in each qty input → clamps to 100 and the push is accepted; supplement
reminder-time row shows a Lucide clock; water Log button matches theme in light + dark; reorder a
meal type → one PATCH in the network tab; log to a past day from AssignStep → projection reflects
that day or is hidden.

---

## Test plan (all chunks)

Local dev server only exercises the web fallbacks and the deterministic logic; the local-store and
`LocalNotifications` paths are device-only.

1. **Web (`pnpm dev`, local dev DB):** NUT-1 stale-qty (works web too — pure React state), NUT-3
   date threading, NUT-4 add-food 201, NUT-7 digest refresh (hit `/api/daily-digest` twice with
   changed food), NUT-9 total agreement, NUT-10 removal, NUT-11 clamps/tokens/reorder.
2. **APK smoke (`docs/device-smoke-checklist.md`):** NUT-2 offline quick-edit persistence, NUT-5
   supplement/meal reminder cancellation on disable/delete. Mark these NOT-verified if no device is
   available this session and add a `projectOverview.md` Known-Issues row.
3. Run the existing nutrition/reminder unit tests (`lib/__tests__/`, `lib/health/__tests__/`) and add
   a `sumIngredientEntries` case (Chunk 3) plus a `computeSupplementReminderActions` "inactive →
   cancel" case (Chunk 2).
