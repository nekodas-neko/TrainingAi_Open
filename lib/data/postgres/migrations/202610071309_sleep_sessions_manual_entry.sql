-- #2338 (engine half): a night the user typed in, as opposed to one a device measured.
--
-- The owner answered yes to manual sleep entry on 2026-10-05: a bed time and a wake time that
-- create a sleep session, so a user with no ring and no Health Connect can still fill the readiness
-- sleep component. His one condition: a manual night LOSES to device data for the same night.
--
-- That needs the row to say what it is. Nothing on `sleep_sessions` could: `oura_id` is NULL for a
-- Health Connect night too, and `source_map` ranks `manual` ABOVE every device (it exists for the
-- user correcting one measured field, which is the opposite rule) and is not mirrored to the
-- device. So the marker gets its own column.
--
--   manual_entry = true  — a night the user entered (bed time → wake time); every reader that picks
--                          "the night" drops it when a device recorded that night
--   manual_entry = false — everything else: ring, Health Connect, legacy rows
--
-- Additive. NOT NULL with a constant default, so every existing row reads false without a rewrite.
--
-- The partial unique index is the natural key: at most one manual night per (user, wake date). A
-- second entry for the same night is an edit of the first, never a second row, and it holds under a
-- replayed outbox mutation or two devices racing. Device rows are untouched by it.
ALTER TABLE sleep_sessions ADD COLUMN IF NOT EXISTS manual_entry boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS sleep_sessions_manual_night_key
  ON sleep_sessions (user_id, date)
  WHERE manual_entry;
