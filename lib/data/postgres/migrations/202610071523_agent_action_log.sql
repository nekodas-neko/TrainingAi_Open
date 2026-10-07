-- #2381 (PR a of 3): the agent action log. Agents are to run maintenance actions themselves with a
-- scoped key while the owner only approves (#2380, owner 2026-10-06). Before any route accepts that
-- key (PR b) or runs a destructive job with an approval link (PR c), there has to be a record of
-- every run that the agents themselves cannot rewrite. This migration is only that record; nothing
-- writes to it yet.
--
-- **One row per run.** `job` is the stable id of the action in `docs/admin-actions.md`
-- (`rederive-body-battery`, `redecode`, `vacuum`, …), lowercase with `.`, `_`, `:` or `-`, so a log
-- can be grouped by job without free-text matching. `actor` is the agent's name (`orchestrator`,
-- `bugfix`, `implementer`) or `owner`. `approval_ref` is the link to the owner's approval comment.
-- The table does not decide which jobs need one; PR c's routes refuse a destructive job without
-- it. The table only refuses an approval that is blank or absurdly long.
--
-- **`parameters` never holds a secret or personal data.** The repository passes it through
-- `redactActionParameters` (lib/agent-actions/redact.ts), which drops every key that names a secret,
-- token, key, password or authorization at any depth. The writer still owns the rest: ids, dates,
-- table names and flags only; no emails, names or health values. A row can outlive its target user
-- (below), and claude_ro then shows it to the agents unscoped.
--
-- **Append-only, enforced here and not only in the repository.** A run is inserted as `running` and
-- finished exactly once. The trigger below refuses every DELETE, any change to a row that is no
-- longer `running`, and any change to a running row beyond its finishing columns. The one
-- exception is the account-deletion FK setting `target_user_id` to NULL, which unlinks a row and
-- changes nothing else. An audit log that the application can rewrite records only what the
-- application chooses to keep. This guards against application code; a role that can DROP TRIGGER or
-- TRUNCATE can still do so, and the local snapshot loader truncates every table on purpose.
--
-- **Survives account deletion, unlinked.** `target_user_id` names the account whose data the job
-- ran on. It is NULL for a global job (VACUUM). `ON DELETE SET NULL`, never CASCADE: deleting a
-- user must not delete the record of what was done to their data. After the deletion the row holds
-- job, actor, approval link, times, outcome and counts, and no reference to the person. This is the
-- `ai_call_log` / `error_events` disposition (owner, 2026-09-24).
--
-- **`days_moved`**: the catalogue says a re-derive that moves past scores states how many days it
-- moved. NULL means "not a scoring job" or "not counted", never 0.
--
-- Server-only: nothing on the device reads it (docs/data-residency.md). Not in the user export
-- (ops, like `db_query_log`). claude_ro shows the owner's rows and the global ones.
--
-- Additive: a new table, its indexes, a trigger function and a trigger. Nothing else touched.
CREATE TABLE IF NOT EXISTS agent_action_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job             text NOT NULL,
  parameters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor           text NOT NULL,
  approval_ref    text,
  target_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  outcome         text NOT NULL DEFAULT 'running',
  affected_rows   bigint,
  days_moved      integer,
  -- A short reason. Never a stack trace, a request body or a secret.
  error           text,

  CONSTRAINT agent_action_log_job_check CHECK (job ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  CONSTRAINT agent_action_log_actor_check CHECK (length(btrim(actor)) BETWEEN 1 AND 64),
  CONSTRAINT agent_action_log_approval_ref_check CHECK (
    approval_ref IS NULL OR (length(btrim(approval_ref)) > 0 AND length(approval_ref) <= 500)
  ),
  CONSTRAINT agent_action_log_parameters_check CHECK (
    jsonb_typeof(parameters) = 'object' AND octet_length(parameters::text) <= 8192
  ),
  CONSTRAINT agent_action_log_outcome_check CHECK (outcome IN ('running', 'succeeded', 'failed', 'refused')),
  -- A finished run has an end, and a running one has none.
  CONSTRAINT agent_action_log_finished_check CHECK ((outcome = 'running') = (finished_at IS NULL)),
  CONSTRAINT agent_action_log_order_check CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT agent_action_log_counts_check CHECK (
    (affected_rows IS NULL OR affected_rows >= 0) AND (days_moved IS NULL OR days_moved >= 0)
  ),
  CONSTRAINT agent_action_log_error_check CHECK (error IS NULL OR length(error) <= 2000)
);

CREATE INDEX IF NOT EXISTS agent_action_log_started_idx ON agent_action_log (started_at DESC);
CREATE INDEX IF NOT EXISTS agent_action_log_job_started_idx ON agent_action_log (job, started_at DESC);
-- The FK's SET NULL on account deletion looks rows up by this column.
CREATE INDEX IF NOT EXISTS agent_action_log_target_user_idx ON agent_action_log (target_user_id)
  WHERE target_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION agent_action_log_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  -- Written once, when the run finishes.
  finishing text[] := ARRAY['finished_at', 'outcome', 'affected_rows', 'days_moved', 'error'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agent_action_log is append-only: row % cannot be deleted', OLD.id;
  END IF;

  -- Only the account-deletion FK may touch target_user_id, and only to unlink it.
  IF NEW.target_user_id IS DISTINCT FROM OLD.target_user_id AND NEW.target_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'agent_action_log is append-only: row % cannot be re-targeted', OLD.id;
  END IF;

  IF (to_jsonb(NEW) - finishing - 'target_user_id') IS DISTINCT FROM (to_jsonb(OLD) - finishing - 'target_user_id') THEN
    RAISE EXCEPTION 'agent_action_log is append-only: row % can only be finished, not rewritten', OLD.id;
  END IF;

  IF OLD.outcome <> 'running'
     AND (to_jsonb(NEW) - 'target_user_id') IS DISTINCT FROM (to_jsonb(OLD) - 'target_user_id') THEN
    RAISE EXCEPTION 'agent_action_log is append-only: row % is already %', OLD.id, OLD.outcome;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_action_log_append_only ON agent_action_log;
CREATE TRIGGER agent_action_log_append_only
  BEFORE UPDATE OR DELETE ON agent_action_log
  FOR EACH ROW EXECUTE FUNCTION agent_action_log_append_only();

COMMENT ON TABLE agent_action_log IS
  '#2381: one row per maintenance action an agent (or the owner) ran. Append-only: inserted running, finished once, never deleted or rewritten (trigger agent_action_log_append_only). Survives account deletion with target_user_id set NULL.';
COMMENT ON COLUMN agent_action_log.job IS
  'Stable action id from docs/admin-actions.md, e.g. rederive-body-battery.';
COMMENT ON COLUMN agent_action_log.parameters IS
  'The run''s parameters, redacted by redactActionParameters: never a secret, never personal data (ids, dates, table names and flags only).';
COMMENT ON COLUMN agent_action_log.approval_ref IS
  'Link to the owner''s approval (issue or comment URL). Required by the route for destructive jobs (#2381 PR c), not by the table.';
COMMENT ON COLUMN agent_action_log.target_user_id IS
  'The account whose data the job ran on; NULL for a global job, and set NULL when that account is deleted.';
COMMENT ON COLUMN agent_action_log.days_moved IS
  'Days whose stored score the run changed, for re-derives that move past scores. NULL = not a scoring job or not counted.';
