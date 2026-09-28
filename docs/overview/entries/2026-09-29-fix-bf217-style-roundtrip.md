# 2026-09-29 — BF-217: no save path loses a progression style; the nine blanks were never assigned

**Lane A · investigation + regression test.** BF-217 leaves the queue, replaced by LA-182 (Lane O,
the owner's repair) and LA-183 (Lane B, prevention).

- **Every writer of `session_exercises.style_id` was read, and none can blank it when the caller
  sends it:**
  - `saveProgram` re-inserts `ex.styleId ?? null`;
  - the only route that calls it, `/api/workout-templates`, ownership-checks the ids and passes
    them through;
  - both Config callers send them. The editor round-trips `styleId` from `listPrograms`, and
    activation spreads the listed program;
  - the coach's session-exercise writer preserves a style on a swap and restores it on undo.
- **Production evidence (read-only `db-query`, 2026-09-29):**
  - **No lost style was deleted.** Every style id the nine exercises were last logged with still
    exists in `progression_styles`, so `ON DELETE SET NULL` is ruled out.
  - **The entry's dating method does not hold.** Bankai is `ai_dynamic`, so `exercise_logs.style_id`
    is the style the AI chose that session ("AI · Accumulation" = Hypertrophy Plus), not the
    exercise's own `style_id`. A styled log says nothing about the row.
  - **The uniform `updated_at` of 09-28 05:17:31** matches LA-143's backfill (migration 295, merged
    05:13 UTC), which sets only `exercise_id`.
  - Four of the nine have never had a styled log at all.
- **Most likely origin:** exercises created with no style. The editor leaves a new exercise
  style-less, and the builder passes the AI's `progressionStyleId`, which can be empty. Neither
  forces or defaults one, and the editor shows no signal for "none", so it goes unseen until the
  rules fallback skips the exercise.
- **Shipped:** `bf217-style-survives-resave.test.ts` (real Postgres). An activation-shaped re-save
  and a repeated save keep every style.
- **Filed:**
  - **LA-182 (Lane O):** the owner assigns the nine styles. It un-deads Lower's Full toggle.
  - **LA-183 (Lane B):** default or require a style when an exercise is added.
