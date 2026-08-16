# Batch A — UI / UX Fixes Design

**Date:** 2026-06-07  
**Branch:** `claude/training-goals-home-bugs-MfOPS`  
**Scope:** No new DB tables. Pure UI, routing, and display fixes across home screen, body screen, and profile.

---

## 1. Home Screen — Metric Tile Navigation

**File:** `app/session-select/session-select-content.tsx` → `case "metricTiles"`

**Current behaviour:** Each tile is a `<button onClick={() => openLog(def)}>` — tapping opens the body metric log sheet.

**New behaviour:**
- Outer tile button navigates to `/health` (`router.push('/health')`)
- A small `"Log"` chip (absolute-positioned, top-right corner of tile) intercepts the tap, calls `openLog(def)` with `e.stopPropagation()`, and prevents navigation
- The chip is always visible (mobile has no hover state)
- Chip style: `text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-foreground/10 border border-border/50`

---

## 2. Home Screen — Streak & This Week Navigation

**File:** `app/session-select/session-select-content.tsx` → `case "streak"`

**Current behaviour:** Both the Streak card and This Week card are plain `<div>` blocks — not tappable.

**New behaviour:** Each card becomes a `<button onClick={() => router.push('/stats')}>` with `active:scale-95 transition` and `w-full` so the layout is preserved.

---

## 3. Recommended Today — Mood Icon

**File:** `app/session-select/session-select-content.tsx` → mood button in `case "recommendation"`

**Current:** Empty state (no mood logged) shows `"🫀"` emoji.

**New:** Empty state shows `<MessageCircle className="h-5 w-5" style={{ color: "#fbbf24" }} />` — the same lucide icon already used in the mood widget card. When a mood is logged, the energy emoji continues unchanged.

---

## 4. Profile — Remove "View All Achievements" Button

**File:** `app/profile/profile-content.tsx`

Remove the `"View all {totalAchievements} achievements →"` button (around line 497–503). The expandable `x/N` count chip on the section header already provides this entry point — the second button is redundant.

---

## 5. Profile — Rename "Daily Goals" → "Goals"

**File:** `app/profile/profile-content.tsx` line ~587

Change the button label text from `"Daily Goals"` to `"Goals"`.  
Update the subtitle from `"Steps, sleep, calorie targets"` to `"Steps, water, calorie targets"` (water goal arrives in Batch B but the label should anticipate it).

---

## 6. Profile — Safe Zone Padding

**File:** `app/profile/profile-content.tsx`

The main scroll container has no `env(safe-area-inset-bottom)` padding. On S25 Ultra the content is clipped by the navigation bar.

Add `style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}` to the outermost scrollable `<div>`.

---

## 7. Profile — Phase Sets + Progression Styles → Advanced Settings

**File:** `components/config-screen.tsx`

**Current:** Phase Sets and Progression Styles are top-level accordion sections in the config screen.

**New:** Wrap both inside a new `"Advanced Settings"` collapsible accordion at the bottom of the config screen, collapsed by default. All other sections (program, sessions, schedule, exercise library) remain at the top level.

The accordion header label is `"Advanced Settings"` with a `Settings2` or `SlidersHorizontal` lucide icon. Expanding it reveals the Progression Styles section followed by the Phase Sets section, unchanged in their internal content.

---

## 8. Body Screen — Remove Mood Rows

**File:** `app/health/health-content.tsx`

Remove both mood blocks:
- The `moodLog === null` prompt block ("How are you feeling today?")
- The `moodLog &&` logged-mood row ("Mood logged · tap to edit")

Remove the two inline mood buttons, plus the `moodLog` state, `moodSheetOpen` state, and the `MoodCheckInSheet` render at the bottom — they are triggered exclusively by these two buttons and become dead code once removed. The mood fetch (`/api/mood`) can also be removed from the health screen's `useEffect`.

---

## 9. Body Screen — Always-Visible Biometric Tiles

**File:** `app/health/health-content.tsx`

**HRV / SpO₂ / Resting HR grid:**  
Remove `if (!hasAny && !metaLoading) return null`. The 3-column grid always renders. When a value is null and not loading, replace the number with `"No data"` in `text-muted-foreground text-xs` beneath the metric label.

---

## 10. Body Screen — Training Load "Not Enough Data"

**File:** `app/health/health-content.tsx`

**Current:** `{trainingLoad && (<div>...)}` — hidden when null.

**New:** Always render the Training Load card. When `trainingLoad` is null, or when `trainingLoad.acwr === 0`, display:
```
Not enough data yet
Track a few sessions to see your ACWR
```
in place of the number and interpretation badge. The explanatory InfoIcon paragraph remains visible so users understand what ACWR is.

---

## 11. Body Screen — Missing Data Source Tiles

Two data sources are tracked but not displayed in the body screen.

### Distance
- Source: `body_metrics.distanceKm` (from Health Connect via webhook)
- Add a Distance tile to the Steps/Sleep 2-column grid (making it a 3-tile row, or expand to grid-cols-3 if 3 metrics)
- Color: `#2dd4bf` (teal, matching the Distance tile on home screen)
- Shows today's value; falls back to most recent if today is null
- "No data" when no reading exists

### Calories Burned
- Source: `cardio_sessions.caloriesBurned` (sum of today's cardio sessions)
- The `/api/body-metadata` route needs to include `calsBurnedToday: number | null` — sum of `cardio_sessions.caloriesBurned` for `date = today`
- Display as a tile with color `#f97316` (orange, matching the Calories tile on home)
- Label: `"Burned"` to distinguish from `"Calories"` (food intake tile on home)
- "No data" when no cardio sessions today

---

## 12. Body Screen — Additional Calculated Metrics

From existing data, three more derived metrics are worth surfacing:

### BMI
- Formula: `weightKg / (heightCm / 100)²`
- Source: `body_metrics.weightKg` (most recent) + `users.heightCm`
- Display: value with one decimal, e.g. `23.4`, label `"BMI"`, color `#a78bfa`
- Classification label beneath: Underweight / Normal / Overweight / Obese
- Hidden tile (shows "No data") if weight or height missing
- `heightCm` is already in the `users` table and JWT session — no extra fetch needed

### Weight Trend (velocity)
- Formula: linear regression slope over last 28 days of `body_metrics.weightKg` readings
- Result: `±X.X kg/week`, e.g. `−0.3 kg/wk`
- Needs ≥3 data points; shows "Need more data" otherwise
- Color: green if within goal direction, amber if stalling, red if going wrong direction — but direction depends on `users.weightGoalKg`, which is in the session/JWT already
- This is a pure client-side calculation from the already-fetched `metaRecent` array — no new API call

### Net Calories
- Formula: `calories_in (metaToday.calories) − calories_burned (calsBurnedToday)`
- Does NOT subtract BMR (sex field not in user profile; full TDEE calculation would require it)
- Display: `±N kcal` surplus/deficit vs burned only, with label `"Net Cal"` and a note `"excl. BMR"` in muted text so it's clear this is partial
- Color: `#00d4ff`
- Requires `calsBurnedToday` (already planned above) and `metaToday.calories` (already in body-metadata response)
- Hidden / "No data" if either value is null

---

---

## 13. User Profile — Add Sex Field

`heightCm` and `dateOfBirth` are already in the DB and editable in the profile form. `sex` is missing.

### DB migration (050)
Add `sex text` column to `users` table. Values: `'male' | 'female' | 'other'`. Nullable — existing rows default to null.

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS sex text;
```

### Profile edit form (`components/profile/edit-profile-sheet.tsx`)
Add a `sex` field (segmented control / 3-button toggle: Male / Female / Other) to the edit profile sheet, below Height. Send to `PATCH /api/user/profile` with the other fields.

### API (`app/api/user/profile/route.ts` or equivalent)
Add `sex` to the accepted fields in `updateUserProfile`. The `updateUserProfile` repository method already accepts `Partial<Pick<User, ...>>` — extend the pick to include `sex`.

### Session JWT (`lib/session.ts`)
Add `sex: string | null` to the JWT token fields so it is available client-side without an extra fetch.

### DB schema (`lib/data/postgres/schema.ts`)
Add `sex: text('sex')` to the `users` table definition.

---

## 14. Upgrade Energy Balance to Full BMR

With `sex` now available from the session, replace the "Net Cal (excl. BMR)" tile with a full **Energy Balance** tile.

**Mifflin-St Jeor BMR formula:**
- Male: `10 × weightKg + 6.25 × heightCm − 5 × age + 5`
- Female: `10 × weightKg + 6.25 × heightCm − 5 × age − 161`
- Other / null: midpoint `10 × weightKg + 6.25 × heightCm − 5 × age − 78`

**TDEE:** BMR × 1.4 (lightly active assumed — conservative default)

**Energy Balance = caloriesToday − calsBurnedToday − TDEE**

Display:
- `+N kcal` surplus (amber) / `−N kcal` deficit (green for moderate deficit, red for >700 deficit)
- Label: `"Balance"`, subtitle: `"vs TDEE est."`, color `#00d4ff`
- Hidden / "No data" if any of: weightKg, heightCm, dateOfBirth, sex are null

All values computable client-side from session user + already-fetched `metaToday` + `calsBurnedToday`.

---

## Summary of file changes

| File | Changes |
|------|---------|
| `app/session-select/session-select-content.tsx` | Metric tile nav + Log chip; streak/week nav to /stats; MessageCircle mood icon |
| `app/profile/profile-content.tsx` | Remove "View all" button; rename "Daily Goals"; safe zone padding |
| `components/profile/edit-profile-sheet.tsx` | Add sex field (3-button toggle) |
| `components/config-screen.tsx` | Wrap Phase Sets + Progression Styles in Advanced Settings accordion |
| `app/health/health-content.tsx` | Remove mood rows; always-show biometrics; training load placeholder; add Distance + Calories Burned + BMI + Weight Trend + Energy Balance tiles |
| `app/api/body-metadata/route.ts` | Add `calsBurnedToday` to response (sum of today's cardio_sessions) |
| `lib/data/postgres/schema.ts` | Add `sex` column to users table |
| `lib/data/postgres/migrations/050_users_sex.sql` | `ALTER TABLE users ADD COLUMN IF NOT EXISTS sex text` |
| `lib/session.ts` | Add `sex` to JWT fields |
| `app/api/user/profile/route.ts` | Accept `sex` in updateUserProfile |
| `lib/data/repository.ts` + `lib/data/postgres/adapter.ts` | Include `sex` in updateUserProfile pick |
