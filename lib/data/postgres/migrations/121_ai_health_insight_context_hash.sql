-- NUT-7: the daily digest caches its output per-day but had no way to tell whether the
-- deterministic inputs it summarized have changed since — a digest generated at lunch
-- reported lunch totals all evening. Storing a hash of the assembled context lets the route
-- recompute the (cheap, no-AI) context on every non-forced request and only serve the cache
-- when nothing has actually changed.
ALTER TABLE ai_health_insights ADD COLUMN IF NOT EXISTS context_hash TEXT;
