-- BF-130: two muscle groups have no home-gym option, found by the wider pass the entry asked for
-- rather than by the report that started it.
--
-- HAMSTRINGS — knee flexion. Every hamstring-main row except three is a hip hinge (RDL, deadlift,
-- good morning, Jefferson curl). The knee-flexion options were `Leg Curl` (machine),
-- `Glute-Ham Raise` (machine) and `Nordic Hamstring Curl` (bodyweight, needs an ankle anchor). The
-- owner has neither a machine nor an anchor, so his programs train hamstrings through hip extension
-- only — and that is the one pattern his lumbar constraint asks him to limit, which is what makes
-- this a gap rather than a preference. `Cable Lying Leg Curl` was added at runtime since the entry
-- was written, so the cable variant it asked for already exists; what is still missing is a
-- knee-flexion movement needing NO equipment at all.
--
-- ADDUCTORS — a worse gap than the reported one, and nobody had looked. Exactly ONE adductor-main
-- row exists in the whole catalogue (`Adductor Machine`), and it is machine-only, so a home gym has
-- zero. Measured across every main muscle: adductors was the only group with no home-reachable
-- option at all.
--
-- Idempotent via ON CONFLICT (name), matching migrations 081/082.
INSERT INTO exercise_library (name, muscles, equipment, instructions, exercise_type) VALUES

-- ── HAMSTRINGS (knee flexion, no machine, no anchor) ───────────────────────────

('Stability Ball Leg Curl',
 '[{"muscle":"hamstrings","role":"main"},{"muscle":"glutes","role":"secondary"},{"muscle":"core","role":"secondary"}]',
 ARRAY['bodyweight'],
 'Lie on your back with your heels on top of a stability ball and your arms flat on the floor. Lift your hips so your body forms a straight line from shoulders to heels, then bend your knees to roll the ball toward you, keeping the hips high. Straighten your legs under control to roll it back. Knee flexion under load with no machine and nothing to anchor your feet to.',
 'bodyweight'),

('Slider Leg Curl',
 '[{"muscle":"hamstrings","role":"main"},{"muscle":"glutes","role":"secondary"},{"muscle":"core","role":"secondary"}]',
 ARRAY['bodyweight'],
 'Lie on your back on a smooth floor with a towel or furniture slider under each heel. Bridge your hips up, then slide both heels away from you until your legs are almost straight, and pull them back in by bending the knees. Keep the hips high throughout — letting them drop turns it into a hip hinge. The eccentric is the hard part; slow it down rather than adding range.',
 'bodyweight'),

-- ── ADDUCTORS (the catalogue held one row, machine-only) ───────────────────────

('Copenhagen Plank',
 '[{"muscle":"adductors","role":"main"},{"muscle":"core","role":"secondary"},{"muscle":"obliques","role":"secondary"}]',
 ARRAY['bodyweight'],
 'Lie on your side with your top leg resting on a bench at about knee height and your bottom leg hanging below it. Support yourself on your forearm and lift your hips so your body is straight, driving the top leg down into the bench. Start with the knee of the top leg on the bench and progress to the ankle as it gets easier.',
 'bodyweight'),

('Cable Hip Adduction',
 '[{"muscle":"adductors","role":"main"},{"muscle":"glutes","role":"secondary"}]',
 ARRAY['cable'],
 'Attach an ankle strap to a low pulley and stand side-on to the tower with the strap on the leg nearest it. Step away to take up the slack, then draw that leg across the front of your body against the resistance and let it return under control. Hold the frame for balance so the working leg does the work.',
 'weighted')

ON CONFLICT (name) DO NOTHING;
