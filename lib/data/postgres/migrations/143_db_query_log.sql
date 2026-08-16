-- Audit trail for the read-only query endpoint (/api/admin/db-query). One row per attempt,
-- successful or not, so a leaked CLAUDE_DB_QUERY_SECRET leaves a record of exactly what was read.
-- Written through the app's normal writable pool — the read-only pool cannot write, by design.
CREATE TABLE IF NOT EXISTS db_query_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  sql_text     text NOT NULL,
  row_count    integer,
  duration_ms  integer,
  truncated    boolean NOT NULL DEFAULT false,
  ok           boolean NOT NULL,
  error        text,
  caller_ip    text
);

CREATE INDEX IF NOT EXISTS db_query_log_created_at_idx ON db_query_log (created_at DESC);
