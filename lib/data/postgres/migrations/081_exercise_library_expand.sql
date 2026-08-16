-- 081_exercise_library_expand.sql
-- 1. Fix missing equipment tags on existing exercises (all {} entries that have equipment in their name).
-- 2. Add ~50 new exercises covering chest, back, biceps, triceps, legs, glutes, core, shoulders.

-- ─── SECTION 1: Fix equipment on existing exercises ───────────────────────────

-- Exercises that existed before migration 032 and never got equipment assigned
UPDATE exercise_library SET equipment = ARRAY['bodyweight'] WHERE name = 'Bodyweight Glute Bridge' AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable','machine'] WHERE name = 'Cable Pulldown' AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell','kettlebell'] WHERE name = 'Dumbbell Lateral Raise' AND equipment = '{}';

-- Exercises added in migration 032 that were inserted without equipment (empty array default)

UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Bench Press'           AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Bulgarian Split Squat' AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Calf Raise'            AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Deadlift'              AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Front Squat'           AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Glute Bridge'          AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Good Morning'          AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Overhead Press'        AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Preacher Curl'         AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Romanian Deadlift'     AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Shrug'                 AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Skull Crusher'         AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Squat'                 AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Upright Row'           AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Barbell Wrist Curl'            AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Bent-Over Barbell Row'         AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell'] WHERE name = 'Landmine Press'                AND equipment = '{}';

UPDATE exercise_library SET equipment = ARRAY['cable'] WHERE name = 'Cable Chest Dips'               AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable'] WHERE name = 'Cable Curls'                    AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable'] WHERE name = 'Cable Front Raise'              AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable'] WHERE name = 'Cable Lateral Raise'            AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable'] WHERE name = 'Cable Overhead Tricep Extension' AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable'] WHERE name = 'Cable Reverse Fly'              AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable'] WHERE name = 'Cable Upright Row'              AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable'] WHERE name = 'Single Arm Cable Row'           AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable'] WHERE name = 'Tricep Cable Combo'             AND equipment = '{}';

UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Bulgarian Split Squat'  AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Calf Raise'             AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Front Raise'            AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Hammer Curl'            AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Overhead Press'         AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Overhead Tricep Extension' AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Preacher Curl'          AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Reverse Fly'            AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Romanian Deadlift'      AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Shoulder Press'         AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Shrug'                  AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Skull Crusher'          AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell'] WHERE name = 'Dumbbell Wrist Curl'             AND equipment = '{}';

UPDATE exercise_library SET equipment = ARRAY['machine'] WHERE name = 'Machine Calf Raise'            AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell','bodyweight'] WHERE name = 'Single Leg Hip Thrusts' AND equipment = '{}';

-- ─── SECTION 2: Add new exercises ────────────────────────────────────────────

INSERT INTO exercise_library (name, muscles, equipment, instructions, exercise_type) VALUES

-- ── CHEST ──────────────────────────────────────────────────────────────────
('Dumbbell Bench Press',
 '[{"muscle":"chest","role":"main"},{"muscle":"shoulders","role":"secondary"},{"muscle":"triceps","role":"secondary"}]',
 ARRAY['dumbbell'],
 'Lie on a flat bench holding a dumbbell in each hand at chest height, palms facing forward. Press the dumbbells up until your arms are fully extended, then lower them under control until your elbows drop just below the bench level. Keep your shoulder blades retracted throughout.',
 'weighted'),

('Incline Dumbbell Press',
 '[{"muscle":"chest","role":"main"},{"muscle":"shoulders","role":"secondary"},{"muscle":"triceps","role":"secondary"}]',
 ARRAY['dumbbell'],
 'Set a bench to 30–45° and hold a dumbbell in each hand at shoulder height. Press the dumbbells up until your arms are extended, then lower with control. The incline shifts emphasis to the upper chest and front deltoids.',
 'weighted'),

('Incline Dumbbell Fly',
 '[{"muscle":"chest","role":"main"},{"muscle":"shoulders","role":"secondary"}]',
 ARRAY['dumbbell'],
 'Set a bench to 30–45° and lie back with a dumbbell in each hand directly above your chest, palms facing each other. With a slight bend in your elbows, lower the dumbbells out to the sides in a wide arc until you feel a stretch across your chest. Reverse the arc to bring them back together.',
 'weighted'),

('Cable Chest Press',
 '[{"muscle":"chest","role":"main"},{"muscle":"triceps","role":"secondary"},{"muscle":"shoulders","role":"secondary"}]',
 ARRAY['cable'],
 'Stand facing away from a cable machine with handles set at chest height. Step forward into a split stance and press both handles forward until your arms are extended, then slowly return, feeling a stretch across your chest. Keep your core tight throughout.',
 'weighted'),

('Dumbbell Pullover',
 '[{"muscle":"chest","role":"main"},{"muscle":"lats","role":"secondary"}]',
 ARRAY['dumbbell'],
 'Lie across a flat bench with only your upper back on the pad, holding a single dumbbell with both hands directly above your chest. Lower the dumbbell in an arc behind your head, keeping your elbows slightly bent, until you feel a deep stretch in your lats and chest. Pull the dumbbell back over your chest.',
 'weighted'),

-- ── BACK ───────────────────────────────────────────────────────────────────
('Barbell Hip Thrust',
 '[{"muscle":"glutes","role":"main"},{"muscle":"hamstrings","role":"secondary"}]',
 ARRAY['barbell'],
 'Sit with your upper back against a bench and a padded barbell across your hips. Drive your feet into the floor and thrust your hips up until your torso is parallel to the floor, squeezing your glutes hard at the top. Lower until your hips are just above the floor, then repeat.',
 'weighted'),

('Chest-Supported Dumbbell Row',
 '[{"muscle":"upper back","role":"main"},{"muscle":"lats","role":"main"},{"muscle":"biceps","role":"secondary"}]',
 ARRAY['dumbbell'],
 'Set an incline bench to roughly 30–45° and lie face-down, holding a dumbbell in each hand. Row both dumbbells up toward your hips, driving your elbows back and squeezing your shoulder blades together at the top, then lower under control. The chest-supported position eliminates lower back involvement.',
 'weighted'),

('Machine Row',
 '[{"muscle":"upper back","role":"main"},{"muscle":"lats","role":"main"},{"muscle":"biceps","role":"secondary"}]',
 ARRAY['machine'],
 'Sit at the machine with your chest against the pad and grip the handles at shoulder width. Row the handles toward your torso, pulling your elbows back and squeezing your upper back, then return under control, allowing your shoulder blades to fully protract before the next rep.',
 'weighted'),

('Pendlay Row',
 '[{"muscle":"upper back","role":"main"},{"muscle":"lats","role":"main"},{"muscle":"biceps","role":"secondary"}]',
 ARRAY['barbell'],
 'Stand over a loaded barbell with your torso nearly horizontal and grip just wider than shoulder width. Drive the bar explosively toward your lower chest, then lower it completely to the floor between each rep. The dead-stop eliminates momentum and forces full engagement from the start.',
 'weighted'),

('Straight Arm Pulldown',
 '[{"muscle":"lats","role":"main"},{"muscle":"core","role":"secondary"}]',
 ARRAY['cable'],
 'Stand facing a cable machine with a bar or rope attachment set high. With arms fully extended and a slight bend at the elbows, press the attachment down in an arc toward your thighs, feeling your lats contract at the bottom. Return slowly to the top under tension.',
 'weighted'),

('Close Grip Lat Pulldown',
 '[{"muscle":"lats","role":"main"},{"muscle":"biceps","role":"secondary"},{"muscle":"upper back","role":"secondary"}]',
 ARRAY['cable','machine'],
 'Sit at a lat pulldown machine and take a close, neutral or underhand grip. Pull the bar to your upper chest, driving your elbows down toward your hips and squeezing your lats at the bottom. Lean back slightly and return under control, letting your lats fully stretch at the top.',
 'weighted'),

-- ── BICEPS ─────────────────────────────────────────────────────────────────
('EZ Bar Curl',
 '[{"muscle":"biceps","role":"main"},{"muscle":"forearms","role":"secondary"}]',
 ARRAY['barbell'],
 'Stand holding an EZ bar at the angled grips with a supinated or slightly neutral grip. Curl the bar toward your shoulders by bending your elbows, keeping your upper arms stationary, then lower under control. The angled grip reduces wrist strain compared to a straight barbell.',
 'weighted'),

('Concentration Curl',
 '[{"muscle":"biceps","role":"main"}]',
 ARRAY['dumbbell'],
 'Sit on a bench and brace your elbow against your inner thigh with a dumbbell hanging down. Curl the dumbbell toward your shoulder without moving your upper arm, squeezing hard at the top, then lower fully. The braced position isolates the bicep with minimal momentum.',
 'weighted'),

('Cable Hammer Curl',
 '[{"muscle":"biceps","role":"main"},{"muscle":"forearms","role":"secondary"}]',
 ARRAY['cable'],
 'Attach a rope to a low cable pulley and stand facing the machine. Grip each end of the rope with a neutral grip, thumbs pointing up. Curl the rope toward your shoulders by bending your elbows while keeping your upper arms stationary, then lower under control.',
 'weighted'),

('Incline Dumbbell Curl',
 '[{"muscle":"biceps","role":"main"},{"muscle":"forearms","role":"secondary"}]',
 ARRAY['dumbbell'],
 'Set a bench to 45–60° and sit back, letting your arms hang straight down with a dumbbell in each hand. Curl both dumbbells up, fully supinating at the top, then lower slowly back to the hanging position. The incline stretches the long head of the bicep for a greater range of motion.',
 'weighted'),

('Machine Curl',
 '[{"muscle":"biceps","role":"main"}]',
 ARRAY['machine'],
 'Sit at the preacher/machine curl station and position your upper arms on the pad, aligning your elbows with the machine pivot. Curl the handles toward your face by bending your elbows, then lower under control without fully releasing tension at the bottom.',
 'weighted'),

-- ── TRICEPS ────────────────────────────────────────────────────────────────
('Machine Tricep Extension',
 '[{"muscle":"triceps","role":"main"}]',
 ARRAY['machine'],
 'Sit at the machine and grip the handles with your upper arms resting on the pad. Extend your elbows to push the handles down until your arms are straight, then return under control. Keep your elbows stationary on the pad throughout the movement.',
 'weighted'),

('Dumbbell Tricep Kickback',
 '[{"muscle":"triceps","role":"main"}]',
 ARRAY['dumbbell'],
 'Hinge forward at the hips and brace your non-working arm on a bench or your knee. Hold a dumbbell with your upper arm parallel to the floor. Extend your elbow to kick the dumbbell back until your arm is straight, squeeze the tricep at the top, then return. Keep your upper arm stationary.',
 'weighted'),

('Rope Pushdown',
 '[{"muscle":"triceps","role":"main"}]',
 ARRAY['cable'],
 'Attach a rope to a high cable pulley and stand facing the machine. Grip each end of the rope and press both ends downward by extending your elbows, separating the rope ends slightly at the bottom for a full tricep contraction. Return under control.',
 'weighted'),

-- ── LEGS — QUADS ───────────────────────────────────────────────────────────
('Goblet Squat',
 '[{"muscle":"quads","role":"main"},{"muscle":"glutes","role":"secondary"},{"muscle":"core","role":"secondary"}]',
 ARRAY['kettlebell','dumbbell'],
 'Hold a kettlebell or dumbbell vertically at your chest with both hands. Stand with feet slightly wider than shoulder width and toes slightly turned out. Squat down, keeping your chest up and elbows inside your knees, until your thighs reach parallel or below. Drive through your heels to stand.',
 'weighted'),

('Walking Lunge',
 '[{"muscle":"quads","role":"main"},{"muscle":"glutes","role":"secondary"},{"muscle":"hamstrings","role":"secondary"}]',
 ARRAY['dumbbell'],
 'Stand with a dumbbell in each hand and step forward, lowering your back knee toward the floor in a lunge. Drive through your front heel to stand, then immediately step forward with the other leg, continuing alternately across the floor.',
 'weighted'),

('Dumbbell Lunge',
 '[{"muscle":"quads","role":"main"},{"muscle":"glutes","role":"secondary"},{"muscle":"hamstrings","role":"secondary"}]',
 ARRAY['dumbbell'],
 'Stand holding a dumbbell in each hand by your sides. Step one foot forward and lower until both knees are bent at roughly 90°, then push back to the starting position. Complete all reps on one leg or alternate each rep.',
 'weighted'),

('Barbell Lunge',
 '[{"muscle":"quads","role":"main"},{"muscle":"glutes","role":"secondary"},{"muscle":"hamstrings","role":"secondary"}]',
 ARRAY['barbell'],
 'Place a barbell across your upper back and stand with feet shoulder-width apart. Step forward with one leg and lower your back knee toward the floor, then push back to the start. Keep your torso upright and avoid letting your front knee track too far past your toes.',
 'weighted'),

('Step Up',
 '[{"muscle":"quads","role":"main"},{"muscle":"glutes","role":"secondary"}]',
 ARRAY['dumbbell'],
 'Stand in front of a bench or box holding a dumbbell in each hand. Step one foot onto the box and drive through that heel to bring your trailing foot up. Step back down and repeat. Keep your torso upright and avoid pushing off the trailing leg.',
 'weighted'),

('Smith Machine Squat',
 '[{"muscle":"quads","role":"main"},{"muscle":"glutes","role":"secondary"},{"muscle":"hamstrings","role":"secondary"}]',
 ARRAY['machine'],
 'Set the bar on a Smith machine at shoulder height and position it across your upper back. Squat down to parallel or below by pushing your hips back and bending your knees, then drive back up through your heels. Place your feet slightly forward of the bar to compensate for the fixed path.',
 'weighted'),

-- ── LEGS — HAMSTRINGS/GLUTES ───────────────────────────────────────────────
('Sumo Deadlift',
 '[{"muscle":"hamstrings","role":"main"},{"muscle":"glutes","role":"main"},{"muscle":"quads","role":"secondary"},{"muscle":"lower back","role":"secondary"}]',
 ARRAY['barbell'],
 'Stand with a wide stance and grip the bar between your legs with a narrower shoulder-width grip. Push your knees out in line with your toes and keep your torso more upright than a conventional deadlift. Drive the floor away, keep the bar close to your body, and lock out your hips at the top.',
 'weighted'),

('Trap Bar Deadlift',
 '[{"muscle":"hamstrings","role":"main"},{"muscle":"glutes","role":"main"},{"muscle":"quads","role":"main"},{"muscle":"lower back","role":"secondary"}]',
 ARRAY['barbell'],
 'Stand inside the trap bar with handles on either side of your hips. Hinge down and grip both handles with arms straight. Drive through your legs to stand up, keeping your chest up and back flat. This variation is more quad-dominant than a straight-bar deadlift and easier on the lower back.',
 'weighted'),

('Nordic Hamstring Curl',
 '[{"muscle":"hamstrings","role":"main"},{"muscle":"glutes","role":"secondary"}]',
 ARRAY['bodyweight'],
 'Kneel on a padded surface and have a partner hold your ankles or secure them under a bar. Keeping your body straight from knee to head, slowly lower your torso toward the floor by allowing your knees to extend, resisting with your hamstrings as long as possible. Use your hands to catch yourself at the bottom, then use a push to help return.',
 'bodyweight'),

('Glute-Ham Raise',
 '[{"muscle":"hamstrings","role":"main"},{"muscle":"glutes","role":"secondary"},{"muscle":"lower back","role":"secondary"}]',
 ARRAY['machine'],
 'Position yourself on the glute-ham raise machine with feet secured and knees just behind the pad. Lower your torso toward the floor by extending your knees, then drive through your hamstrings and glutes to curl your body back up to the starting position.',
 'bodyweight'),

('Single Leg Romanian Deadlift',
 '[{"muscle":"hamstrings","role":"main"},{"muscle":"glutes","role":"main"}]',
 ARRAY['dumbbell','kettlebell'],
 'Stand on one leg with a dumbbell in the opposite hand. Hinge at the hip, lowering the dumbbell down your standing leg while your free leg extends behind you for balance. Stop when your back is parallel to the floor, then drive back up through your standing heel.',
 'weighted'),

('Reverse Hyperextension',
 '[{"muscle":"glutes","role":"main"},{"muscle":"hamstrings","role":"secondary"},{"muscle":"lower back","role":"secondary"}]',
 ARRAY['machine'],
 'Lie face-down on the machine with your hips at the edge of the pad and legs hanging. Swing your legs up by contracting your glutes and lower back until your body is flat, then lower under control. Keep the movement controlled — avoid excessive swinging.',
 'weighted'),

-- ── GLUTES ─────────────────────────────────────────────────────────────────
('Cable Kickback',
 '[{"muscle":"glutes","role":"main"}]',
 ARRAY['cable'],
 'Attach an ankle strap to a low cable and stand facing the machine. With your working leg straight, kick it backward in an arc until your glute is fully contracted, then return under control. Avoid swinging or rotating your hips — keep the movement isolated to the hip joint.',
 'weighted'),

('Hip Abduction Machine',
 '[{"muscle":"abductors","role":"main"},{"muscle":"glutes","role":"secondary"}]',
 ARRAY['machine'],
 'Sit in the machine with your back flat against the pad and legs resting against the pads. Push your legs outward against the resistance, abducting your hips to the end range, then control the return. Keep your lower back pressed against the seat throughout.',
 'weighted'),

-- ── CALVES ─────────────────────────────────────────────────────────────────
('Seated Calf Raise',
 '[{"muscle":"calves","role":"main"}]',
 ARRAY['machine'],
 'Sit at the machine with your knees under the pad and the balls of your feet on the platform. Push up onto your toes, extending your ankles fully, then lower your heels down to get a deep stretch. Pause briefly at both the top and bottom for maximum muscle involvement.',
 'weighted'),

-- ── CORE ───────────────────────────────────────────────────────────────────
('Russian Twist',
 '[{"muscle":"core","role":"main"}]',
 ARRAY['dumbbell','bodyweight'],
 'Sit on the floor with knees bent and feet slightly raised. Lean back slightly and hold your hands together or grip a dumbbell in front of you. Rotate your torso to one side and touch the floor or weight beside your hip, then rotate to the other side. Keep your core braced throughout.',
 'weighted'),

('Cable Crunch',
 '[{"muscle":"core","role":"main"}]',
 ARRAY['cable'],
 'Attach a rope to a high cable pulley and kneel facing the machine. Grip each end of the rope beside your head and crunch your elbows toward your knees by flexing your spine — not by pulling with your arms. Squeeze your abs at the bottom, then return under control.',
 'weighted'),

('Hanging Leg Raise',
 '[{"muscle":"core","role":"main"},{"muscle":"hip flexors","role":"secondary"}]',
 ARRAY['bodyweight'],
 'Hang from a pull-up bar with arms extended and body straight. Keeping your legs together, raise them until they are parallel to the floor or higher, then lower under control. Avoid swinging — initiate the movement from your abs, not momentum.',
 'bodyweight'),

('Dead Bug',
 '[{"muscle":"core","role":"main"}]',
 ARRAY['bodyweight'],
 'Lie on your back with arms extended toward the ceiling and knees bent at 90° in the air. Slowly lower one arm behind your head and extend the opposite leg toward the floor simultaneously, keeping your lower back pressed into the ground. Return to the start and repeat on the other side.',
 'bodyweight'),

('Decline Crunch',
 '[{"muscle":"core","role":"main"}]',
 ARRAY['bodyweight'],
 'Lie on a decline bench with your feet secured and hands lightly behind your head. Curl your upper body toward your knees by flexing your spine — do not pull on your neck. Lower under control and repeat.',
 'bodyweight'),

('Bicycle Crunch',
 '[{"muscle":"core","role":"main"}]',
 ARRAY['bodyweight'],
 'Lie on your back with hands lightly behind your head and legs elevated, knees bent at 90°. Bring one elbow toward the opposite knee while extending the other leg, then alternate in a pedalling motion. Keep your lower back pressed into the floor throughout.',
 'bodyweight'),

-- ── SHOULDERS ──────────────────────────────────────────────────────────────
('Machine Lateral Raise',
 '[{"muscle":"shoulders","role":"main"}]',
 ARRAY['machine'],
 'Sit at the machine with your elbows resting on the arm pads at your sides. Raise both arms outward against the resistance until your elbows reach shoulder height, then lower under control. Adjust the seat so the machine axis of rotation aligns with your shoulder joints.',
 'weighted'),

('Machine Rear Delt Fly',
 '[{"muscle":"shoulders","role":"main"},{"muscle":"upper back","role":"secondary"}]',
 ARRAY['machine'],
 'Sit facing the machine and grip the handles or rest your forearms on the pads with arms forward. Push your arms backward and outward, squeezing your rear deltoids and upper back at end range, then return under control.',
 'weighted'),

('Barbell Front Raise',
 '[{"muscle":"shoulders","role":"main"}]',
 ARRAY['barbell'],
 'Stand holding a barbell with a shoulder-width pronated grip. Keeping your arms straight, raise the bar in front of you to shoulder height, then lower under control. Perform the movement slowly to isolate the front deltoids and avoid swinging.',
 'weighted'),

('Landmine Lateral Raise',
 '[{"muscle":"shoulders","role":"main"}]',
 ARRAY['barbell'],
 'Place one end of a barbell in a landmine attachment or corner. Stand sideways to the bar and hold the sleeve with the arm closest to the bar. Raise the bar outward and upward in an arc until your arm reaches shoulder height, then lower slowly. The arcing path reduces shoulder joint stress compared to a standard lateral raise.',
 'weighted'),

-- ── FOREARMS ───────────────────────────────────────────────────────────────
('Reverse Curl',
 '[{"muscle":"forearms","role":"main"},{"muscle":"biceps","role":"secondary"}]',
 ARRAY['barbell','dumbbell'],
 'Stand holding a barbell or dumbbells with a pronated (overhand) grip. Keeping your upper arms stationary, curl the bar up toward your shoulders by bending your elbows, leading with your knuckles. Lower under control. Targets the brachialis and forearm extensors more than a standard supinated curl.',
 'weighted'),

-- ── KETTLEBELL / FULL BODY ─────────────────────────────────────────────────
('Kettlebell Swing',
 '[{"muscle":"glutes","role":"main"},{"muscle":"hamstrings","role":"secondary"},{"muscle":"lower back","role":"secondary"}]',
 ARRAY['kettlebell'],
 'Stand with feet shoulder-width apart and grip a kettlebell with both hands. Hinge at the hips and let the kettlebell swing between your legs, then explosively extend your hips to drive the kettlebell forward to chest height or overhead. Keep your back flat and let your hips — not your arms — generate the power.',
 'weighted'),

('Kettlebell Goblet Squat',
 '[{"muscle":"quads","role":"main"},{"muscle":"glutes","role":"secondary"},{"muscle":"core","role":"secondary"}]',
 ARRAY['kettlebell'],
 'Hold a kettlebell by the horns at your chest. Stand with feet slightly wider than hip-width and toes slightly turned out. Squat down, keeping your chest up and elbows inside your knees, until your thighs are parallel or below. Drive back up through your heels to stand.',
 'weighted'),

('Farmer''s Walk',
 '[{"muscle":"traps","role":"main"},{"muscle":"forearms","role":"secondary"},{"muscle":"core","role":"secondary"}]',
 ARRAY['dumbbell','kettlebell'],
 'Stand holding a heavy dumbbell or kettlebell in each hand by your sides. Walk forward with controlled upright posture — chest up, shoulders back, core tight. Take short, brisk steps and avoid leaning to either side. Walk for a set distance or time.',
 'weighted')

ON CONFLICT (name) DO NOTHING;

-- ─── SECTION 3: Ensure correct equipment on all new exercises ─────────────────
-- Guards against any environment where ARRAY[] in multi-row INSERT doesn't
-- persist correctly (e.g. re-runs, migration framework quirks).

UPDATE exercise_library SET equipment = ARRAY['dumbbell']              WHERE name IN ('Dumbbell Bench Press','Incline Dumbbell Press','Incline Dumbbell Fly','Concentration Curl','Incline Dumbbell Curl','Dumbbell Lunge','Dumbbell Tricep Kickback','Dumbbell Pullover','Step Up','Walking Lunge')           AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable']                 WHERE name IN ('Cable Chest Press','Cable Hammer Curl','Cable Crunch','Straight Arm Pulldown','Rope Pushdown','Cable Kickback')                                                                                                              AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable','machine']       WHERE name = 'Close Grip Lat Pulldown'                                                                                                                                                                                                      AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell']               WHERE name IN ('Barbell Hip Thrust','Pendlay Row','Barbell Lunge','Barbell Front Raise','Sumo Deadlift','Trap Bar Deadlift','Landmine Lateral Raise','EZ Bar Curl')                                                                          AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell','dumbbell']    WHERE name = 'Reverse Curl'                                                                                                                                                                                                                 AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['machine']               WHERE name IN ('Machine Row','Machine Curl','Machine Tricep Extension','Machine Lateral Raise','Machine Rear Delt Fly','Hip Abduction Machine','Seated Calf Raise','Reverse Hyperextension','Smith Machine Squat','Glute-Ham Raise')        AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell','kettlebell'] WHERE name IN ('Chest-Supported Dumbbell Row','Single Leg Romanian Deadlift')                                                                                                                                                               AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['kettlebell','dumbbell'] WHERE name = 'Goblet Squat'                                                                                                                                                                                                                 AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['kettlebell']            WHERE name IN ('Kettlebell Swing','Kettlebell Goblet Squat')                                                                                                                                                                                 AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell','kettlebell'] WHERE name = 'Farmer''s Walk'                                                                                                                                                                                                               AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell','bodyweight'] WHERE name = 'Russian Twist'                                                                                                                                                                                                                AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']            WHERE name IN ('Nordic Hamstring Curl','Hanging Leg Raise','Dead Bug','Decline Crunch','Bicycle Crunch')                                                                                                                                     AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell']               WHERE name = 'Barbell Hip Thrust'                                                                                                                                                                                                           AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell','bodyweight']  WHERE name = 'Single Leg Hip Thrusts'                                                                                                                                                                                                       AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']            WHERE name = 'Bodyweight Glute Bridge'                                                                                                                                                                                                      AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable','machine']       WHERE name = 'Cable Pulldown'                                                                                                                                                                                                               AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['dumbbell','kettlebell'] WHERE name = 'Dumbbell Lateral Raise'                                                                                                                                                                                                       AND equipment = '{}';

-- ─── SECTION 4: Correct muscle assignments on existing and new exercises ─────

-- Barbell Deadlift: quads are a clear secondary mover
UPDATE exercise_library SET muscles = '[{"muscle":"hamstrings","role":"main"},{"muscle":"glutes","role":"main"},{"muscle":"lower back","role":"main"},{"muscle":"quads","role":"secondary"},{"muscle":"traps","role":"secondary"}]'::jsonb WHERE name = 'Barbell Deadlift';

-- Chin-Up: upper back is clearly secondary
UPDATE exercise_library SET muscles = '[{"muscle":"lats","role":"main"},{"muscle":"biceps","role":"main"},{"muscle":"upper back","role":"secondary"}]'::jsonb WHERE name = 'Chin-Up';

-- Hack Squat: hamstrings are a secondary mover
UPDATE exercise_library SET muscles = '[{"muscle":"quads","role":"main"},{"muscle":"glutes","role":"secondary"},{"muscle":"hamstrings","role":"secondary"}]'::jsonb WHERE name = 'Hack Squat';

-- Dumbbell Romanian Deadlift: lower back secondary (hinge = lower back always involved)
UPDATE exercise_library SET muscles = '[{"muscle":"hamstrings","role":"main"},{"muscle":"glutes","role":"main"},{"muscle":"lower back","role":"secondary"}]'::jsonb WHERE name = 'Dumbbell Romanian Deadlift';

-- Single Leg Romanian Deadlift: lower back secondary
UPDATE exercise_library SET muscles = '[{"muscle":"hamstrings","role":"main"},{"muscle":"glutes","role":"main"},{"muscle":"lower back","role":"secondary"}]'::jsonb WHERE name = 'Single Leg Romanian Deadlift';

-- Barbell Preacher Curl: forearms secondary
UPDATE exercise_library SET muscles = '[{"muscle":"biceps","role":"main"},{"muscle":"forearms","role":"secondary"}]'::jsonb WHERE name = 'Barbell Preacher Curl';

-- Cable Curls: forearms secondary
UPDATE exercise_library SET muscles = '[{"muscle":"biceps","role":"main"},{"muscle":"forearms","role":"secondary"}]'::jsonb WHERE name = 'Cable Curls';

-- Ab Wheel: lats pull you back, not shoulders
UPDATE exercise_library SET muscles = '[{"muscle":"core","role":"main"},{"muscle":"lats","role":"secondary"}]'::jsonb WHERE name = 'Ab Wheel';

-- Bicycle Crunch: hip flexors secondary from leg pedalling
UPDATE exercise_library SET muscles = '[{"muscle":"core","role":"main"},{"muscle":"hip flexors","role":"secondary"}]'::jsonb WHERE name = 'Bicycle Crunch';

-- Plank: shoulders and glutes are well-known stabilisers
UPDATE exercise_library SET muscles = '[{"muscle":"core","role":"main"},{"muscle":"shoulders","role":"secondary"},{"muscle":"glutes","role":"secondary"}]'::jsonb WHERE name = 'Plank';

-- Kettlebell Swing: core secondary (anti-extension demand)
UPDATE exercise_library SET muscles = '[{"muscle":"glutes","role":"main"},{"muscle":"hamstrings","role":"secondary"},{"muscle":"lower back","role":"secondary"},{"muscle":"core","role":"secondary"}]'::jsonb WHERE name = 'Kettlebell Swing';
