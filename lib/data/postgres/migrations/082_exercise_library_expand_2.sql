-- 082_exercise_library_expand_2.sql
-- Add 18 more exercises filling gaps: chest machine/decline, back inverted/rack,
-- shoulder machine/pike, core side-plank/pallof/climbers/v-up/toe-touch,
-- glute donkey-kick/fire-hydrant, tricep diamond push-up, trap machine shrug,
-- forearm wrist extension, leg barbell box squat.

INSERT INTO exercise_library (name, muscles, equipment, instructions, exercise_type) VALUES

-- ── CHEST ──────────────────────────────────────────────────────────────────────

('Decline Dumbbell Press',
 '[{"muscle":"chest","role":"main"},{"muscle":"shoulders","role":"secondary"},{"muscle":"triceps","role":"secondary"}]',
 ARRAY['dumbbell'],
 'Lie on a decline bench with your head lower than your feet, holding a dumbbell in each hand at chest level, palms forward. Press the dumbbells up until your arms are fully extended, then lower under control until your elbows drop just below chest level. The decline angle shifts emphasis to the lower chest.',
 'weighted'),

('Machine Chest Press',
 '[{"muscle":"chest","role":"main"},{"muscle":"shoulders","role":"secondary"},{"muscle":"triceps","role":"secondary"}]',
 ARRAY['machine'],
 'Adjust the seat so the handles align with mid-chest. Grip the handles and press forward until your arms are fully extended, keeping your back against the pad. Slowly return to the start position maintaining constant tension. Most machines have a converging arc that mimics a natural pressing motion.',
 'weighted'),

('Weighted Dip',
 '[{"muscle":"triceps","role":"main"},{"muscle":"chest","role":"main"},{"muscle":"shoulders","role":"secondary"}]',
 ARRAY['bodyweight','machine'],
 'Attach a weight plate to a dip belt or hold a dumbbell between your thighs. Grip parallel bars and lower your body by bending at the elbows until your upper arms are parallel to the floor. Press back up to full extension. Lean slightly forward to emphasise the chest; stay upright to shift focus to the triceps.',
 'weighted'),

-- ── BACK ───────────────────────────────────────────────────────────────────────

('Inverted Row',
 '[{"muscle":"upper back","role":"main"},{"muscle":"lats","role":"main"},{"muscle":"biceps","role":"secondary"}]',
 ARRAY['bodyweight','barbell'],
 'Set a barbell in a rack at roughly hip height. Lie underneath it and grip the bar with an overhand grip shoulder-width apart. With heels on the floor and body straight, pull your chest up to the bar. Lower under control. Adjust difficulty by changing the bar height — lower makes it harder.',
 'bodyweight'),

('Rack Pull',
 '[{"muscle":"upper back","role":"main"},{"muscle":"traps","role":"main"},{"muscle":"lower back","role":"secondary"},{"muscle":"glutes","role":"secondary"}]',
 ARRAY['barbell'],
 'Set the safety pins in a power rack so the bar starts just below or at knee height. Grip the bar with a hip-width stance, hinge forward, and pull the bar by driving through your legs and locking out your hips and back. The shortened range allows heavier loads and emphasises the upper pull phase of the deadlift.',
 'weighted'),

-- ── SHOULDERS ──────────────────────────────────────────────────────────────────

('Machine Shoulder Press',
 '[{"muscle":"shoulders","role":"main"},{"muscle":"triceps","role":"secondary"}]',
 ARRAY['machine'],
 'Adjust the seat so the handles are at shoulder height. Grip the handles and press overhead to full arm extension, then lower slowly. The guided path reduces stabiliser demand, allowing heavier focus on the deltoids.',
 'weighted'),

('Pike Push-Up',
 '[{"muscle":"shoulders","role":"main"},{"muscle":"triceps","role":"secondary"}]',
 ARRAY['bodyweight'],
 'Start in a downward dog position with hips raised high, forming an inverted V with your body. Bend your elbows to lower the top of your head toward the floor between your hands, then press back up. The hip elevation shifts the load onto the front deltoids and upper chest rather than the pectorals.',
 'bodyweight'),

-- ── CORE ───────────────────────────────────────────────────────────────────────

('Side Plank',
 '[{"muscle":"core","role":"main"},{"muscle":"shoulders","role":"secondary"},{"muscle":"glutes","role":"secondary"}]',
 ARRAY['bodyweight'],
 'Lie on your side and prop yourself on your forearm with your elbow directly beneath your shoulder. Stack your feet and lift your hips so your body forms a straight diagonal line from head to foot. Hold the position, bracing your obliques. Switch sides. Progress by raising the top leg or adding a hip dip.',
 'bodyweight'),

('Pallof Press',
 '[{"muscle":"core","role":"main"}]',
 ARRAY['cable'],
 'Stand sideways to a cable stack set at chest height and hold the handle with both hands at your sternum. Brace your core and press your hands straight out until your arms are fully extended, pause for a count, then return. The cable tries to rotate your torso — resist it throughout. This is an anti-rotation exercise.',
 'weighted'),

('Mountain Climbers',
 '[{"muscle":"core","role":"main"},{"muscle":"hip flexors","role":"main"},{"muscle":"shoulders","role":"secondary"}]',
 ARRAY['bodyweight'],
 'Start in a high push-up position with hands directly under your shoulders and body forming a straight line. Drive one knee toward your chest, then quickly switch legs in a running motion, alternating rapidly. Keep your hips level and core braced throughout — avoid letting your hips rise or sag.',
 'bodyweight'),

('V-Up',
 '[{"muscle":"core","role":"main"},{"muscle":"hip flexors","role":"secondary"}]',
 ARRAY['bodyweight'],
 'Lie flat on your back with legs straight and arms extended overhead. Simultaneously raise your legs and upper body to form a V shape, reaching your hands toward your feet at the top. Lower both back under control without letting your legs or shoulders touch the floor between reps.',
 'bodyweight'),

('Toe Touch Crunch',
 '[{"muscle":"core","role":"main"}]',
 ARRAY['bodyweight'],
 'Lie on your back with legs raised vertically, perpendicular to the floor. Crunch upward, reaching both hands toward your toes. Lower slowly. Keeping the legs vertical removes hip flexor contribution and places constant tension on the upper rectus abdominis.',
 'bodyweight'),

-- ── GLUTES / HIPS ──────────────────────────────────────────────────────────────

('Donkey Kick',
 '[{"muscle":"glutes","role":"main"},{"muscle":"hamstrings","role":"secondary"}]',
 ARRAY['bodyweight','cable'],
 'Start on all fours with knees hip-width apart. Keeping the knee bent at 90° and foot flexed, drive one heel straight up toward the ceiling until your thigh is parallel to the floor. Squeeze the glute hard at the top, then lower under control. For the cable version, attach an ankle cuff to a low pulley.',
 'bodyweight'),

('Fire Hydrant',
 '[{"muscle":"abductors","role":"main"},{"muscle":"glutes","role":"main"}]',
 ARRAY['bodyweight'],
 'Start on all fours with a neutral spine. Keeping your knee bent at 90°, lift one leg out to the side until your thigh is parallel to the floor, like a dog at a fire hydrant. Pause briefly at the top, then lower under control. Targets the glute medius which is often underdeveloped.',
 'bodyweight'),

-- ── TRICEPS ────────────────────────────────────────────────────────────────────

('Diamond Push-Up',
 '[{"muscle":"triceps","role":"main"},{"muscle":"chest","role":"secondary"},{"muscle":"shoulders","role":"secondary"}]',
 ARRAY['bodyweight'],
 'Place your hands close together so your thumbs and index fingers form a diamond shape directly under your chest. Lower your chest toward the diamond, keeping your elbows tracking back alongside your torso. Press back to full extension. The narrow hand placement places maximum load on the triceps.',
 'bodyweight'),

-- ── TRAPS ──────────────────────────────────────────────────────────────────────

('Machine Shrug',
 '[{"muscle":"traps","role":"main"}]',
 ARRAY['machine'],
 'Stand or sit at a shrug machine and grip the handles with arms fully extended. Without bending your elbows, shrug your shoulders straight up toward your ears as high as possible. Hold for a brief count at the top, then lower slowly and fully. The machine allows heavier loads than dumbbell shrugs with less grip fatigue.',
 'weighted'),

-- ── FOREARMS ───────────────────────────────────────────────────────────────────

('Wrist Extension',
 '[{"muscle":"forearms","role":"main"}]',
 ARRAY['barbell','dumbbell'],
 'Sit on a bench with your forearms resting on your thighs, palms facing down, holding a light barbell or dumbbell. Let your wrists drop toward the floor, then extend them upward as far as possible. Lower slowly. Trains the forearm extensors — the counterpart to the wrist curl — for balanced forearm development.',
 'weighted'),

-- ── LEGS ───────────────────────────────────────────────────────────────────────

('Barbell Box Squat',
 '[{"muscle":"quads","role":"main"},{"muscle":"glutes","role":"main"},{"muscle":"hamstrings","role":"secondary"},{"muscle":"core","role":"secondary"}]',
 ARRAY['barbell'],
 'Place a box or bench behind you at roughly knee height. Unrack the bar in a standard squat position. Squat back and down, pushing your hips back more than in a regular squat, until you sit on the box. Hold briefly, then drive back up. The box breaks the stretch-shortening cycle and builds strength from a dead stop at the bottom.',
 'weighted');

-- ─── Safety-net: ensure equipment is set if INSERT quirk produced {} ──────────

UPDATE exercise_library SET equipment = ARRAY['dumbbell']             WHERE name = 'Decline Dumbbell Press' AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['machine']              WHERE name = 'Machine Chest Press'    AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight','machine'] WHERE name = 'Weighted Dip'           AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight','barbell'] WHERE name = 'Inverted Row'           AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell']              WHERE name = 'Rack Pull'              AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['machine']              WHERE name = 'Machine Shoulder Press' AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']           WHERE name = 'Pike Push-Up'           AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']           WHERE name = 'Side Plank'             AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['cable']                WHERE name = 'Pallof Press'           AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']           WHERE name = 'Mountain Climbers'      AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']           WHERE name = 'V-Up'                   AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']           WHERE name = 'Toe Touch Crunch'       AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight','cable']   WHERE name = 'Donkey Kick'            AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']           WHERE name = 'Fire Hydrant'           AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']           WHERE name = 'Diamond Push-Up'        AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['machine']              WHERE name = 'Machine Shrug'          AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell','dumbbell']   WHERE name = 'Wrist Extension'        AND equipment = '{}';
UPDATE exercise_library SET equipment = ARRAY['barbell']              WHERE name = 'Barbell Box Squat'      AND equipment = '{}';
