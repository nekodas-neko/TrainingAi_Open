-- Q-392: preferences lived only in localStorage, so a reinstall or a second browser started from
-- defaults. One JSONB bag rather than a column each — the reasoning is in
-- packages/shared/src/user/preferences.ts, and the short version is that preferences are an
-- open-ended set nothing queries, so a column each buys DB typing nobody reads at the cost of a
-- migration per toggle.
--
-- NOT NULL DEFAULT '{}' so every existing row is immediately readable without a backfill, and a
-- read never has to distinguish "no row" from "no preferences".
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
