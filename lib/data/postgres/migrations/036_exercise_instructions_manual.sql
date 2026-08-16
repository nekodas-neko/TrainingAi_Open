-- 036_exercise_instructions_manual.sql
-- Adds instruction text for exercises not present in the exercises-dataset,
-- so they show useful how-to text in the exercise info panel.
-- GIFs for these cannot be auto-matched; they display "No GIF" until a custom
-- GIF is added to the forked dataset repo and a DIRECT_URL_OVERRIDE is added.

UPDATE exercise_library SET instructions = $instruction$
Kneel on a mat and grip the ab wheel with both hands, arms straight below your shoulders.
Brace your core hard and slowly roll the wheel forward, lowering your body toward the floor without letting your hips sag.
Extend as far as you can control, then use your abs to pull the wheel back to the start.
Keep your back flat throughout — do not let your lower back arch.
$instruction$ WHERE name = 'Ab Wheel' AND (instructions IS NULL OR instructions = '');

UPDATE exercise_library SET instructions = $instruction$
Attach a rope to a cable machine set at about face height.
Stand facing the machine and grab each end of the rope with a neutral grip, thumbs pointing up.
Pull the rope toward your face, separating your hands as you pull so they finish beside your ears.
Squeeze your rear deltoids and upper back at the peak, then return under control.
Keep your elbows level with your shoulders throughout the movement.
$instruction$ WHERE name = 'Face Pull' AND (instructions IS NULL OR instructions = '');

UPDATE exercise_library SET instructions = $instruction$
Adjust the pec deck seat so the handles are in line with the middle of your chest.
Sit back firmly against the pad and grip both handles or place your forearms on the pads.
Drive your arms together in a smooth arc, squeezing your chest hard at the point where the handles meet.
Slowly return to the start, feeling a full stretch across your chest at the end of each rep.
Keep your back flat against the pad and avoid shrugging your shoulders.
$instruction$ WHERE name = 'Pec Deck' AND (instructions IS NULL OR instructions = '');

UPDATE exercise_library SET instructions = $instruction$
Stand tall and raise one knee to hip height, then extend the hip slightly behind you as you lower.
Focus on stretching the hip flexor of the trailing leg with each repetition.
Keep your core braced and your torso upright — do not lean forward.
Perform all reps on one side before switching.
$instruction$ WHERE name = 'Hip Flexor Raise' AND (instructions IS NULL OR instructions = '');

UPDATE exercise_library SET instructions = $instruction$
Lie flat on a bench holding a dumbbell in each hand, arms extended directly above your chest, palms facing each other.
Keeping your upper arms stationary, hinge at the elbows and lower the dumbbells toward your forehead.
Stop when your forearms are roughly parallel to the floor, then drive the dumbbells back up by extending your elbows.
Keep the movement controlled — avoid flaring your elbows outward.
$instruction$ WHERE name = 'Dumbbell Skull Crusher' AND (instructions IS NULL OR instructions = '');

UPDATE exercise_library SET instructions = $instruction$
Stand or sit holding a single dumbbell with both hands, palms cupped around the upper weight plate.
Raise the dumbbell overhead until your arms are fully extended.
Keeping your upper arms close to your head, hinge at the elbows to lower the dumbbell behind your head.
Extend your elbows to raise the weight back to the start, squeezing your triceps at the top.
$instruction$ WHERE name = 'Dumbbell Overhead Tricep Extension' AND (instructions IS NULL OR instructions = '');
