-- #3673: how many `error_events` rows still hold a Drizzle `params:` tail, written before the
-- scrubbers shipped. READ-ONLY and COUNTS ONLY: it selects no message text, so running it is safe
-- on a screen that other people can see.
--
-- Reads `public.error_events`, NOT `claude_ro.error_events`: that view is scoped to the owner's
-- user id, and the rows `onRequestError` writes carry no user id, so the view would undercount.
-- Run (the Orchestrator, against production, with the connection that can read the table):
--   psql "$DATABASE_URL" -f scripts/tuning/error-events-with-params-3673.sql
--
-- Clearing old rows is the owner's decision and is not done here; the table prunes at 30 days.
-- "Holds params" means a `params:` that is not the scrubbed marker `params: [scrubbed]`.
SELECT
  count(*) FILTER (WHERE message ~ 'params: (?!\[scrubbed\])')                                  AS message_with_params,
  count(*) FILTER (WHERE stack   ~ 'params: (?!\[scrubbed\])')                                  AS stack_with_params,
  count(*) FILTER (WHERE message ~ 'params: (?!\[scrubbed\])' OR stack ~ 'params: (?!\[scrubbed\])') AS rows_touched,
  count(*)                                                                                      AS rows_total,
  min(created_at) FILTER (WHERE message ~ 'params: (?!\[scrubbed\])' OR stack ~ 'params: (?!\[scrubbed\])') AS oldest_touched,
  max(created_at) FILTER (WHERE message ~ 'params: (?!\[scrubbed\])' OR stack ~ 'params: (?!\[scrubbed\])') AS newest_touched
FROM public.error_events;
