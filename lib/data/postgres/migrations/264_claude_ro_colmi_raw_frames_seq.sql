-- Expose `colmi_raw_frames.seq` through the read-only view (PS-21 Stage A).
--
-- The view is an explicit column list, so a new column is invisible until it is named here. `seq`
-- is the only record of the order the ring sent a sync's frames (migration 263), and the analysis
-- that would use it — replaying an archived sync to check a decoder change — runs through this
-- view. Without this the column exists and cannot be read.
DROP VIEW IF EXISTS claude_ro.colmi_raw_frames;

CREATE VIEW claude_ro.colmi_raw_frames AS
SELECT
  t.id,
  t.user_id,
  t.received_at,
  t.channel,
  t.tag,
  t.hex,
  t.seq,
  t.created_at
FROM public.colmi_raw_frames t
WHERE t.user_id = current_setting('app.claude_ro_owner', true)::uuid;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claude_readonly') THEN
    EXECUTE 'GRANT SELECT ON claude_ro.colmi_raw_frames TO claude_readonly';
  END IF;
END $$;
