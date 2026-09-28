-- LA-170. When the training-load verdict on this row was computed. The route re-persists the gate on
-- every call and is only ever asked about TODAY, so a stored `insufficient_met` was the verdict of the
-- last evaluation made DURING the day — a morning one cannot clear the 720-minute MET floor. With this
-- stamp the route can tell a finished day's final verdict from a partial-day one and re-evaluate
-- yesterday once it has ended. Server-only, like `acwr`: the device never computes or sends it.
ALTER TABLE oura_daily_derived ADD COLUMN IF NOT EXISTS training_load_evaluated_at timestamptz;
