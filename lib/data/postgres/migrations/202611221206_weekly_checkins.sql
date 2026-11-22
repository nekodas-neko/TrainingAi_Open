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
--   pain_injury_id      the injury the person logged from the offer, if they logged one. Only with
--                       pain_raised = true. ON DELETE SET NULL: deleting an injury keeps the answer.
--   deleted_at          tombstone (CLAUDE.md offline-first rule: a hard delete is invisible to a device
--                       that has not synced). A redo is an update of the same row, so the tombstone is
--                       for a check-in the person removes; the unique key still covers it. It is on this
--                       table only: the per-lift rows are replaced with their check-in, never deleted
--                       one by one.
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
--   effect              what the app did: held | lowered_one_step | offered_step_up | none.
--                       The engine (step 2) decides which; the table does not tie it to the answer, so
--                       a rule change there needs no migration.
--   offer_status        only for an offer: open | accepted | declined. Set exactly when
--                       effect = 'offered_step_up'.
--   swap_change_id      the coach_changes row if the person took a swap for this lift. Swaps are
--                       applied through coach_changes, with undo; only the reference is kept here.
--                       ON DELETE SET NULL.
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
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start          date        NOT NULL,
  status              text        NOT NULL DEFAULT 'offered',
  offered_at          timestamptz NOT NULL DEFAULT now(),
  saved_at            timestamptz,
  dismissed_at        timestamptz,
  days_off_weekdays   smallint[],
  shorter_session_min smallint,
  pain_raised         boolean,
  pain_injury_id      uuid        REFERENCES injuries(id) ON DELETE SET NULL,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_checkins_week_key UNIQUE (user_id, week_start),
  CONSTRAINT weekly_checkins_id_user_key UNIQUE (id, user_id),
  CONSTRAINT weekly_checkins_week_start_check CHECK (EXTRACT(ISODOW FROM week_start) = 1),
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
  CONSTRAINT weekly_checkins_pain_injury_check CHECK (pain_injury_id IS NULL OR pain_raised IS TRUE)
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
  swap_change_id uuid        REFERENCES coach_changes(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_checkin_exercises_checkin_fkey FOREIGN KEY (checkin_id, user_id)
    REFERENCES weekly_checkins (id, user_id) ON DELETE CASCADE,
  CONSTRAINT weekly_checkin_exercises_lift_key UNIQUE (checkin_id, exercise_name),
  CONSTRAINT weekly_checkin_exercises_exercise_name_check CHECK (exercise_name <> ''),
  CONSTRAINT weekly_checkin_exercises_answer_check CHECK (answer IN ('heavy', 'about_right', 'light')),
  CONSTRAINT weekly_checkin_exercises_effect_check CHECK (effect IN ('held', 'lowered_one_step', 'offered_step_up', 'none')),
  CONSTRAINT weekly_checkin_exercises_offer_status_check CHECK (offer_status IS NULL OR offer_status IN ('open', 'accepted', 'declined')),
  CONSTRAINT weekly_checkin_exercises_offer_check CHECK ((effect = 'offered_step_up') = (offer_status IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS weekly_checkin_exercises_checkin_exercise_id_key
  ON weekly_checkin_exercises (checkin_id, exercise_id) WHERE exercise_id IS NOT NULL;
