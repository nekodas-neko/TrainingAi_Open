-- Extends the body_metrics/mood_logs soft-delete pattern (070_soft_deletes.sql) to
-- every other synced domain that's currently hard-deleted. getSyncDelta never emits
-- deletedAt for these, so a delete on one device (web or app) never propagates to
-- the others via pullDelta/applyDelta — the client-side tombstone-delete branches
-- for these domains exist but can never fire (see the offline-sync-integrity plan).
ALTER TABLE food_logs       ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE activity_logs   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE supplements     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE injuries        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
