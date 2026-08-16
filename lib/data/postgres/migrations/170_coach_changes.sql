-- AI Coach: the record of every change the assistant applied on the user's behalf.
--
-- This table is what makes Undo and the "changes you've made" history possible, and it is the
-- reason the cheap half of Coach's persistence costs nothing extra: the row already exists the
-- moment Apply is tapped, so listing it is one query rather than a new store.
--
-- `before_state` holds the target row's pre-change values for exactly the accepted fields. Undo
-- restores from it, so it must be captured inside the same request that writes, not re-derived
-- later from a row that has since moved.
CREATE TABLE IF NOT EXISTS coach_changes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain         TEXT NOT NULL,
  target_id      UUID NOT NULL,
  -- The full proposal, including declined rows: what the assistant suggested is part of the
  -- record, not just what was taken.
  patch          JSONB NOT NULL,
  accepted_ids   TEXT[] NOT NULL DEFAULT '{}',
  before_state   JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary        TEXT NOT NULL DEFAULT '',
  applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set when the change is undone. Kept rather than deleted so the history stays honest about
  -- what happened, including the reversal.
  undone_at      TIMESTAMPTZ
);

-- The history list is "this user's changes, newest first" and nothing else.
CREATE INDEX IF NOT EXISTS coach_changes_user_applied_idx
  ON coach_changes (user_id, applied_at DESC);
