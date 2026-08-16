ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS steps INTEGER;

INSERT INTO activity_types (id, label, icon, is_distance_based, sort_order)
VALUES ('treadmill', 'Treadmill', 'PersonSimpleWalk', false, 9)
ON CONFLICT (id) DO NOTHING;
