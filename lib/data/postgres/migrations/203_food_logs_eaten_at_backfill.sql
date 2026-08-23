-- Q-413 — `food_logs.logged_at` defaulted to now(), so it recorded when the row was CREATED, not
-- when the food was eaten. New writes now resolve it against the meal type's window
-- (`packages/shared/src/nutrition/eaten-at.ts`); this corrects the rows already stored.
--
-- **Deliberately narrow, and it is not a blanket rewrite.** Where the user logged as they ate, the
-- stored instant is the BETTER datum and overwriting it with a window midpoint destroys a real
-- observation. So this touches only rows whose `logged_at` falls on a **different local date** than
-- the row's own `date` — those were unambiguously logged later and carry no information about when
-- the food was eaten. Everything else is left exactly as it is. A broader backfill, if ever wanted,
-- is a separate and explicit decision.
--
-- The midpoint is computed in the USER's timezone, from `users.timezone`, never in UTC and never in
-- the server's zone. `AT TIME ZONE` in Postgres takes the same view the shared resolver does:
-- `('2026-08-18 13:30'::timestamp AT TIME ZONE 'Australia/Brisbane')` is the instant that reads
-- 13:30 in Brisbane on that date.
--
-- A window with `time_end_hour <= time_start_hour` crosses midnight (22 → 02); its midpoint is
-- `(start + (end + 24 - start) / 2) mod 24`, projected back onto the log's own date so the row's
-- `date` and its timestamp never disagree — that disagreement is the defect being fixed. The
-- general form below reduces to `(start + end) / 2` for an ordinary window, so there is one
-- expression rather than a CASE.
--
-- Idempotent: after it runs, every touched row's `logged_at` sits on its own local date, so the
-- WHERE clause matches nothing on a second run.

UPDATE food_logs fl
SET logged_at = (
      to_char(fl.date::date, 'YYYY-MM-DD')
      || ' '
      || to_char(
           make_interval(
             mins => (((mt.time_start_hour
                        + (CASE WHEN mt.time_end_hour > mt.time_start_hour
                                THEN mt.time_end_hour - mt.time_start_hour
                                ELSE mt.time_end_hour + 24 - mt.time_start_hour END) / 2.0)::numeric
                       % 24) * 60)::int
           ),
           'HH24:MI'
         )
    )::timestamp AT TIME ZONE COALESCE(u.timezone, 'Australia/Brisbane')
FROM meal_types mt, users u
WHERE fl.meal_type_id = mt.id
  AND fl.user_id      = u.id
  AND to_char(fl.logged_at AT TIME ZONE COALESCE(u.timezone, 'Australia/Brisbane'), 'YYYY-MM-DD')
      IS DISTINCT FROM to_char(fl.date::date, 'YYYY-MM-DD');
