-- Remove duplicate activity_logs rows, keeping the earliest (lowest created_at).
-- Duplicates arise from concurrent Health Connect syncs before any row exists in the DB.
DELETE FROM activity_logs
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, date, start_time) id
  FROM activity_logs
  ORDER BY user_id, date, start_time, created_at ASC
);

-- Unique partial index for rows WITH a start_time (covers Samsung Health duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_user_date_start_time_idx
  ON activity_logs (user_id, date, start_time)
  WHERE start_time IS NOT NULL;
