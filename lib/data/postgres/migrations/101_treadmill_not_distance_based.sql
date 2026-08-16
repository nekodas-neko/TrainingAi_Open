-- Treadmill is a stationary machine — it must never be GPS-tracked. Migration 094
-- inserted it with is_distance_based=false, but ON CONFLICT DO NOTHING means any row
-- that pre-existed (or drifted to) is_distance_based=true was never corrected, leaving
-- the app to start a GPS watcher and draw a wandering "route" on a treadmill. Force it.
UPDATE activity_types SET is_distance_based = false WHERE id = 'treadmill';
