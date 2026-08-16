-- Add user-specific exercises and fill gaps from previous migration
INSERT INTO exercise_library (name, muscles) VALUES
  ('Barbell Bench Press',     '[{"muscle":"Chest","role":"main"},{"muscle":"Shoulders","role":"secondary"},{"muscle":"Triceps","role":"secondary"}]'),
  ('Landmine Press',          '[{"muscle":"Chest","role":"main"},{"muscle":"Shoulders","role":"main"},{"muscle":"Triceps","role":"secondary"}]'),
  ('Cable Chest Dips',        '[{"muscle":"Chest","role":"main"},{"muscle":"Triceps","role":"secondary"}]'),
  ('Dumbbell Shoulder Press', '[{"muscle":"Shoulders","role":"main"},{"muscle":"Triceps","role":"secondary"}]'),
  ('DB Lateral Raises',       '[{"muscle":"Shoulders","role":"main"}]'),
  ('Tricep Cable Combo',      '[{"muscle":"Triceps","role":"main"}]'),
  ('Cable Pulldown',          '[{"muscle":"Lats","role":"main"},{"muscle":"Biceps","role":"secondary"}]'),
  ('Single Arm Cable Row',    '[{"muscle":"Lats","role":"main"},{"muscle":"Upper Back","role":"main"},{"muscle":"Biceps","role":"secondary"}]'),
  ('Bent Over Barbell Row',   '[{"muscle":"Upper Back","role":"main"},{"muscle":"Lats","role":"main"},{"muscle":"Biceps","role":"secondary"}]'),
  ('Dumbbell Preacher Curl',  '[{"muscle":"Biceps","role":"main"}]'),
  ('Cable Curls',             '[{"muscle":"Biceps","role":"main"}]'),
  ('Abs',                     '[{"muscle":"Core","role":"main"}]'),
  ('Single Leg Hip Thrusts',  '[{"muscle":"Glutes","role":"main"},{"muscle":"Hamstrings","role":"secondary"}]'),
  ('Hip Thrusts',             '[{"muscle":"Glutes","role":"main"},{"muscle":"Hamstrings","role":"secondary"}]'),
  ('Front Barbell Squat',     '[{"muscle":"Quads","role":"main"},{"muscle":"Glutes","role":"secondary"},{"muscle":"Core","role":"secondary"}]'),
  ('Calf Raises',             '[{"muscle":"Calves","role":"main"}]'),
  ('Dumbbell Row',            '[{"muscle":"Lats","role":"main"},{"muscle":"Upper Back","role":"secondary"},{"muscle":"Biceps","role":"secondary"}]')
ON CONFLICT (name) DO NOTHING;
