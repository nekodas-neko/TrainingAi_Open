# End of Day Review — Design Spec

**Status:** Approved design, implementation paused pending the offline-first food-persistence fix (a hard dependency — see that spec/branch). v1 = End of Day only; Start of Day mirror and correlation analytics are documented fast-follows.

## Purpose

Replace the current end-of-night backfill (a generic AI chat opened via `?chat=backfill`, today the `MealBackfillSheet`) with a proper **"summary of your day" review**: confirm/backfill meals, capture a few quick structured wellness signals, and jot an optional journal note. The captured signals are designed to later feed the Body Battery model to learn what actually drains vs. recharges the user — but v1 only **captures** cleanly; correlation is a separate future phase.

## Principles

- **Click-and-forget.** Every structured field opens pre-filled on its best-guess value derived from existing signals. The user glances, nudges anything wrong, and saves. Accepting all defaults must produce a reasonable record.
- **Everything comparable.** All wellness fields are structured **1–5 segmented scales** (or the existing muscle-group picker). The **journal is the only free text**. No fuzzy "mood" — concrete scales that correlate cleanly later.
- **Only capture what nothing else knows.** Don't re-ask what the app already tracks (calories/macros/meal timing, training load, steps/activity, Oura sleep/HRV/readiness). Capture the subjective/lifestyle gaps.
- **Offline-first.** The on-device SQLite DB is the source of truth; the API/Postgres is backup. New data uses the local store + outbox and is **read back from the local store** (this is why the food-persistence fix lands first).

## Scope (v1)

- End of Day review sheet, opened via the existing `?chat=backfill` deep-link / meal reminder, plus a button on the Nutrition page.
- Fast-follows (out of scope, table designed to support them): a Start of Day (morning) check-in reusing the same table with `phase='morning'`; real Body Battery correlation analytics.

## UX / Sections

Follows the approved HTML mockup. A bottom sheet with sectioned cards on the lifted surface:

1. **DaySummaryCard** — calories vs target + macro bars (reuse existing totals) and the Body Battery reading (reuse `/api/body-battery`: `current`, `label`, `trend`, `drained`). Read-only.
2. **MealBackfillSection** — the existing per-meal AI backfill, extracted from `MealBackfillSheet`. Reuses the offline `logFoodEntries` (unchanged) so meals log offline-first and split into components.
3. **WellnessSection** — structured, all 1–5 segmented scales, each pre-filled from a smart default:
   - **Physical tiredness** ← Body Battery (`Charged`→low … `Drained`→high)
   - **Mental drain / stress** ← neutral 3 (no reliable signal)
   - **Barely moved** ← steps (low steps → high)
   - **Hydration** ← water metric if logged, else neutral 3
   - **Late / heavy meal** ← inferred from last logged meal time vs. bedtime estimate (+ meal size)
   - **Body pain / soreness** ← the existing muscle-group picker, pre-selecting muscles trained in today's logged workout
4. **JournalSection** — optional free-text note (the only free text).
5. **TodayInsightCard** — deterministic, today-only reflection (e.g. "battery bottomed at 34, late heavy meal, upper-body soreness"). No ML, no AI call.
6. **SaveBar** — sticky Save.

**Smart pre-fill mapping** lives in a pure helper so it's unit-testable and reused by the morning variant later.

## Data model (offline-first)

New sync domain **`day_checkins`**, mirroring `mood_logs` plumbing end to end:

- Local SQLite table `day_checkins` (source of truth) + server Postgres table (backup) via new migration.
- One row per `(userId, logDate, phase)`; `phase='evening'` for v1, `'morning'` reserved.
- Columns (all nullable so partial saves are fine): `physical_tiredness` (1–5), `mental_drain` (1–5), `barely_moved` (1–5), `hydration` (1–5), `late_heavy_meal` (1–5), `sore_muscles` (text[]), `journal` (text), timestamps + `deleted_at` + `sync_status`.
- Writes: local upsert + `queueMutation({domain:'day_checkins'})` + `pushMutations`. Reads: from the local store (`store.getDayCheckin(date, phase)`), API as backup/hydration via pull-delta.
- Server `adapter.pushMutations` gets a `day_checkins` branch; `/api/sync/push` already validates per-mutation (recent hardening) so a partial payload can't wedge the queue.

Typed columns (not JSONB) so later correlation is trivial SQL.

## Component structure

`EndOfDayReview` sheet composed of the small, independently-testable sections above (each its own file). Replaces `MealBackfillSheet`; the `?chat=backfill` trigger in `nutrition-content.tsx` opens `EndOfDayReview`.

## Testing

- Pure helpers unit-tested: pre-fill mapping (signals → 1–5 defaults), the deterministic insight builder.
- Offline round-trip: write a check-in, read it back from the local store, confirm it renders after a simulated navigation (source-of-truth read).
- Reuse of `logFoodEntries` for meal backfill is already covered.

## Dependencies

- **Offline-first food-persistence fix must land first** — it establishes local-store-as-source-of-truth reads (local `food_items` table, local reads) and the general pattern this feature relies on.
