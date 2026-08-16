-- Add workout reminder settings to schedules.
-- reminder_time stores an "HH:MM" string; null means no reminder configured.
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_time    TEXT;
