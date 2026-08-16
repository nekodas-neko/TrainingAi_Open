-- 050_users_sex.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS sex text;
