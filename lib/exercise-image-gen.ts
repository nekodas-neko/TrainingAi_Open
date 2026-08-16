import { GoogleGenAI, Modality } from '@google/genai';
import sharp from 'sharp';

// Preview gives better consistency than stable release for now
export const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview';

export type ImageGenModel =
  | 'gemini-3.1-flash-image-preview'
  | 'gemini-3.1-flash-image'
  | 'gemini-2.5-flash-image'
  | 'imagen-4.0-generate-001'
  | 'imagen-4.0-ultra-generate-001'
  | 'imagen-4.0-fast-generate-001';

export const IMAGE_MODELS: Record<ImageGenModel, string> = {
  'gemini-3.1-flash-image-preview': 'Gemini 3.1 Flash Image (preview) ★',
  'gemini-3.1-flash-image': 'Gemini 3.1 Flash Image',
  'gemini-2.5-flash-image': 'Gemini 2.5 Flash Image',
  'imagen-4.0-generate-001': 'Imagen 4',
  'imagen-4.0-ultra-generate-001': 'Imagen 4 Ultra',
  'imagen-4.0-fast-generate-001': 'Imagen 4 Fast',
};

export interface MuscleGroup {
  muscle: string;
  role: 'main' | 'secondary';
}

// For generic muscle-group names or vague exercise names, describe the movement
// explicitly so the model knows what start/end positions to draw.
const EXERCISE_POSITION_HINTS: Record<string, { start: string; end: string }> = {
  // Core / abs
  'ab wheel':              { start: 'kneeling on floor, hands on ab wheel directly under shoulders, arms straight, body upright', end: 'arms rolled fully forward, body extended toward floor, back nearly parallel to ground, hips low' },
  'bicycle crunch':        { start: 'lying on back, hands behind head, one knee drawn toward chest, opposite elbow twisting toward that knee, other leg extended low', end: 'opposite knee pulled in, other elbow twisting to meet it — continuous alternating pedalling motion' },
  'cable crunch':          { start: 'kneeling facing cable machine, rope held behind head at neck level, torso upright, cable taut', end: 'torso crunched downward, elbows driving toward thighs, abs fully contracted at bottom' },
  'decline crunch':        { start: 'lying on decline bench, head lower than hips, knees bent, hands behind head, torso flat on pad', end: 'torso curled upward toward knees, shoulder blades lifted off bench, abs contracted' },
  'toe touch crunch':      { start: 'lying flat on back, legs raised straight and vertical, arms extended up toward feet', end: 'upper body lifted off floor, arms reaching up to touch toes, maximum trunk flexion' },
  'dead bug':              { start: 'lying on back, arms straight toward ceiling, knees bent at 90° raised in tabletop position, lower back pressed flat', end: 'one arm extended overhead toward floor, opposite leg straightened and lowered toward floor, core braced, lower back flat' },
  'mountain climbers':     { start: 'high plank position, arms straight, body rigid, one knee driven forward under chest', end: 'other knee driven forward as first leg extends back — rapid alternating motion' },
  'side plank':            { start: 'lying on side, forearm flat on ground, feet stacked, hips resting on floor, body in straight line', end: 'hips raised to form a straight rigid line from head to feet, supported on forearm and foot edge' },
  'v-up':                  { start: 'lying flat on back, legs straight on floor, arms extended overhead behind head', end: 'body folded into a V shape, both legs and torso raised simultaneously, hands reaching up toward feet' },
  'pallof press':          { start: 'standing sideways to cable machine, both hands holding handle at chest, cable under tension, core braced', end: 'arms pressed straight out in front of chest at full extension, resisting rotation, core engaged' },
  'hanging leg raise':     { start: 'hanging from pull-up bar, arms fully extended, legs hanging straight down', end: 'legs raised until parallel to floor or higher, hips flexed, lower abs contracted' },
  abs:                     { start: 'lying flat on back, legs bent, hands behind head, torso flat on floor', end: 'torso fully crunched upward, chest toward knees, shoulders off the floor' },
  core:                    { start: 'lying flat on back, legs bent, hands behind head, torso flat on floor', end: 'torso fully crunched upward, chest toward knees, shoulders off the floor' },
  crunch:                  { start: 'lying flat on back, knees bent, feet flat, hands behind head', end: 'upper back raised, shoulder blades fully off floor, maximum spinal flexion' },
  'sit-up':                { start: 'lying flat on back, knees bent, feet flat, arms crossed on chest', end: 'fully sitting upright, torso perpendicular to floor' },
  'leg raise':             { start: 'lying flat on back, legs straight and together, heels just above floor', end: 'legs raised perpendicular to floor, hips slightly off floor' },
  plank:                   { start: 'high plank position, arms straight, body in straight line parallel to floor', end: 'forearm plank, elbows on floor, body rigid and straight' },
  'russian twist':         { start: 'seated, torso leaning back 45°, knees bent, hands clasped at centre', end: 'torso rotated fully to one side, hands reaching toward floor' },

  // Chest / press — specific variants before generic
  'incline bench press':   { start: 'lying on incline bench at ~45°, barbell lowered to upper chest, elbows bent', end: 'arms fully extended above upper chest, elbows locked out' },
  'decline bench press':   { start: 'lying on decline bench (head lower), barbell lowered to lower chest, elbows bent', end: 'arms fully extended above lower chest, elbows locked out' },
  'close grip bench':      { start: 'lying on bench, barbell lowered to chest, hands close together (shoulder-width or narrower), elbows tucked at sides', end: 'arms fully extended above chest, hands close, triceps contracted, elbows locked' },
  'bench press':           { start: 'lying on bench, barbell lowered to chest, elbows bent at 90°, bar touching sternum', end: 'arms fully extended above chest, elbows locked out, bar pressed to top' },
  'incline dumbbell press':{ start: 'lying on incline bench at 45°, dumbbells at upper chest level, elbows bent and flared', end: 'arms fully extended above upper chest, dumbbells pressed up and slightly together' },
  'decline dumbbell press':{ start: 'lying on decline bench, dumbbells at lower chest level, elbows bent and flared', end: 'arms fully extended above lower chest, dumbbells pressed up' },
  'incline dumbbell fly':  { start: 'lying on incline bench, arms wide and slightly bent, dumbbells at chest height on each side', end: 'arms brought together above upper chest, slight elbow bend, dumbbells nearly touching' },
  'chest fly':             { start: 'lying on bench, arms wide and slightly bent, dumbbells at chest height', end: 'arms brought together above chest, slight bend in elbows, dumbbells touching' },
  'cable fly':             { start: 'standing between cable stacks, arms extended wide at chest height, slight elbow bend, cables taut', end: 'arms brought together in front of chest, hands nearly meeting at centre, pecs fully contracted' },
  'cable crossover':       { start: 'standing, arms extended wide at shoulder height, cables taut', end: 'arms crossed in front of chest, hands meeting at centre, pecs maximally contracted' },
  'chest press':           { start: 'lying on bench or seated at machine, handles at chest level, elbows bent and flared', end: 'arms fully extended in front of chest, elbows locked out' },
  'fly':                   { start: 'lying on bench or standing, arms extended wide to sides with slight elbow bend', end: 'arms brought together in front of chest, pecs contracted, hands nearly touching' },
  'push-up':               { start: 'high plank position, arms straight, body straight, chest above floor', end: 'chest nearly touching floor, elbows bent at 90°, body in straight line' },
  'push up':               { start: 'high plank position, arms straight, body straight, chest above floor', end: 'chest nearly touching floor, elbows bent at 90°, body in straight line' },
  'dip':                   { start: 'arms straight, body suspended between parallel bars, slight forward lean', end: 'elbows bent to 90°, body lowered, chest forward' },
  'pec deck':              { start: 'seated, arms wide, forearms on pads at chest height', end: 'pads brought together in front of chest, pecs fully contracted' },
  'dumbbell pullover':     { start: 'lying across bench, arms extended overhead behind head, dumbbell held with both hands, chest and lats stretched', end: 'arms pulled forward and over chest, dumbbell at chest level, lats contracted' },
  'pullover':              { start: 'lying across or on bench, arms extended overhead behind head holding weight', end: 'arms pulled forward and over chest, lats contracted, weight at chest level' },

  // Back — specific before generic 'row'/'deadlift'
  'rack pull':             { start: 'standing over barbell set at knee height in rack, hips hinged, back flat, hands gripping bar', end: 'standing fully upright, hips extended, bar at hip level, shoulders retracted' },
  'sumo deadlift':         { start: 'wide stance over barbell, toes pointed out, hips hinged, back flat, hands gripping bar between legs', end: 'standing fully upright, hips extended, bar at hip level, knees and hips locked' },
  'trap bar deadlift':     { start: 'standing inside trap bar, hips hinged, knees bent, back flat, handles gripped at sides', end: 'standing fully upright, hips extended, arms straight, bar at hip level' },
  'romanian deadlift':     { start: 'standing upright holding barbell at hip height, slight knee bend, back flat', end: 'torso hinged forward, bar sliding down legs to mid-shin, hamstrings fully stretched, back flat' },
  'rdl':                   { start: 'standing upright, barbell at hip height', end: 'torso hinged forward, bar sliding down legs to mid-shin, hamstrings fully stretched' },
  'deadlift':              { start: 'standing over barbell, hips hinged back, back flat, bar over mid-foot', end: 'standing fully upright, hips extended, shoulders back, bar at hips' },
  'glute-ham raise':       { start: 'kneeling on GHD apparatus, ankles secured, body upright, thighs on pad', end: 'body lowered forward, torso nearly parallel to floor, hamstrings eccentrically engaged' },
  'glute ham raise':       { start: 'kneeling on GHD apparatus, ankles secured, body upright, thighs on pad', end: 'body lowered forward, torso nearly parallel to floor, hamstrings eccentrically engaged' },
  'nordic hamstring curl': { start: 'kneeling on pad, feet and ankles anchored to floor behind, body upright, arms at sides', end: 'body slowly lowered forward under hamstring control, torso nearly parallel to floor' },
  'reverse hyperextension':{ start: 'lying face-down on hyperextension bench, upper body secure, legs hanging down below pad', end: 'legs raised behind to parallel with floor, glutes and lower back contracted at top' },
  'hyperextension':        { start: 'torso bent forward at 90° over pad, body forming an L shape', end: 'torso raised to parallel with floor, lower back and glutes contracted' },
  'straight arm pulldown': { start: 'standing at cable machine, arms raised straight overhead gripping bar, slight elbow bend', end: 'arms pressed straight down to thighs, lats fully contracted, bar at hip level' },
  'lat pulldown':          { start: 'seated, arms fully extended overhead gripping bar wide', end: 'bar pulled down to upper chest, elbows pointing to floor, lats fully contracted' },
  'pulldown':              { start: 'seated at cable machine, arms fully extended overhead gripping bar or handle', end: 'bar pulled down to upper chest, elbows toward floor, lats contracted' },
  'pendlay row':           { start: 'torso fully parallel to floor, barbell on floor, arms extended down gripping it', end: 'barbell pulled explosively to lower chest, elbows driven back, torso stays parallel to floor' },
  't-bar row':             { start: 'straddling T-bar, torso hinged at ~45°, arms straight gripping handles', end: 'handles pulled to lower chest, elbows driven back past torso, lats and rhomboids contracted' },
  'inverted row':          { start: 'lying below bar, hands gripping it above, arms straight, body hanging in straight line', end: 'chest pulled up to bar, elbows bent and back, body rigid' },
  'reverse fly':           { start: 'seated or bent forward, arms hanging down with dumbbells, palms facing each other', end: 'arms raised out to shoulder height, rear delts contracted, shoulder blades squeezed' },
  'face pull':             { start: 'standing, arms extended forward, hands gripping rope at eye level', end: 'hands pulled back to face, elbows high and flared, rear delts contracted' },
  'good morning':          { start: 'standing upright, barbell on upper back, slight knee bend', end: 'torso hinged forward to parallel with floor, back flat, hamstrings stretched' },
  'row':                   { start: 'hinged forward at hips, back flat, arms straight down gripping bar or dumbbells', end: 'elbows pulled back past torso, bar or dumbbells at lower chest, lats contracted' },
  'pull-up':               { start: 'hanging from bar, arms fully extended, body straight', end: 'chin above bar, elbows fully bent, chest near bar' },
  'pull up':               { start: 'hanging from bar, arms fully extended, body straight', end: 'chin above bar, elbows fully bent, chest near bar' },
  'chin-up':               { start: 'hanging from bar with supinated grip, arms fully extended', end: 'chin above bar, elbows fully bent, biceps contracted' },
  'chin up':               { start: 'hanging from bar with supinated grip, arms fully extended', end: 'chin above bar, elbows fully bent, biceps contracted' },

  // Shoulders
  'landmine lateral raise':{ start: 'standing beside barbell end, one hand gripping it at hip level, arm straight', end: 'arm raised in an arc out to shoulder height, delt contracted, barbell end elevated' },
  'landmine press':        { start: 'standing, one hand holding loaded barbell end at chest level, barbell angled upward', end: 'arm extended, barbell pressed in an arc upward to near full extension above shoulder' },
  'overhead press':        { start: 'barbell or dumbbells at shoulder height, elbows at 90°', end: 'arms fully extended overhead, elbows locked, weight directly above head' },
  'shoulder press':        { start: 'dumbbells or barbell at shoulder height, elbows at 90°', end: 'arms fully extended overhead, elbows locked, weight above head' },
  'lateral raise':         { start: 'standing, arms at sides, dumbbells by hips', end: 'arms raised to shoulder height, parallel to floor, slight elbow bend' },
  'front raise':           { start: 'standing, arms at sides, dumbbells in front of thighs', end: 'arms raised straight to shoulder height in front of body' },
  'upright row':           { start: 'standing, barbell or dumbbells at hip height, arms extended down', end: 'elbows raised high, bar pulled to chin level, elbows above wrists' },
  'arnold press':          { start: 'seated, dumbbells at shoulder height, palms facing body, elbows in front', end: 'arms fully extended overhead, palms rotated to face out' },
  shrug:                   { start: 'standing upright, arms at sides holding barbell or dumbbells at hip level, shoulders relaxed', end: 'shoulders raised as high as possible toward ears, traps fully contracted, arms straight' },

  // Arms — specific before generic 'curl'/'tricep'
  'wrist curl':            { start: 'seated, forearms resting on thighs, wrists and hands hanging off the edge, palms facing up, weight in hands', end: 'wrists curled fully upward, forearm flexors contracted, knuckles pointing toward ceiling' },
  'wrist extension':       { start: 'seated, forearms resting on thighs, wrists hanging off edge, palms facing down, weight in hands', end: 'wrists extended fully upward, forearm extensors contracted, back of hands toward ceiling' },
  'reverse curl':          { start: 'standing, arms straight, bar held at hips with overhand (pronated) grip, palms facing back', end: 'elbows fully flexed, bar at shoulder height, forearms engaged, brachioradialis contracted' },
  'concentration curl':    { start: 'seated, arm extended down with elbow on inner thigh, dumbbell at floor level', end: 'elbow fully flexed, dumbbell at shoulder height, bicep peaked' },
  'preacher curl':         { start: 'arms resting on preacher pad, fully extended, barbell in hands', end: 'elbows fully flexed, bar at shoulder height, biceps contracted' },
  'bicep curl':            { start: 'standing, arms straight, dumbbells at sides with supinated grip', end: 'elbows fully flexed, dumbbells at shoulder height, biceps fully contracted' },
  'hammer curl':           { start: 'standing, arms straight, dumbbells at sides with neutral grip', end: 'elbows flexed, dumbbells at shoulder height, neutral grip maintained' },
  'curl':                  { start: 'standing, arms straight, weight at sides', end: 'elbows fully flexed, weight at shoulder height, biceps contracted' },
  'tricep kickback':       { start: 'torso bent forward at 45°, upper arm parallel to floor tucked at side, forearm hanging down, elbow at 90°', end: 'arm fully extended behind body, elbow locked, tricep at peak contraction' },
  kickback:                { start: 'torso bent forward at 45°, upper arm parallel to floor tucked at side, forearm hanging down', end: 'arm fully extended behind body, elbow locked out, tricep contracted' },
  'skull crusher':         { start: 'lying on bench, bar lowered toward forehead, elbows bent at 90°', end: 'arms fully extended above chest, elbows locked out' },
  'rope pushdown':         { start: 'standing at cable machine, elbows bent and tucked at sides, rope handle at chest level', end: 'arms fully extended downward, rope pulled apart at bottom, triceps fully contracted' },
  pushdown:                { start: 'standing at cable machine, elbows bent and tucked at sides, bar or handle at chest level', end: 'arms fully extended downward, elbows locked, triceps fully contracted' },
  tricep:                  { start: 'arms bent, elbows close to head or body', end: 'arms fully extended, elbows locked out, triceps contracted' },
  triceps:                 { start: 'arms bent, elbows close to head or body', end: 'arms fully extended, elbows locked out, triceps contracted' },
  'farmer':                { start: 'standing upright, heavy dumbbells or handles held at sides, shoulders packed and retracted', end: 'walking with heavy load at sides, posture tall, shoulders retracted, core braced' },

  // Legs — specific before generic 'squat'/'deadlift'
  'barbell front squat':   { start: 'standing upright, barbell racked across front deltoids and clavicles with elbows high pointing forward, feet shoulder-width', end: 'VERY DEEP squat well below parallel, elbows still high and pointing forward, torso upright, hips well below knee level — dramatically different from starting position' },
  'barbell box squat':     { start: 'standing over box, barbell across upper back, feet shoulder-width, body upright', end: 'seated on box with thighs at or below parallel, back upright, paused — dramatically lower than starting position' },
  'barbell squat':         { start: 'standing upright, barbell across upper traps, feet shoulder-width, body fully erect', end: 'DEEP squat well below parallel, hips below knee level, back upright — dramatically different low position vs starting stance' },
  'bulgarian split squat': { start: 'standing, rear foot elevated on bench behind, front foot forward, torso upright, both legs near extended', end: 'front knee bent at 90° over ankle, rear knee nearly touching floor, deep split squat position' },
  'goblet squat':          { start: 'standing, feet shoulder-width, dumbbell or kettlebell held at chest with both hands, elbows pointing down', end: 'deep squat well below parallel, elbows inside knees pushing them out, torso upright, hips below knees' },
  'hack squat':            { start: 'positioned on hack squat machine, shoulders under pads, knees bent, body lowered into machine', end: 'legs fully extended, platform driven away, knees nearly locked out, full quad extension at top' },
  'smith machine squat':   { start: 'under Smith machine bar across upper back, feet shoulder-width, standing upright', end: 'deep squat well below parallel, thighs angled down past horizontal, knees tracking over toes' },
  'box squat':             { start: 'standing over box, bar on upper back, feet shoulder-width, ready to sit back', end: 'seated on box with thighs at or below parallel, weight held, dramatic contrast to standing position' },
  squat:                   { start: 'standing upright, feet shoulder-width apart', end: 'deep squat well below parallel, thighs below horizontal, hips below knee level — dramatically lower than starting position' },
  'walking lunge':         { start: 'standing upright, one foot stepped forward ready to lunge', end: 'front knee at 90°, rear knee nearly touching floor, then stepping forward with rear leg' },
  lunge:                   { start: 'standing upright, feet together', end: 'front knee bent at 90° over ankle, back knee nearly touching floor' },
  'leg press':             { start: 'seated in leg press, knees bent at 90°, feet on platform', end: 'legs fully extended, knees nearly locked, platform pushed away' },
  'leg extension':         { start: 'seated, knees bent at 90°, shins vertical, pads against ankles', end: 'legs fully extended, parallel to floor, quads contracted' },
  'leg curl':              { start: 'lying face down or seated, legs straight, pads at ankles', end: 'knees fully bent, heels pulled toward glutes, hamstrings contracted' },
  'single leg hip thrusts':{ start: 'upper back on bench, one foot flat on floor with knee bent, other leg raised, hips low', end: 'hips fully extended on one leg, body parallel to floor, glute maximally contracted' },
  'hip thrust':            { start: 'upper back on bench, hips lowered near floor, knees bent at 90°', end: 'hips fully extended, body parallel to floor, glutes at peak contraction' },
  'glute bridge':          { start: 'lying on back, knees bent, feet flat on floor, hips down', end: 'hips raised, body straight from shoulders to knees, glutes contracted' },
  'single leg romanian deadlift': { start: 'standing on one leg, slight knee bend, weight held at hip height, other foot lifted', end: 'torso hinged forward, free leg extended behind for balance, weight at shin level, hamstring stretched' },
  'donkey kick':           { start: 'on hands and knees, neutral spine, one knee on floor', end: 'one leg raised behind body, knee bent, foot driven toward ceiling, glute fully contracted' },
  'fire hydrant':          { start: 'on hands and knees, both knees on floor, neutral spine, hips square', end: 'one knee raised out to the side at hip height, hip abducted, glute medius contracted' },
  'hip abduction':         { start: 'seated in hip abduction machine, thighs pressed together, pads against outer thighs', end: 'thighs pushed wide apart to maximum range, hip abductors fully contracted' },
  adductor:                { start: 'seated in adductor machine, thighs spread wide apart, pads against inner thighs', end: 'thighs squeezed together at centre, adductors fully contracted' },
  'hip flexor raise':      { start: 'standing upright, one leg grounded, other leg hanging in neutral position, core braced', end: 'free knee driven upward toward chest, hip fully flexed at top of movement' },
  'kettlebell swing':      { start: 'standing with feet shoulder-width, knees bent, hips hinged back, kettlebell between legs behind hips', end: 'hips thrust powerfully forward, body upright, kettlebell swung to shoulder height, arms parallel to floor' },
  'step up':               { start: 'standing in front of box or bench, one foot placed on top', end: 'standing on top of box, both feet together, hip and knee fully extended' },
  'calf raise':            { start: 'standing on edge of platform, heels below platform level, calves fully stretched', end: 'raised up on toes at maximum height, calves fully contracted' },
};

// Priority matching: exact > endsWith > startsWith > includes
// This ensures 'bicycle crunch' matches its own key, not the generic 'crunch' key.
function getPositionHint(exerciseName: string): { start: string; end: string } | null {
  const n = exerciseName.toLowerCase();
  let sw: { start: string; end: string } | null = null;
  let ew: { start: string; end: string } | null = null;
  let inc: { start: string; end: string } | null = null;
  for (const [key, hint] of Object.entries(EXERCISE_POSITION_HINTS)) {
    if (n === key) return hint;
    if (!sw && n.startsWith(key)) sw = hint;
    if (!ew && n.endsWith(key)) ew = hint;
    if (!inc && n.includes(key)) inc = hint;
  }
  return ew ?? sw ?? inc ?? null;
}

function detectEquipment(exerciseName: string): string {
  const n = exerciseName.toLowerCase();
  if (n.includes('barbell')) return 'Standard Olympic barbell with two round weight plates on each side.';
  if (n.includes('dumbbell')) return 'A pair of dumbbells held appropriately for the exercise.';
  if (n.includes('cable')) return 'Cable machine with appropriate handle attachment.';
  if (n.includes('kettlebell')) return 'A kettlebell held appropriately for the exercise.';
  if (n.includes('resistance band') || (n.includes('band') && !n.includes('arm band'))) return 'A resistance band.';
  if (n.includes('pull-up') || n.includes('pullup') || n.includes('chin-up') || n.includes('chinup')) return 'A pull-up bar above the figure.';
  if (n.includes('machine') || n.includes('press machine') || n.includes('fly machine')) return 'The appropriate gym machine for this exercise.';
  return '';
}

export function buildStartPrompt(
  exerciseName: string,
  gender: 'male' | 'female',
  muscles: MuscleGroup[],
): string {
  const person = gender === 'female' ? 'female' : 'male';
  const primary = muscles.filter((m) => m.role === 'main').map((m) => m.muscle);
  const secondary = muscles.filter((m) => m.role === 'secondary').map((m) => m.muscle);
  const equipment = detectEquipment(exerciseName);
  const hint = getPositionHint(exerciseName);

  return [
    `Anatomical fitness illustration of a ${person}, at the STARTING POSITION of a ${exerciseName}.`,
    hint ? `Starting position: ${hint.start}.` : '',
    'Full anatomical muscle visualization, skin and fat layers removed to show musculature clearly.',
    'Natural pinkish-beige muscle tone base. Side view, full body visible, centred.',
    primary.length > 0 ? `Primary muscles (${primary.join(', ')}) highlighted in bright red-orange.` : '',
    secondary.length > 0 ? `Secondary muscles (${secondary.join(', ')}) highlighted in yellow.` : '',
    equipment,
    'Pure solid white background. No shadows, no ground plane.',
    'Professional medical-grade anatomical illustration style. Sharp detail. No text, no watermarks.',
  ].filter(Boolean).join(' ');
}

export function buildEndPrompt(
  exerciseName: string,
  gender: 'male' | 'female',
  muscles: MuscleGroup[],
): string {
  const person = gender === 'female' ? 'female' : 'male';
  const primary = muscles.filter((m) => m.role === 'main').map((m) => m.muscle);
  const secondary = muscles.filter((m) => m.role === 'secondary').map((m) => m.muscle);
  const equipment = detectEquipment(exerciseName);
  const hint = getPositionHint(exerciseName);

  return [
    `The SAME anatomical ${person} figure as in the previous image, now showing the PEAK CONTRACTION / END POSITION of a ${exerciseName}.`,
    hint
      ? `End position: ${hint.end}. The body MUST be in a CLEARLY DIFFERENT pose from the starting image.`
      : `The body MUST be in a CLEARLY DIFFERENT pose from the starting image — fully contracted, maximum range of motion reached.`,
    `Match the illustration style, figure, and${equipment ? ' equipment' : ' body proportions'} from the previous image exactly.`,
    primary.length > 0 ? `Same primary muscle highlights (${primary.join(', ')}) in bright red-orange.` : '',
    secondary.length > 0 ? `Same secondary muscle highlights (${secondary.join(', ')}) in yellow.` : '',
    'Same side view angle. Pure solid white background. No shadows. No text, no watermarks.',
    'Professional medical-grade anatomical illustration style.',
  ].filter(Boolean).join(' ');
}

/**
 * Remove the white background using BFS flood-fill from corners (preserves
 * interior white highlights), then feathers anti-aliased edge fringing by
 * soft-erasing near-white pixels that border the transparent region.
 */
export async function removeWhiteBackground(buffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixels = new Uint8Array(data.buffer);
  const visited = new Uint8Array(width * height); // 1 = transparent (background)
  const WHITE = 228; // lowered from 238 to catch more near-white edge pixels

  function isWhitePx(i: number) {
    const b = i * 4;
    return pixels[b] >= WHITE && pixels[b + 1] >= WHITE && pixels[b + 2] >= WHITE;
  }

  const queue: number[] = [];
  function enqueue(i: number) {
    if (i >= 0 && i < width * height && !visited[i] && isWhitePx(i)) {
      visited[i] = 1;
      queue.push(i);
    }
  }

  for (const corner of [0, width - 1, (height - 1) * width, height * width - 1]) {
    enqueue(corner);
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (y > 0) enqueue(idx - width);
    if (y < height - 1) enqueue(idx + width);
    if (x > 0) enqueue(idx - 1);
    if (x < width - 1) enqueue(idx + 1);
  }

  // Pass 1: erase flood-filled background pixels
  for (let i = 0; i < width * height; i++) {
    if (visited[i]) pixels[i * 4 + 3] = 0;
  }

  // Pass 2: feather — soft-erase near-white pixels that neighbour transparent ones.
  // This cleans up anti-aliased fringing without touching interior highlights
  // (which are only adjacent to other opaque pixels, not to the background).
  const FRINGE_THRESHOLD = 210; // brightness above which edge pixels are fringed
  for (let i = 0; i < width * height; i++) {
    if (visited[i]) continue; // already transparent
    const b = i * 4;
    const r = pixels[b], g = pixels[b + 1], bl = pixels[b + 2];
    const brightness = (r + g + bl) / 3;
    if (brightness < FRINGE_THRESHOLD) continue; // dark enough — keep as-is

    const x = i % width, y = Math.floor(i / width);
    const hasTransparentNeighbour =
      (y > 0 && visited[i - width]) ||
      (y < height - 1 && visited[i + width]) ||
      (x > 0 && visited[i - 1]) ||
      (x < width - 1 && visited[i + 1]);

    if (hasTransparentNeighbour) {
      // Scale alpha: fully white (255) → 0, at threshold → full opacity
      const alpha = Math.round(((FRINGE_THRESHOLD - brightness) / FRINGE_THRESHOLD) * 255);
      pixels[b + 3] = Math.max(0, alpha);
    }
  }

  return sharp(Buffer.from(pixels.buffer), { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 8 })
    .toBuffer();
}

function getAi() {
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! });
}

async function callGeminiImage(
  model: string,
  contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'],
): Promise<Buffer> {
  const ai = getAi();
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
    const response = await ai.models.generateContent({
      model,
      contents,
      config: { responseModalities: [Modality.IMAGE] },
    });
    const b64 = response.data;
    if (b64) return Buffer.from(b64, 'base64');
    // Model returned text instead of image — capture it for the error message
    lastError = response.text ? `model said: "${response.text.slice(0, 120)}"` : 'no image in response';
  }
  throw new Error(`${model}: ${lastError}`);
}

async function callImagen(model: string, prompt: string): Promise<Buffer> {
  const ai = getAi();
  const response = await ai.models.generateImages({
    model,
    prompt,
    config: { numberOfImages: 1, aspectRatio: '3:4' },
  });
  const b64 = response.generatedImages?.[0]?.image?.imageBytes;
  if (!b64) throw new Error(`${model}: no image returned`);
  return Buffer.from(b64, 'base64');
}

/**
 * Generate a matched start + end frame pair.
 *
 * If referenceImage is provided it is sent as the first visual context for
 * every Gemini call — anchoring the figure style, proportions, and rendering
 * quality across both frames and across all exercises.
 * The start frame is then also passed when generating the end frame so the
 * pose transition stays consistent.
 */
export async function generateExercisePair(
  exerciseName: string,
  gender: 'male' | 'female',
  muscles: MuscleGroup[],
  model: ImageGenModel = DEFAULT_MODEL,
  referenceImage?: Buffer,
): Promise<{ start: Buffer; end: Buffer }> {
  const startPromptText = buildStartPrompt(exerciseName, gender, muscles);
  const endPromptText = buildEndPrompt(exerciseName, gender, muscles);
  const refB64 = referenceImage?.toString('base64');

  let startRaw: Buffer;
  let endRaw: Buffer;

  if (model.startsWith('imagen-')) {
    [startRaw, endRaw] = await Promise.all([
      callImagen(model, startPromptText),
      callImagen(model, endPromptText),
    ]);
  } else {
    // Start frame — include reference style anchor if available
    startRaw = await callGeminiImage(model, refB64
      ? [{ parts: [
          { inlineData: { data: refB64, mimeType: 'image/png' } },
          { text: `${startPromptText} Match the visual style, rendering quality, figure proportions, and muscle definition aesthetic of the reference image. Only the exercise and pose should differ.` },
        ] }]
      : startPromptText,
    );

    // End frame — reference + start frame for maximum consistency
    const startB64 = startRaw.toString('base64');
    endRaw = await callGeminiImage(model, [{
      parts: [
        ...(refB64 ? [{ inlineData: { data: refB64, mimeType: 'image/png' } }] : []),
        { inlineData: { data: startB64, mimeType: 'image/jpeg' } },
        { text: endPromptText },
      ],
    }]);
  }

  const [start, end] = await Promise.all([
    removeWhiteBackground(startRaw),
    removeWhiteBackground(endRaw),
  ]);

  return { start, end };
}

/** Generate a single frame (used for testing individual images). */
export async function generateExerciseImage(
  prompt: string,
  model: ImageGenModel = DEFAULT_MODEL,
): Promise<{ buffer: Buffer; mimeType: string }> {
  let raw: Buffer;

  if (model.startsWith('imagen-')) {
    raw = await callImagen(model, prompt);
  } else {
    raw = await callGeminiImage(model, prompt);
  }

  const buffer = await removeWhiteBackground(raw);
  return { buffer, mimeType: 'image/png' };
}
