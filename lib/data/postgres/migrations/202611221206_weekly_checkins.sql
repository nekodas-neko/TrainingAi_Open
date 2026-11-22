-- #3890 step 1 — somewhere to keep a weekly check-in: which week it reviewed, the answers that are not
-- about one lift, and, per main lift, how it felt and what the app did with that. The engine (step 2)
-- and the Preview card and sheet (step 3) are later PRs; nothing reads or writes these tables yet.
-- Owner's decisions (22 Nov): 7 card after the week's last planned session or Sunday 17:00, 8 "Heavy"
-- holds by itself and the rest are one-tap offers, 9 "Heavy" plus a missed rep lowers one step.
--
-- What this does:
--   1. CREATE TABLE weekly_checkins — one row per user and training week.
--   2. CREATE TABLE weekly_checkin_exercises — one row per main lift answered in that check-in.
--
-- weekly_checkins
--   week_start          the LOCAL Monday of the week being reviewed, in the person's timezone, as a
--                       date (the app's Mon-Sun week: startOfWeekInTz / weekStartForDay). Not an ISO
--                       week number: "2026-W53 / 2027-W01" needs a year-of-week beside it and is easy
--                       to build from the wrong year at New Year, while a date compares directly with
--                       rest_days.date, injuries.started_date and every other day column, and needs no
--                       timezone of its own because it is already local. Enforced to be a Monday.
--                       "Next week" is week_start + 7.
--   applies_week_start  the local Monday of the week the "next week" answers (days_off_weekdays,
--                       shorter_session_min) are FOR: always week_start + 7, enforced by a CHECK, NOT
--                       NULL. Stored rather than left as a rule because the writer must state it (an
--                       insert without it fails) and cannot state a wrong one (the CHECK refuses), and
--                       because the plan reader for week W can ask "the check-in whose applies_week_start
--                       is W" with a plain date equality instead of date arithmetic that a time-zone or
--                       off-by-one slip would break silently. UNIQUE (user, applies_week_start) is the
--                       same fact as the week key, kept as the index that lookup uses.
--   status              offered | saved | dismissed.
--   offered_at          when the card was first offered (the row is created then).
--   saved_at            set exactly when status = 'saved'.
--   dismissed_at        set exactly when status = 'dismissed'. A dismissed check-in can still be done
--                       later: the same row goes to 'saved' and dismissed_at is cleared.
--   days_off_weekdays   days off next week, as ISO weekdays 1 (Mon) to 7 (Sun). NULL = not answered;
--                       '{}' = answered, no days off. The rest_days rows it produces are not
--                       referenced (rest_days is one row per date): they are found by date.
--   shorter_session_min a shorter-session choice, minutes (1 to 240, the plausible-session ceiling).
--                       NULL = not chosen.
--   pain_raised         "anything hurt?" NULL = not answered, false = no, true = yes. The pain itself
--                       goes to the existing injuries table, never here.
--   pain_exercise_name, pain_exercise_id
--                       the lift the person picked as hurting: a name plus a nullable library id, the same
--                       way the lift rows identify a lift (readers match the id first, then the name).
--                       pain_exercise_id is ON DELETE SET NULL.
--   pain_where          a short free-text "where" (1 to 200 characters). THIS IS USER TEXT: any later use
--                       of it in a prompt must go through lib/ai/prompt-guards.ts, and it is never
--                       trusted as an instruction.
--   pain_offer_status   what became of the offer to log an injury: open | accepted | declined. Set exactly
--                       when a lift was picked (a pain_exercise_name). Without it, pain_raised = true and
--                       no injury could not tell "offer still open" from "declined", and a declined offer
--                       would lose which lift and where.
--   pain_injury_id      the injury logged from the offer. Only when pain_offer_status = 'accepted'.
--                       ON DELETE SET NULL: deleting an injury keeps the answer.
--   All pain_* detail columns are NULL unless pain_raised IS TRUE (false and not-answered carry none).
--   swap_exercise_name, swap_exercise_id, swap_offer_status
--                       the lift the person asked to swap (name plus nullable library id, as above) and
--                       what became of the offer: open | accepted | declined, set exactly when a lift was
--                       picked. One swap per check-in: the issue's question is "Anything to swap? Pick a
--                       lift", a single pick, so it lives on this table, not on the lift rows (and the
--                       lift picked need not be one of the answered lifts).
--   swap_change_id      the coach_changes row the accepted swap was applied through (with undo). Only when
--                       swap_offer_status = 'accepted'. ON DELETE SET NULL. It was on the lift rows in the
--                       first draft; a swap is one per check-in, so it moved here.
--   deleted_at          tombstone (CLAUDE.md offline-first rule: a hard delete is invisible to a device
--                       that has not synced). A redo is an update of the same row, so the tombstone is
--                       for a check-in the person removes; the unique key still covers it. The lift rows
--                       have their own (below).
--   Every foreign key on weekly_checkins is DEFERRABLE INITIALLY IMMEDIATE: it has two SET NULL keys
--   into rows that an account deletion also removes (injuries and coach_changes), and the deletion's
--   SET CONSTRAINTS ALL DEFERRED reaches only a deferrable key (migration 202610060645, the
--   meal_plan_meals shape; account-deletion.test.ts checks it). Drizzle cannot express the clause.
--   OWNERSHIP: plain foreign keys to injuries (pain_injury_id) and coach_changes (swap_change_id here,
--   applied_change_id on the lift rows) cannot say "belongs to the same user". The step 2 writer MUST
--   check, before it writes either id, that the row is the same person's. Nothing in the database does.
--   UNIQUE (id, user_id) exists only so the per-lift table can carry a composite foreign key and so
--   a lift row can never belong to another person's check-in.
--
-- weekly_checkin_exercises
--   Key: the same one exercise_preferences (migration 202611212318) and exercise_estimates (159) use,
--   user + exercise_name, with exercise_id (nullable FK to exercise_library, ON DELETE SET NULL)
--   carried beside it. Here it is scoped by check-in, and user_id rides along for row scoping and the
--   claude_ro view. Readers match on exercise_id first and fall back to the name.
--   answer              heavy | about_right | light. A row exists only for an answered lift, so NOT NULL.
--   missed_rep          whether a rep was missed that week, as the engine saw it at save time, so
--                       decision 9 can be explained later. NULL = the engine had no read of the lift.
--   applied_change_id   the coach_changes row the app wrote for this lift: the automatic lowering of a
--                       "Heavy plus a miss" (effect = 'lowered_one_step') or an accepted "Light" step up
--                       (effect = 'offered_step_up', offer_status = 'accepted'). Since #4008 the Coach's
--                       lift changes (exercise_preferences, source 'checkin' is reserved for this) are
--                       applied and undone through coach_changes, so its id is a stable thing to point
--                       at, and an Undo there is visible from here. Set only in those two cases; NULL
--                       means nothing written yet, or the coach_changes row is gone (ON DELETE SET NULL).
--   deleted_at          tombstone, for a lift a redo of the check-in drops (a hard delete is invisible
--                       to a device that has not synced once a local-store table exists). Like
--                       exercise_preferences, the unique keys are plain and still cover a tombstoned
--                       row, so a redo that brings the lift back revives the row.
--   effect              what the app did: held | lowered_one_step | offered_step_up | none.
--                       The engine (step 2) decides which; the table does not tie it to the answer, so
--                       a rule change there needs no migration.
--   offer_status        only for an offer: open | accepted | declined. Set exactly when
--                       effect = 'offered_step_up'.
--
-- Additive only: two new tables and their indexes. No existing table is altered and no row is changed,
-- backfilled or deleted. No device copy yet (the local-store table is its own, later step).
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): IF NOT EXISTS throughout.
--
-- REVERSE (loses only what these tables hold; both are empty until step 2 ships):
--   DROP VIEW IF EXISTS claude_ro.weekly_checkin_exercises, claude_ro.weekly_checkins;
--   DROP TABLE weekly_checkin_exercises; DROP TABLE weekly_checkins;
--   (the views select every column, so DROP TABLE fails without the views dropped first; the boot
--   rebuild recreates a view from claude-ro-views.sql only while its table exists, so remove both
--   views from that file in the same revert)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS weekly_checkins (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  week_start          date        NOT NULL,
  applies_week_start  date        NOT NULL,
  status              text        NOT NULL DEFAULT 'offered',
  offered_at          timestamptz NOT NULL DEFAULT now(),
  saved_at            timestamptz,
  dismissed_at        timestamptz,
  days_off_weekdays   smallint[],
  shorter_session_min smallint,
  pain_raised         boolean,
  pain_exercise_name  text,
  pain_exercise_id    uuid        REFERENCES exercise_library(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  pain_where          text,
  pain_offer_status   text,
  pain_injury_id      uuid        REFERENCES injuries(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  swap_exercise_name  text,
  swap_exercise_id    uuid        REFERENCES exercise_library(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  swap_offer_status   text,
  swap_change_id      uuid        REFERENCES coach_changes(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_checkins_week_key UNIQUE (user_id, week_start),
  CONSTRAINT weekly_checkins_applies_week_key UNIQUE (user_id, applies_week_start),
  CONSTRAINT weekly_checkins_id_user_key UNIQUE (id, user_id),
  CONSTRAINT weekly_checkins_week_start_check CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  CONSTRAINT weekly_checkins_applies_week_check CHECK (applies_week_start = week_start + 7),
  CONSTRAINT weekly_checkins_status_check CHECK (status IN ('offered', 'saved', 'dismissed')),
  CONSTRAINT weekly_checkins_status_times_check CHECK (
    (status = 'offered'   AND saved_at IS NULL     AND dismissed_at IS NULL)
    OR (status = 'saved'     AND saved_at IS NOT NULL AND dismissed_at IS NULL)
    OR (status = 'dismissed' AND saved_at IS NULL     AND dismissed_at IS NOT NULL)
  ),
  CONSTRAINT weekly_checkins_days_off_check CHECK (
    days_off_weekdays IS NULL
    OR (days_off_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[] AND cardinality(days_off_weekdays) <= 7)
  ),
  CONSTRAINT weekly_checkins_shorter_session_check CHECK (
    shorter_session_min IS NULL OR (shorter_session_min >= 1 AND shorter_session_min <= 240)
  ),
  CONSTRAINT weekly_checkins_pain_detail_check CHECK (
    pain_raised IS TRUE
    OR (pain_exercise_name IS NULL AND pain_exercise_id IS NULL AND pain_where IS NULL AND pain_offer_status IS NULL)
  ),
  CONSTRAINT weekly_checkins_pain_lift_check CHECK (
    (pain_exercise_name IS NULL OR pain_exercise_name <> '')
    AND (pain_exercise_id IS NULL OR pain_exercise_name IS NOT NULL)
    AND (pain_where IS NULL OR pain_exercise_name IS NOT NULL)
  ),
  CONSTRAINT weekly_checkins_pain_where_check CHECK (pain_where IS NULL OR char_length(pain_where) BETWEEN 1 AND 200),
  CONSTRAINT weekly_checkins_pain_offer_status_check CHECK (pain_offer_status IS NULL OR pain_offer_status IN ('open', 'accepted', 'declined')),
  CONSTRAINT weekly_checkins_pain_offer_check CHECK ((pain_exercise_name IS NULL) = (pain_offer_status IS NULL)),
  CONSTRAINT weekly_checkins_pain_injury_check CHECK (pain_injury_id IS NULL OR COALESCE(pain_offer_status = 'accepted', false)),
  CONSTRAINT weekly_checkins_swap_lift_check CHECK (
    (swap_exercise_name IS NULL OR swap_exercise_name <> '')
    AND (swap_exercise_id IS NULL OR swap_exercise_name IS NOT NULL)
  ),
  CONSTRAINT weekly_checkins_swap_offer_status_check CHECK (swap_offer_status IS NULL OR swap_offer_status IN ('open', 'accepted', 'declined')),
  CONSTRAINT weekly_checkins_swap_offer_check CHECK ((swap_exercise_name IS NULL) = (swap_offer_status IS NULL)),
  CONSTRAINT weekly_checkins_swap_change_check CHECK (swap_change_id IS NULL OR COALESCE(swap_offer_status = 'accepted', false))
);

CREATE TABLE IF NOT EXISTS weekly_checkin_exercises (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_id     uuid        NOT NULL,
  exercise_id    uuid        REFERENCES exercise_library(id) ON DELETE SET NULL,
  exercise_name  text        NOT NULL,
  answer         text        NOT NULL,
  missed_rep     boolean,
  effect         text        NOT NULL,
  offer_status   text,
  applied_change_id uuid     REFERENCES coach_changes(id) ON DELETE SET NULL,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_checkin_exercises_checkin_fkey FOREIGN KEY (checkin_id, user_id)
    REFERENCES weekly_checkins (id, user_id) ON DELETE CASCADE,
  CONSTRAINT weekly_checkin_exercises_lift_key UNIQUE (checkin_id, exercise_name),
  CONSTRAINT weekly_checkin_exercises_exercise_name_check CHECK (exercise_name <> ''),
  CONSTRAINT weekly_checkin_exercises_answer_check CHECK (answer IN ('heavy', 'about_right', 'light')),
  CONSTRAINT weekly_checkin_exercises_effect_check CHECK (effect IN ('held', 'lowered_one_step', 'offered_step_up', 'none')),
  CONSTRAINT weekly_checkin_exercises_offer_status_check CHECK (offer_status IS NULL OR offer_status IN ('open', 'accepted', 'declined')),
  CONSTRAINT weekly_checkin_exercises_offer_check CHECK ((effect = 'offered_step_up') = (offer_status IS NOT NULL)),
  CONSTRAINT weekly_checkin_exercises_applied_check CHECK (
    applied_change_id IS NULL
    OR effect = 'lowered_one_step'
    OR (effect = 'offered_step_up' AND offer_status = 'accepted')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS weekly_checkin_exercises_checkin_exercise_id_key
  ON weekly_checkin_exercises (checkin_id, exercise_id) WHERE exercise_id IS NOT NULL;
